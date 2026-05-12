"""Endpoints CRUD de approval_rules + user_company_roles (V5 Fase 2).

Endpoints:
  GET    /admin/approval-rules                            (filtrable por empresa)
  GET    /admin/approval-rules/{id}
  POST   /admin/approval-rules
  PATCH  /admin/approval-rules/{id}
  DELETE /admin/approval-rules/{id}

  GET    /admin/user-company-roles                        (matriz user × empresa)
  POST   /admin/user-company-roles                        (asignar rol a user)
  DELETE /admin/user-company-roles                        (revocar rol)
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.services.empresa_scope_service import invalidate_user_cache

router = APIRouter()


# Tipos espejo del CHECK
VoucherTipo = Literal[
    "INGRESO", "EGRESO", "TRASPASO", "COMPRA", "VENTA",
    "APERTURA", "CIERRE", "REVERSO",
]
BalanceTreatment = Literal["GASTO", "ACTIVACION"]
CompanyRole = Literal[
    "GG", "COO", "CONTADOR", "OPERADOR", "DIRECTOR", "TESORERIA"
]


# =====================================================================
# Approval Rules
# =====================================================================


class ApprovalRuleBase(BaseModel):
    empresa_codigo: str = Field(min_length=2, max_length=20)
    voucher_tipo: VoucherTipo | None = None
    min_amount: Decimal = Field(default=Decimal("0"), ge=0)
    max_amount: Decimal | None = None
    balance_treatment: BalanceTreatment | None = None
    required_roles: list[CompanyRole] = Field(min_length=1)
    reinforced: bool = False
    priority: int = Field(default=100, ge=1, le=999)
    active: bool = True
    descripcion: str | None = Field(default=None, max_length=300)


class ApprovalRuleCreate(ApprovalRuleBase):
    pass


class ApprovalRuleUpdate(BaseModel):
    voucher_tipo: VoucherTipo | None = None
    min_amount: Decimal | None = Field(default=None, ge=0)
    max_amount: Decimal | None = None
    balance_treatment: BalanceTreatment | None = None
    required_roles: list[CompanyRole] | None = Field(default=None, min_length=1)
    reinforced: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=999)
    active: bool | None = None
    descripcion: str | None = Field(default=None, max_length=300)


class ApprovalRuleRead(ApprovalRuleBase):
    model_config = ConfigDict(from_attributes=True)
    rule_id: int
    created_at: datetime
    updated_at: datetime


_RULE_COLS = (
    "rule_id, empresa_codigo, voucher_tipo, min_amount, max_amount, "
    "balance_treatment, required_roles, reinforced, priority, active, "
    "descripcion, created_at, updated_at"
)


@router.get("/admin/approval-rules", response_model=list[ApprovalRuleRead])
async def list_approval_rules(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str | None = Query(default=None),
    only_active: bool = Query(default=True),
) -> list[ApprovalRuleRead]:
    where_parts: list[str] = []
    params: dict[str, Any] = {}
    if empresa_codigo:
        where_parts.append("empresa_codigo = :e")
        params["e"] = empresa_codigo
    if only_active:
        where_parts.append("active = TRUE")
    where_sql = " WHERE " + " AND ".join(where_parts) if where_parts else ""

    rows = (
        await db.execute(
            text(
                f"SELECT {_RULE_COLS} FROM core.approval_rules{where_sql} "
                "ORDER BY empresa_codigo, priority ASC"
            ),
            params,
        )
    ).mappings().all()
    return [ApprovalRuleRead.model_validate(dict(r)) for r in rows]


@router.get("/admin/approval-rules/{rule_id}", response_model=ApprovalRuleRead)
async def get_approval_rule(
    user: CurrentUser, db: DBSession, rule_id: int
) -> ApprovalRuleRead:
    row = (
        await db.execute(
            text(
                f"SELECT {_RULE_COLS} FROM core.approval_rules WHERE rule_id = :id"
            ),
            {"id": rule_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada"
        )
    return ApprovalRuleRead.model_validate(dict(row))


@router.post(
    "/admin/approval-rules",
    response_model=ApprovalRuleRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_approval_rule(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    body: ApprovalRuleCreate,
) -> ApprovalRuleRead:
    try:
        result = await db.execute(
            text(
                """
                INSERT INTO core.approval_rules (
                    empresa_codigo, voucher_tipo, min_amount, max_amount,
                    balance_treatment, required_roles, reinforced,
                    priority, active, descripcion, created_by
                )
                VALUES (
                    :empresa_codigo, :voucher_tipo, :min_amount, :max_amount,
                    :balance_treatment, CAST(:required_roles AS TEXT[]),
                    :reinforced, :priority, :active, :descripcion,
                    CAST(:created_by AS UUID)
                )
                RETURNING rule_id
                """
            ),
            {**body.model_dump(), "created_by": str(user.sub)},
        )
        await db.commit()
        rule_id = result.scalar_one()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se pudo crear la regla: {exc}",
        ) from exc
    return await get_approval_rule(user, db, rule_id)


@router.patch(
    "/admin/approval-rules/{rule_id}",
    response_model=ApprovalRuleRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def update_approval_rule(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    rule_id: int,
    body: ApprovalRuleUpdate,
) -> ApprovalRuleRead:
    update_data = body.model_dump(exclude_unset=True)
    if not update_data:
        return await get_approval_rule(user, db, rule_id)

    set_clauses = []
    for k in update_data:
        if k == "required_roles":
            set_clauses.append(f"{k} = CAST(:{k} AS TEXT[])")
        else:
            set_clauses.append(f"{k} = :{k}")
    update_data["rule_id"] = rule_id

    res = await db.execute(
        text(
            f"UPDATE core.approval_rules SET {', '.join(set_clauses)}, "
            "updated_at = now() WHERE rule_id = :rule_id"
        ),
        update_data,
    )
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada"
        )
    await db.commit()
    return await get_approval_rule(user, db, rule_id)


@router.delete(
    "/admin/approval-rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def delete_approval_rule(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    rule_id: int,
) -> Response:
    res = await db.execute(
        text("DELETE FROM core.approval_rules WHERE rule_id = :id"),
        {"id": rule_id},
    )
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Regla no encontrada"
        )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# =====================================================================
# User Company Roles
# =====================================================================


class UserCompanyRoleBase(BaseModel):
    user_id: str  # UUID as string
    empresa_codigo: str = Field(min_length=2, max_length=20)
    role: CompanyRole
    notas: str | None = Field(default=None, max_length=200)


class UserCompanyRoleCreate(UserCompanyRoleBase):
    pass


class UserCompanyRoleRead(UserCompanyRoleBase):
    model_config = ConfigDict(from_attributes=True)
    active: bool
    assigned_at: datetime
    assigned_by: str | None


@router.get(
    "/admin/user-company-roles",
    response_model=list[UserCompanyRoleRead],
)
async def list_user_company_roles(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    only_active: bool = Query(default=True),
) -> list[UserCompanyRoleRead]:
    where_parts: list[str] = []
    params: dict[str, Any] = {}
    if empresa_codigo:
        where_parts.append("empresa_codigo = :e")
        params["e"] = empresa_codigo
    if user_id:
        where_parts.append("user_id = CAST(:u AS UUID)")
        params["u"] = user_id
    if only_active:
        where_parts.append("active = TRUE")
    where_sql = " WHERE " + " AND ".join(where_parts) if where_parts else ""

    rows = (
        await db.execute(
            text(
                "SELECT user_id::text AS user_id, empresa_codigo, role, "
                "       active, assigned_at, assigned_by::text AS assigned_by, notas "
                "FROM core.user_company_roles"
                f"{where_sql} "
                "ORDER BY empresa_codigo, role, user_id"
            ),
            params,
        )
    ).mappings().all()
    return [UserCompanyRoleRead.model_validate(dict(r)) for r in rows]


@router.post(
    "/admin/user-company-roles",
    response_model=UserCompanyRoleRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("user:write"))],
)
async def assign_user_company_role(
    user: Annotated[AuthenticatedUser, Depends(require_scope("user:write"))],
    db: DBSession,
    body: UserCompanyRoleCreate,
) -> UserCompanyRoleRead:
    """Asigna un rol a un usuario en una empresa. UPSERT idempotente:
    si ya existe el (user, empresa, role), lo reactiva.

    V5++ ola CB: invalida el scope cache del user al final para que el
    cambio sea inmediato (sin esperar TTL de 60s).
    """
    try:
        await db.execute(
            text(
                """
                INSERT INTO core.user_company_roles (
                    user_id, empresa_codigo, role, active, assigned_by, notas
                )
                VALUES (
                    CAST(:user_id AS UUID), :empresa_codigo, :role, TRUE,
                    CAST(:assigned_by AS UUID), :notas
                )
                ON CONFLICT (user_id, empresa_codigo, role) DO UPDATE
                    SET active = TRUE,
                        assigned_at = now(),
                        assigned_by = EXCLUDED.assigned_by,
                        notas = EXCLUDED.notas
                """
            ),
            {**body.model_dump(), "assigned_by": str(user.sub)},
        )
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se pudo asignar: {exc}",
        ) from exc

    # V5++ ola CB: refrescar cache para que el cambio sea inmediato
    invalidate_user_cache(body.user_id)

    row = (
        await db.execute(
            text(
                "SELECT user_id::text AS user_id, empresa_codigo, role, active, "
                "       assigned_at, assigned_by::text AS assigned_by, notas "
                "FROM core.user_company_roles "
                "WHERE user_id = CAST(:u AS UUID) AND empresa_codigo = :e AND role = :r"
            ),
            {"u": body.user_id, "e": body.empresa_codigo, "r": body.role},
        )
    ).mappings().one()
    return UserCompanyRoleRead.model_validate(dict(row))


@router.delete(
    "/admin/user-company-roles",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("user:write"))],
)
async def revoke_user_company_role(
    user: Annotated[AuthenticatedUser, Depends(require_scope("user:write"))],
    db: DBSession,
    user_id: Annotated[str, Query()],
    empresa_codigo: Annotated[str, Query()],
    role: Annotated[CompanyRole, Query()],
) -> Response:
    """Revoca el rol marcando active=false (preserva audit log).

    V5++ ola CB: invalida cache scope del user para que el revoke sea
    inmediato.
    """
    res = await db.execute(
        text(
            "UPDATE core.user_company_roles SET active = FALSE "
            "WHERE user_id = CAST(:u AS UUID) AND empresa_codigo = :e AND role = :r"
        ),
        {"u": user_id, "e": empresa_codigo, "r": role},
    )
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Asignación no encontrada"
        )
    await db.commit()
    # V5++ ola CB: refrescar cache para que el revoke sea inmediato
    invalidate_user_cache(user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
