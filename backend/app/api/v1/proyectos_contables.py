"""Endpoints CRUD de Proyectos Contables (V5).

Distinto de `core.proyectos_empresa` (Gantt operativo) y de
`core.proyecto` (legacy TEXT PK simple). Estos son los proyectos
formales para imputación de vouchers, con código `PRJ-EMP-TIPO-NNN`.

Endpoints:
  GET    /proyectos-contables               (lista filtrable)
  GET    /proyectos-contables/{codigo}      (detalle)
  POST   /proyectos-contables               (crear)
  PATCH  /proyectos-contables/{codigo}      (editar)
  DELETE /proyectos-contables/{codigo}      (solo si NO tiene voucher_lines)
  GET    /proyectos-contables/{codigo}/avance (presupuesto vs ejecutado — calculado)
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser

router = APIRouter()


TipoFinanciamiento = Literal["CORFO", "PRIVADO", "INTERNO", "FINANCIERO"]
ProyectoEstado = Literal["ACTIVE", "CLOSED", "SUSPENDED"]
TipoGastoCorfo = Literal[
    "RRHH", "OPERACION", "INVERSION", "GASTOS_GENERALES", "NO_ELEGIBLE"
]


class ProyectoContableBase(BaseModel):
    codigo: str = Field(min_length=8, max_length=30, pattern=r"^PRJ-[A-Z]+-[A-Z]+-\d{3}$")
    empresa_codigo: str = Field(min_length=2, max_length=20)
    nombre: str = Field(min_length=2, max_length=200)
    tipo_financiamiento: TipoFinanciamiento
    programa: str | None = Field(default=None, max_length=100)
    fecha_inicio: date | None = None
    fecha_termino: date | None = None
    presupuesto_total: Decimal | None = None
    moneda: Literal["CLP", "UF", "USD", "EUR"] = "CLP"
    primer_desembolso_corfo: date | None = None
    tipos_gasto_elegibles: list[TipoGastoCorfo] = Field(default_factory=list)
    estado: ProyectoEstado = "ACTIVE"


class ProyectoContableCreate(ProyectoContableBase):
    gantt_proyecto_id: int | None = None


class ProyectoContableUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=2, max_length=200)
    tipo_financiamiento: TipoFinanciamiento | None = None
    programa: str | None = Field(default=None, max_length=100)
    fecha_inicio: date | None = None
    fecha_termino: date | None = None
    presupuesto_total: Decimal | None = None
    moneda: Literal["CLP", "UF", "USD", "EUR"] | None = None
    primer_desembolso_corfo: date | None = None
    tipos_gasto_elegibles: list[TipoGastoCorfo] | None = None
    estado: ProyectoEstado | None = None
    gantt_proyecto_id: int | None = None


class ProyectoContableRead(ProyectoContableBase):
    model_config = ConfigDict(from_attributes=True)
    gantt_proyecto_id: int | None
    presupuesto_ejecutado: Decimal | None = None  # calculado on demand


class ProyectoAvance(BaseModel):
    codigo: str
    presupuesto_total: Decimal | None
    presupuesto_ejecutado: Decimal
    porcentaje_ejecutado: float | None
    monto_disponible: Decimal | None
    cantidad_vouchers: int


_PROY_COLS = (
    "codigo, empresa_codigo, nombre, tipo_financiamiento, programa, "
    "fecha_inicio, fecha_termino, presupuesto_total, moneda, "
    "primer_desembolso_corfo, tipos_gasto_elegibles, estado, "
    "gantt_proyecto_id"
)


# =====================================================================
# GET /proyectos-contables — lista filtrable
# =====================================================================


@router.get("/proyectos-contables", response_model=list[ProyectoContableRead])
async def list_proyectos(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str | None = Query(default=None),
    tipo_financiamiento: TipoFinanciamiento | None = Query(default=None),
    estado: ProyectoEstado | None = Query(default=None),
    search: str | None = Query(default=None, max_length=100),
) -> list[ProyectoContableRead]:
    where_parts: list[str] = []
    params: dict[str, Any] = {}

    if empresa_codigo:
        where_parts.append("empresa_codigo = :empresa")
        params["empresa"] = empresa_codigo
    if tipo_financiamiento:
        where_parts.append("tipo_financiamiento = :tipo")
        params["tipo"] = tipo_financiamiento
    if estado:
        where_parts.append("estado = :estado")
        params["estado"] = estado
    if search:
        where_parts.append("(codigo ILIKE :s OR nombre ILIKE :s)")
        params["s"] = f"%{search}%"

    where_sql = " WHERE " + " AND ".join(where_parts) if where_parts else ""

    rows = (
        await db.execute(
            text(
                f"SELECT {_PROY_COLS} FROM core.proyectos_contables{where_sql} "
                "ORDER BY empresa_codigo, codigo"
            ),
            params,
        )
    ).mappings().all()

    return [ProyectoContableRead.model_validate(dict(r)) for r in rows]


# =====================================================================
# GET /proyectos-contables/{codigo}
# =====================================================================


@router.get(
    "/proyectos-contables/{codigo}", response_model=ProyectoContableRead
)
async def get_proyecto(
    user: CurrentUser, db: DBSession, codigo: str
) -> ProyectoContableRead:
    row = (
        await db.execute(
            text(
                f"SELECT {_PROY_COLS} FROM core.proyectos_contables "
                "WHERE codigo = :c"
            ),
            {"c": codigo},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Proyecto {codigo} no encontrado",
        )
    return ProyectoContableRead.model_validate(dict(row))


# =====================================================================
# POST /proyectos-contables
# =====================================================================


@router.post(
    "/proyectos-contables",
    response_model=ProyectoContableRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_proyecto(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    body: ProyectoContableCreate,
) -> ProyectoContableRead:
    # Validar empresa
    empresa_existe = await db.scalar(
        text("SELECT 1 FROM core.empresas WHERE codigo = :c AND activo = TRUE"),
        {"c": body.empresa_codigo},
    )
    if not empresa_existe:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Empresa '{body.empresa_codigo}' no existe o está inactiva",
        )

    try:
        await db.execute(
            text(
                """
                INSERT INTO core.proyectos_contables (
                    codigo, empresa_codigo, nombre, tipo_financiamiento,
                    programa, fecha_inicio, fecha_termino, presupuesto_total,
                    moneda, primer_desembolso_corfo, tipos_gasto_elegibles,
                    estado, gantt_proyecto_id
                ) VALUES (
                    :codigo, :empresa_codigo, :nombre, :tipo_financiamiento,
                    :programa, :fecha_inicio, :fecha_termino, :presupuesto_total,
                    :moneda, :primer_desembolso_corfo,
                    CAST(:tipos_gasto_elegibles AS TEXT[]),
                    :estado, :gantt_proyecto_id
                )
                """
            ),
            body.model_dump(),
        )
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"No se pudo crear el proyecto: {exc}",
        ) from exc

    return await get_proyecto(user, db, body.codigo)


# =====================================================================
# PATCH /proyectos-contables/{codigo}
# =====================================================================


@router.patch(
    "/proyectos-contables/{codigo}",
    response_model=ProyectoContableRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def update_proyecto(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    codigo: str,
    body: ProyectoContableUpdate,
) -> ProyectoContableRead:
    update_data = body.model_dump(exclude_unset=True)
    if not update_data:
        return await get_proyecto(user, db, codigo)

    set_clauses = []
    for k in update_data:
        if k == "tipos_gasto_elegibles":
            set_clauses.append(f"{k} = CAST(:{k} AS TEXT[])")
        else:
            set_clauses.append(f"{k} = :{k}")

    update_data["codigo"] = codigo
    res = await db.execute(
        text(
            f"UPDATE core.proyectos_contables SET {', '.join(set_clauses)}, "
            "updated_at = now() WHERE codigo = :codigo"
        ),
        update_data,
    )
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Proyecto {codigo} no encontrado",
        )
    await db.commit()
    return await get_proyecto(user, db, codigo)


# =====================================================================
# DELETE /proyectos-contables/{codigo}
# =====================================================================


@router.delete(
    "/proyectos-contables/{codigo}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def delete_proyecto(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    codigo: str,
) -> Response:
    """Borra el proyecto. Falla 409 si tiene voucher_lines apuntándole.

    Para "deshabilitar" un proyecto sin perder datos, usar PATCH con
    `estado = 'CLOSED'`.
    """
    has_lines = await db.scalar(
        text(
            "SELECT 1 FROM core.voucher_lines WHERE proyecto_codigo = :c LIMIT 1"
        ),
        {"c": codigo},
    )
    if has_lines:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Proyecto {codigo} tiene movimientos contables imputados. "
                f"Para inactivarlo usar PATCH con estado='CLOSED'."
            ),
        )

    res = await db.execute(
        text("DELETE FROM core.proyectos_contables WHERE codigo = :c"),
        {"c": codigo},
    )
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Proyecto {codigo} no encontrado",
        )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# =====================================================================
# GET /proyectos-contables/{codigo}/avance
# =====================================================================


@router.get(
    "/proyectos-contables/{codigo}/avance", response_model=ProyectoAvance
)
async def proyecto_avance(
    user: CurrentUser, db: DBSession, codigo: str
) -> ProyectoAvance:
    """Calcula presupuesto ejecutado vs total a partir de los vouchers.

    `presupuesto_ejecutado = SUM(voucher_lines.debit) - SUM(voucher_lines.credit)`
    para vouchers tipo COMPRA/EGRESO con status >= APPROVED. (Los DRAFT
    y PENDING no se cuentan, no son ejecuciones reales aún.)
    """
    proy = (
        await db.execute(
            text(
                "SELECT presupuesto_total FROM core.proyectos_contables "
                "WHERE codigo = :c"
            ),
            {"c": codigo},
        )
    ).mappings().first()
    if proy is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Proyecto {codigo} no encontrado",
        )

    row = (
        await db.execute(
            text(
                """
                SELECT
                    COALESCE(SUM(vl.debit) - SUM(vl.credit), 0) AS ejecutado,
                    COUNT(DISTINCT vl.voucher_id)               AS num_vouchers
                FROM core.voucher_lines vl
                INNER JOIN core.vouchers v ON v.voucher_id = vl.voucher_id
                WHERE vl.proyecto_codigo = :c
                  AND v.status IN ('APPROVED', 'EXECUTED', 'SYNCED', 'RECONCILED', 'CLOSED')
                  AND v.tipo IN ('COMPRA', 'EGRESO', 'TRASPASO')
                """
            ),
            {"c": codigo},
        )
    ).mappings().one()

    presupuesto_total = proy["presupuesto_total"]
    ejecutado = row["ejecutado"] or Decimal(0)
    pct = (
        float(ejecutado / presupuesto_total * 100)
        if presupuesto_total and presupuesto_total > 0
        else None
    )
    disponible = (
        presupuesto_total - ejecutado if presupuesto_total else None
    )

    return ProyectoAvance(
        codigo=codigo,
        presupuesto_total=presupuesto_total,
        presupuesto_ejecutado=ejecutado,
        porcentaje_ejecutado=pct,
        monto_disponible=disponible,
        cantidad_vouchers=int(row["num_vouchers"] or 0),
    )
