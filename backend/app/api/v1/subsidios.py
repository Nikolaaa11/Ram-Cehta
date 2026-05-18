"""Endpoints CRUD + reporteria de Subsidios (Round 83).

Vinculados al Bloque E del prompt_v2_voucher_claudia.md. Un subsidio es
un aporte de un tercero (tipicamente CORFO) que financia uno o varios
proyectos. Cuando varios proyectos comparten el mismo subsidio, las
empresas que los ejecutan se llaman "coejecutores".

Endpoints:
  GET    /subsidios                       — lista filtrable
  GET    /subsidios/{codigo}              — detalle + summary de ejecucion
  GET    /subsidios/{codigo}/ejecucion    — desglose por empresa coejecutora
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession

router = APIRouter()


SubsidioEstado = Literal["ACTIVO", "CERRADO", "SUSPENDIDO"]


class SubsidioRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    subsidio_codigo: str
    programa: str
    nombre: str
    monto_total: Decimal
    entidad_otorgante: str
    estado: SubsidioEstado
    fecha_inicio: date | None
    fecha_termino: date | None
    notas: str | None


class EjecucionPorEmpresa(BaseModel):
    empresa_codigo: str
    empresa_razon_social: str | None
    proyectos: list[str]  # codigos de proyectos de esta empresa
    presupuesto_asignado: Decimal
    ejecutado_corfo: Decimal
    ejecutado_ptec: Decimal
    ejecutado_empresa_directa: Decimal
    ejecutado_total: Decimal
    cantidad_vouchers: int


class SubsidioEjecucion(BaseModel):
    """Resumen Round 83 — "donde estan las platas del subsidio"."""

    subsidio_codigo: str
    nombre: str
    monto_total: Decimal
    presupuesto_total_asignado: Decimal
    ejecutado_total: Decimal
    disponible_total: Decimal
    porcentaje_ejecutado: float
    coejecutores: list[EjecucionPorEmpresa]


@router.get("/subsidios", response_model=list[SubsidioRead])
async def list_subsidios(
    user: CurrentUser,
    db: DBSession,
    estado: SubsidioEstado | None = Query(default=None),
) -> list[SubsidioRead]:
    """Lista de subsidios. Cualquier user autenticado puede leer
    (no contiene PII, solo metadata del programa)."""
    _ = user
    where_parts = []
    params: dict = {}
    if estado:
        where_parts.append("estado = :estado")
        params["estado"] = estado
    where_sql = " WHERE " + " AND ".join(where_parts) if where_parts else ""
    rows = (
        await db.execute(
            text(
                f"""
                SELECT subsidio_codigo, programa, nombre, monto_total,
                       entidad_otorgante, estado, fecha_inicio,
                       fecha_termino, notas
                FROM core.subsidios{where_sql}
                ORDER BY subsidio_codigo
                """
            ),
            params,
        )
    ).mappings().all()
    return [SubsidioRead.model_validate(dict(r)) for r in rows]


@router.get("/subsidios/{codigo}", response_model=SubsidioRead)
async def get_subsidio(
    user: CurrentUser, db: DBSession, codigo: str
) -> SubsidioRead:
    _ = user
    row = (
        await db.execute(
            text(
                """
                SELECT subsidio_codigo, programa, nombre, monto_total,
                       entidad_otorgante, estado, fecha_inicio,
                       fecha_termino, notas
                FROM core.subsidios WHERE subsidio_codigo = :c
                """
            ),
            {"c": codigo},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Subsidio {codigo} no encontrado",
        )
    return SubsidioRead.model_validate(dict(row))


@router.get(
    "/subsidios/{codigo}/ejecucion", response_model=SubsidioEjecucion
)
async def get_ejecucion_subsidio(
    user: CurrentUser, db: DBSession, codigo: str
) -> SubsidioEjecucion:
    """Desglose Round 83: "donde estan las platas del subsidio".

    Agrupa los voucher_lines.fuente_financiamiento de los proyectos que
    comparten el `subsidio_codigo` por empresa coejecutora. Devuelve:
      - monto total del subsidio
      - presupuesto total asignado (suma de presupuesto_total de
        cada proyecto)
      - ejecutado total + disponible
      - por cada empresa coejecutora: sus proyectos, presupuesto,
        ejecutado por fuente (CORFO/P-tec/Empresa), total y count.

    Filtra solo vouchers en estados ejecutados (APPROVED+).
    """
    _ = user
    sub = (
        await db.execute(
            text(
                "SELECT subsidio_codigo, nombre, monto_total "
                "FROM core.subsidios WHERE subsidio_codigo = :c"
            ),
            {"c": codigo},
        )
    ).mappings().first()
    if sub is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Subsidio {codigo} no encontrado",
        )

    # Proyectos del subsidio + razon social de la empresa
    proy_rows = (
        await db.execute(
            text(
                """
                SELECT pc.codigo, pc.empresa_codigo, pc.presupuesto_total,
                       e.razon_social AS empresa_razon_social
                FROM core.proyectos_contables pc
                LEFT JOIN core.empresas e ON e.codigo = pc.empresa_codigo
                WHERE pc.subsidio_codigo = :c
                ORDER BY pc.empresa_codigo, pc.codigo
                """
            ),
            {"c": codigo},
        )
    ).mappings().all()

    if not proy_rows:
        return SubsidioEjecucion(
            subsidio_codigo=sub["subsidio_codigo"],
            nombre=sub["nombre"],
            monto_total=sub["monto_total"],
            presupuesto_total_asignado=Decimal("0"),
            ejecutado_total=Decimal("0"),
            disponible_total=sub["monto_total"],
            porcentaje_ejecutado=0.0,
            coejecutores=[],
        )

    proyectos_codigos = [p["codigo"] for p in proy_rows]

    # Bulk: ejecutado por proyecto + fuente
    ejec_rows = (
        await db.execute(
            text(
                """
                SELECT vl.proyecto_codigo, vl.fuente_financiamiento,
                       COALESCE(SUM(vl.debit), 0) AS monto,
                       COUNT(DISTINCT vl.voucher_id) AS num_vouchers
                FROM core.voucher_lines vl
                JOIN core.vouchers v ON v.voucher_id = vl.voucher_id
                WHERE vl.proyecto_codigo = ANY(:codigos)
                  AND v.status IN ('APPROVED','EXECUTED','SYNCED',
                                   'RECONCILED','CLOSED')
                GROUP BY vl.proyecto_codigo, vl.fuente_financiamiento
                """
            ),
            {"codigos": proyectos_codigos},
        )
    ).mappings().all()

    # Estructura: empresa_codigo -> agregado
    by_empresa: dict[str, dict] = {}
    for p in proy_rows:
        emp = p["empresa_codigo"]
        if emp not in by_empresa:
            by_empresa[emp] = {
                "empresa_codigo": emp,
                "empresa_razon_social": p["empresa_razon_social"],
                "proyectos": [],
                "presupuesto_asignado": Decimal("0"),
                "ejecutado_corfo": Decimal("0"),
                "ejecutado_ptec": Decimal("0"),
                "ejecutado_empresa_directa": Decimal("0"),
                "ejecutado_total": Decimal("0"),
                "cantidad_vouchers": 0,
            }
        by_empresa[emp]["proyectos"].append(p["codigo"])
        if p["presupuesto_total"]:
            by_empresa[emp]["presupuesto_asignado"] += p["presupuesto_total"]

    # Mapeo proyecto -> empresa para asignar la ejecucion
    proy_to_emp = {p["codigo"]: p["empresa_codigo"] for p in proy_rows}
    vouchers_per_proj: dict[str, set] = {}

    for r in ejec_rows:
        emp = proy_to_emp.get(r["proyecto_codigo"])
        if not emp:
            continue
        monto = Decimal(str(r["monto"] or 0))
        fuente = r["fuente_financiamiento"]
        if fuente == "CORFO_SUBSIDIO":
            by_empresa[emp]["ejecutado_corfo"] += monto
        elif fuente == "PTEC_CEHTA":
            by_empresa[emp]["ejecutado_ptec"] += monto
        elif fuente == "EMPRESA_DIRECTA":
            by_empresa[emp]["ejecutado_empresa_directa"] += monto
        # IVA_CORPORATIVO y NA no suman al ejecutado del subsidio
        if fuente in ("CORFO_SUBSIDIO", "PTEC_CEHTA", "EMPRESA_DIRECTA"):
            by_empresa[emp]["ejecutado_total"] += monto
        vouchers_per_proj.setdefault(r["proyecto_codigo"], set())

    # Count distinct vouchers por empresa (re-query barata)
    cnt_rows = (
        await db.execute(
            text(
                """
                SELECT pc.empresa_codigo,
                       COUNT(DISTINCT vl.voucher_id) AS cant
                FROM core.voucher_lines vl
                JOIN core.vouchers v ON v.voucher_id = vl.voucher_id
                JOIN core.proyectos_contables pc
                  ON pc.codigo = vl.proyecto_codigo
                WHERE vl.proyecto_codigo = ANY(:codigos)
                  AND v.status IN ('APPROVED','EXECUTED','SYNCED',
                                   'RECONCILED','CLOSED')
                GROUP BY pc.empresa_codigo
                """
            ),
            {"codigos": proyectos_codigos},
        )
    ).mappings().all()
    for r in cnt_rows:
        if r["empresa_codigo"] in by_empresa:
            by_empresa[r["empresa_codigo"]]["cantidad_vouchers"] = int(
                r["cant"] or 0
            )

    coejecutores = [
        EjecucionPorEmpresa(**v) for v in by_empresa.values()
    ]
    presupuesto_total_asignado = sum(
        (c.presupuesto_asignado for c in coejecutores), Decimal("0")
    )
    ejecutado_total = sum(
        (c.ejecutado_total for c in coejecutores), Decimal("0")
    )
    disponible = sub["monto_total"] - ejecutado_total
    pct = (
        float(ejecutado_total / sub["monto_total"] * 100)
        if sub["monto_total"] > 0
        else 0.0
    )

    return SubsidioEjecucion(
        subsidio_codigo=sub["subsidio_codigo"],
        nombre=sub["nombre"],
        monto_total=sub["monto_total"],
        presupuesto_total_asignado=presupuesto_total_asignado,
        ejecutado_total=ejecutado_total,
        disponible_total=disponible,
        porcentaje_ejecutado=pct,
        coejecutores=coejecutores,
    )
