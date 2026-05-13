"""Catalogos — devuelve todas las tablas lookup para poblar formularios del frontend."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.schemas.catalogo import CatalogosResponse, ConceptoDetallado
from app.schemas.empresa import EmpresaRead, EmpresaUpdate
from app.services.audit_service import audit_log
from app.services.empresa_scope_service import EmpresaScopeDep

router = APIRouter()

# Cache de catálogos en el cliente: estos valores (empresas, conceptos,
# bancos, proyectos) cambian rara vez. 5 min de stale-while-revalidate
# le ahorra al frontend muchas requests redundantes en navegación
# normal del usuario.
_CATALOG_CACHE_HEADER = "private, max-age=300, stale-while-revalidate=60"


class EmpresaCatalogo(BaseModel):
    codigo: str
    razon_social: str
    oc_prefix: str | None = None
    rut: str | None = None
    # V5++ ola CG — Para que el FE sepa si tiene logo cargado
    logo_dropbox_path: str | None = None


_EMPRESA_COLS = (
    "empresa_id, codigo, razon_social, rut, giro, direccion, ciudad, "
    "telefono, representante_legal, email_firmante, oc_prefix, activo"
)


@router.get(
    "/empresas/{codigo}",
    response_model=EmpresaRead,
)
async def get_empresa(
    user: CurrentUser, db: DBSession, codigo: str
) -> EmpresaRead:
    """Detalle completo de una empresa (incluye campos fiscales/contacto)."""
    row = (
        await db.execute(
            text(
                f"SELECT {_EMPRESA_COLS} FROM core.empresas WHERE codigo = :codigo"
            ),
            {"codigo": codigo},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Empresa no encontrada: {codigo}",
        )
    return EmpresaRead.model_validate(dict(row))


@router.patch(
    "/empresas/{codigo}",
    response_model=EmpresaRead,
    dependencies=[Depends(require_scope("empresa:update"))],
)
async def update_empresa(
    user: CurrentUser,
    db: DBSession,
    request: Request,
    codigo: str,
    body: EmpresaUpdate,
) -> EmpresaRead:
    """Actualiza datos editables de la empresa. Solo admin (`empresa:update`)."""
    existing = (
        await db.execute(
            text(
                f"SELECT {_EMPRESA_COLS} FROM core.empresas WHERE codigo = :codigo"
            ),
            {"codigo": codigo},
        )
    ).mappings().first()
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Empresa no encontrada: {codigo}",
        )
    before = EmpresaRead.model_validate(dict(existing)).model_dump(mode="json")

    fields = body.model_dump(exclude_unset=True)
    if fields:
        sets = [f"{k} = :{k}" for k in fields]
        sets.append("updated_at = now()")
        params = dict(fields)
        params["codigo"] = codigo
        await db.execute(
            text(
                f"UPDATE core.empresas SET {', '.join(sets)} "  # noqa: S608
                "WHERE codigo = :codigo"
            ),
            params,
        )
        await db.commit()

    updated = (
        await db.execute(
            text(
                f"SELECT {_EMPRESA_COLS} FROM core.empresas WHERE codigo = :codigo"
            ),
            {"codigo": codigo},
        )
    ).mappings().one()
    refreshed = EmpresaRead.model_validate(dict(updated))
    if fields:
        await audit_log(
            db,
            request,
            user,
            action="update",
            entity_type="empresa",
            entity_id=codigo,
            entity_label=refreshed.razon_social if hasattr(refreshed, "razon_social") else codigo,
            summary=f"Empresa {codigo} editada",
            before=before,
            after=refreshed.model_dump(mode="json"),
        )
    return refreshed


@router.get("/empresas", response_model=list[EmpresaCatalogo])
async def list_empresas(
    user: CurrentUser, db: DBSession, response: Response,
    scope: EmpresaScopeDep,
) -> list[EmpresaCatalogo]:
    """Catálogo plano de empresas — único source-of-truth para selects.

    V5++ ola AP: filtra por las empresas que el user puede ver.
    - Admin → ve todas (activas e inactivas, para histórico)
    - Scoped users → solo las de su user_company_roles
    """
    response.headers["Cache-Control"] = _CATALOG_CACHE_HEADER

    # Aplicar scope multi-tenant
    if scope.is_global:
        sql_filter = ""
        params: dict = {}
    else:
        allowed = list(scope.allowed_codes or [])
        if not allowed:
            return []  # user sin empresas → lista vacía
        sql_filter = "WHERE codigo = ANY(:allowed)"
        params = {"allowed": allowed}

    rows = (
        await db.execute(
            text(
                f"SELECT codigo, razon_social, oc_prefix, rut, logo_dropbox_path "
                f"FROM core.empresas {sql_filter} ORDER BY codigo"  # noqa: S608
            ),
            params,
        )
    ).fetchall()
    return [
        EmpresaCatalogo(
            codigo=r[0],
            razon_social=r[1],
            oc_prefix=r[2],
            rut=r[3],
            logo_dropbox_path=r[4],
        )
        for r in rows
    ]


@router.get("", response_model=CatalogosResponse)
async def get_catalogos(
    user: CurrentUser, db: DBSession, response: Response,
    scope: EmpresaScopeDep,
) -> CatalogosResponse:
    """V5++ ola AP: empresas en el catalogo filtradas por scope del user."""
    response.headers["Cache-Control"] = _CATALOG_CACHE_HEADER

    if scope.is_global:
        empresa_filter = ""
        empresa_params: dict = {}
    else:
        allowed_list = list(scope.allowed_codes or [])
        if not allowed_list:
            empresa_filter = "WHERE FALSE"
            empresa_params = {}
        else:
            empresa_filter = "WHERE codigo = ANY(:allowed)"
            empresa_params = {"allowed": allowed_list}

    empresas_rows = (
        await db.execute(
            text(
                f"SELECT codigo, razon_social, oc_prefix, rut "
                f"FROM core.empresas {empresa_filter} ORDER BY codigo"  # noqa: S608
            ),
            empresa_params,
        )
    ).fetchall()

    cg_rows = (
        await db.execute(text("SELECT concepto_general FROM core.concepto_general ORDER BY 1"))
    ).fetchall()

    cd_rows = (
        await db.execute(
            text(
                "SELECT concepto_detallado, concepto_general "
                "FROM core.concepto_detallado ORDER BY 1"
            )
        )
    ).fetchall()

    te_rows = (
        await db.execute(text("SELECT tipo_egreso FROM core.tipo_egreso ORDER BY 1"))
    ).fetchall()

    fu_rows = (
        await db.execute(text("SELECT fuente FROM core.fuente ORDER BY 1"))
    ).fetchall()

    pr_rows = (
        await db.execute(text("SELECT proyecto FROM core.proyecto ORDER BY 1"))
    ).fetchall()

    ba_rows = (
        await db.execute(text("SELECT banco FROM core.banco ORDER BY 1"))
    ).fetchall()

    return CatalogosResponse(
        empresas=[
            {"codigo": r[0], "razon_social": r[1], "oc_prefix": r[2], "rut": r[3]}
            for r in empresas_rows
        ],
        concepto_general=[r[0] for r in cg_rows],
        concepto_detallado=[
            ConceptoDetallado(concepto_detallado=r[0], concepto_general=r[1])
            for r in cd_rows
        ],
        tipo_egreso=[r[0] for r in te_rows],
        fuente=[r[0] for r in fu_rows],
        proyecto=[r[0] for r in pr_rows],
        banco=[r[0] for r in ba_rows],
    )
