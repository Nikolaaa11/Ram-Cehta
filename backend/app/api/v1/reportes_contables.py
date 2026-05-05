"""Endpoints de reportes contables formales (V5 Fase 4).

Consume el service `reportes_contables_service` y devuelve JSON
estructurado para que el frontend renderice + permita print/PDF.

Endpoints:
  GET /reportes/contables/libro-diario       (empresa + rango fechas)
  GET /reportes/contables/libro-mayor        (empresa + cuenta + rango)
  GET /reportes/contables/pl-proyecto        (empresa + rango)
  GET /reportes/contables/pl-area            (empresa + rango)
  GET /reportes/contables/rendicion-corfo    (proyecto + rango)
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.api.deps import CurrentUser, DBSession
from app.services.reportes_contables_service import (
    libro_diario,
    libro_mayor,
    pl_por_area,
    pl_por_proyecto,
    rendicion_corfo,
)

router = APIRouter()


class LibroDiarioRow(BaseModel):
    voucher_id: int
    voucher_codigo: str
    voucher_tipo: str
    fecha_contable: date
    glosa: str
    contraparte_nombre: str | None
    line_number: int
    cuenta_codigo: str
    cuenta_nombre: str
    proyecto_codigo: str | None
    area_codigo: str | None
    debit: Decimal
    credit: Decimal
    linea_descripcion: str | None


class LibroMayorMovimiento(BaseModel):
    voucher_id: int
    voucher_codigo: str
    fecha_contable: date
    glosa: str
    contraparte_nombre: str | None
    line_number: int
    linea_descripcion: str | None
    proyecto_codigo: str | None
    area_codigo: str | None
    debit: Decimal
    credit: Decimal


class CuentaMeta(BaseModel):
    codigo: str
    nombre: str
    tipo: str
    nivel: int


class LibroMayorReport(BaseModel):
    cuenta: CuentaMeta | None
    fecha_desde: date
    fecha_hasta: date
    saldo_apertura: Decimal
    total_debe: Decimal
    total_haber: Decimal
    saldo_cierre: Decimal
    movimientos: list[LibroMayorMovimiento]


class PLProyectoRow(BaseModel):
    proyecto_codigo: str
    proyecto_nombre: str
    tipo_financiamiento: str | None
    ingresos: Decimal
    gastos: Decimal
    resultado: Decimal


class PLAreaRow(BaseModel):
    area_codigo: str
    area_nombre: str
    ingresos: Decimal
    gastos: Decimal
    resultado: Decimal


class RendicionCorfoLinea(BaseModel):
    voucher_codigo: str
    fecha_contable: date
    glosa: str
    contraparte_nombre: str | None
    contraparte_rut: str | None
    doc_tributario_tipo: str | None
    doc_tributario_folio: str | None
    line_number: int
    cuenta_codigo: str
    cuenta_nombre: str
    tipo_gasto_corfo: str | None
    area_codigo: str | None
    debit: Decimal
    credit: Decimal
    linea_descripcion: str | None


class RendicionCorfoTipoGasto(BaseModel):
    tipo_gasto: str
    monto: Decimal


class RendicionCorfoProyectoMeta(BaseModel):
    codigo: str
    empresa_codigo: str
    nombre: str
    tipo_financiamiento: str
    programa: str | None
    presupuesto_total: Decimal | None
    primer_desembolso_corfo: date | None
    tipos_gasto_elegibles: list[str]


class RendicionCorfoReport(BaseModel):
    proyecto: RendicionCorfoProyectoMeta | None
    fecha_desde: date | None = None
    fecha_hasta: date | None = None
    lineas: list[RendicionCorfoLinea]
    desglose_por_tipo_gasto: list[RendicionCorfoTipoGasto]
    total: Decimal


# =====================================================================
# Endpoints
# =====================================================================


@router.get(
    "/reportes/contables/libro-diario",
    response_model=list[LibroDiarioRow],
)
async def get_libro_diario(
    user: CurrentUser,
    db: DBSession,
    empresa: Annotated[str, Query(min_length=2, max_length=20)],
    fecha_desde: Annotated[date, Query()],
    fecha_hasta: Annotated[date, Query()],
) -> list[LibroDiarioRow]:
    rows = await libro_diario(
        db,
        empresa_codigo=empresa,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
    )
    return [LibroDiarioRow.model_validate(r) for r in rows]


@router.get(
    "/reportes/contables/libro-mayor",
    response_model=LibroMayorReport,
)
async def get_libro_mayor(
    user: CurrentUser,
    db: DBSession,
    empresa: Annotated[str, Query(min_length=2, max_length=20)],
    cuenta: Annotated[str, Query(min_length=1)],
    fecha_desde: Annotated[date, Query()],
    fecha_hasta: Annotated[date, Query()],
) -> LibroMayorReport:
    data = await libro_mayor(
        db,
        empresa_codigo=empresa,
        cuenta_codigo=cuenta,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
    )
    return LibroMayorReport.model_validate(data)


@router.get(
    "/reportes/contables/pl-proyecto",
    response_model=list[PLProyectoRow],
)
async def get_pl_proyecto(
    user: CurrentUser,
    db: DBSession,
    empresa: Annotated[str, Query(min_length=2, max_length=20)],
    fecha_desde: Annotated[date, Query()],
    fecha_hasta: Annotated[date, Query()],
) -> list[PLProyectoRow]:
    rows = await pl_por_proyecto(
        db,
        empresa_codigo=empresa,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
    )
    return [PLProyectoRow.model_validate(r) for r in rows]


@router.get(
    "/reportes/contables/pl-area",
    response_model=list[PLAreaRow],
)
async def get_pl_area(
    user: CurrentUser,
    db: DBSession,
    empresa: Annotated[str, Query(min_length=2, max_length=20)],
    fecha_desde: Annotated[date, Query()],
    fecha_hasta: Annotated[date, Query()],
) -> list[PLAreaRow]:
    rows = await pl_por_area(
        db,
        empresa_codigo=empresa,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
    )
    return [PLAreaRow.model_validate(r) for r in rows]


@router.get(
    "/reportes/contables/rendicion-corfo",
    response_model=RendicionCorfoReport,
)
async def get_rendicion_corfo(
    user: CurrentUser,
    db: DBSession,
    proyecto: Annotated[str, Query(min_length=8)],
    fecha_desde: Annotated[date, Query()],
    fecha_hasta: Annotated[date, Query()],
) -> RendicionCorfoReport:
    data = await rendicion_corfo(
        db,
        proyecto_codigo=proyecto,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
    )
    return RendicionCorfoReport.model_validate(data)
