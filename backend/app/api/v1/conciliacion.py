"""Endpoints de conciliación bancaria (V5 Fase 5).

  GET  /admin/conciliacion/summary?empresa=X
  GET  /admin/conciliacion/no-conciliados?empresa=X&fecha_desde&fecha_hasta
  GET  /admin/conciliacion/movimientos-huerfanos?empresa=X
  POST /admin/conciliacion/auto-run                  (legal:write)
  GET  /vouchers/{id}/match-candidates
  POST /vouchers/{id}/reconcile {movimiento_id}      (legal:write)
  POST /vouchers/{id}/unreconcile                    (legal:write)
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.services.conciliacion_service import (
    auto_reconcile,
    find_match_candidates,
    get_summary,
    link_voucher_to_movimiento,
    list_movimientos_huerfanos,
    list_no_conciliados,
    unlink_voucher_movimiento,
)

router = APIRouter()


class ConciliacionSummary(BaseModel):
    no_conciliados: int
    conciliados: int
    movimientos_huerfanos: int
    monto_pendiente: Decimal


class VoucherNoConciliado(BaseModel):
    voucher_id: int
    codigo: str
    tipo: str
    fecha_contable: date
    fecha_ejecucion: date | None
    glosa: str
    contraparte_nombre: str | None
    contraparte_rut: str | None
    total_debit: Decimal
    moneda: str


class MovimientoHuerfano(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    movimiento_id: int
    fecha: date
    descripcion: str | None
    monto: Decimal
    banco: str | None
    tipo_egreso: str | None
    proveedor_id: int | None
    proveedor_nombre: str | None


class MatchCandidate(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    movimiento_id: int
    fecha: date
    descripcion: str | None
    monto: Decimal
    banco: str | None
    tipo_egreso: str | None
    proveedor_id: int | None
    proveedor_nombre: str | None


class AutoRunRequest(BaseModel):
    empresa_codigo: str = Field(min_length=2, max_length=20)
    fecha_desde: date | None = None
    fecha_hasta: date | None = None
    window_days: int = Field(default=3, ge=0, le=30)


class AutoRunReport(BaseModel):
    vouchers_evaluados: int
    matched_unico: int
    matched_ambiguo: int
    sin_candidatos: int
    matches: list[dict[str, Any]]


class ReconcileRequest(BaseModel):
    movimiento_id: int


class ReconcileResponse(BaseModel):
    voucher_id: int
    voucher_codigo: str
    movimiento_id: int
    monto: Decimal
    fecha_movimiento: date
    auto_match: bool


# =====================================================================
# Endpoints
# =====================================================================


@router.get(
    "/admin/conciliacion/summary", response_model=ConciliacionSummary
)
async def conciliacion_summary(
    user: CurrentUser,
    db: DBSession,
    empresa: Annotated[str, Query(min_length=2, max_length=20)],
) -> ConciliacionSummary:
    return ConciliacionSummary.model_validate(
        await get_summary(db, empresa_codigo=empresa)
    )


@router.get(
    "/admin/conciliacion/no-conciliados",
    response_model=list[VoucherNoConciliado],
)
async def get_no_conciliados(
    user: CurrentUser,
    db: DBSession,
    empresa: Annotated[str, Query(min_length=2, max_length=20)],
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[VoucherNoConciliado]:
    rows = await list_no_conciliados(
        db,
        empresa_codigo=empresa,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        limit=limit,
    )
    return [VoucherNoConciliado.model_validate(r) for r in rows]


@router.get(
    "/admin/conciliacion/movimientos-huerfanos",
    response_model=list[MovimientoHuerfano],
)
async def get_movimientos_huerfanos(
    user: CurrentUser,
    db: DBSession,
    empresa: Annotated[str, Query(min_length=2, max_length=20)],
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[MovimientoHuerfano]:
    rows = await list_movimientos_huerfanos(
        db,
        empresa_codigo=empresa,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        limit=limit,
    )
    return [MovimientoHuerfano.model_validate(r) for r in rows]


@router.post(
    "/admin/conciliacion/auto-run",
    response_model=AutoRunReport,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def auto_run_conciliacion(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    body: AutoRunRequest,
) -> AutoRunReport:
    """Corre el algoritmo de match automático sobre vouchers EXECUTED.

    Vouchers con 1 candidato exacto se conciliam automáticamente.
    Vouchers con 0 o >1 candidatos quedan para revisión manual.
    """
    report = await auto_reconcile(
        db,
        empresa_codigo=body.empresa_codigo,
        fecha_desde=body.fecha_desde,
        fecha_hasta=body.fecha_hasta,
        window_days=body.window_days,
    )
    await db.commit()
    return AutoRunReport.model_validate(report)


@router.get(
    "/vouchers/{voucher_id}/match-candidates",
    response_model=list[MatchCandidate],
)
async def get_match_candidates(
    user: CurrentUser,
    db: DBSession,
    voucher_id: int,
    window_days: int = Query(default=3, ge=0, le=30),
) -> list[MatchCandidate]:
    """Lista candidatos de movimiento para conciliar manualmente este voucher."""
    rows = await find_match_candidates(
        db, voucher_id=voucher_id, window_days=window_days
    )
    return [MatchCandidate.model_validate(r) for r in rows]


@router.post(
    "/vouchers/{voucher_id}/reconcile",
    response_model=ReconcileResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def reconcile_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    voucher_id: int,
    body: ReconcileRequest,
) -> ReconcileResponse:
    try:
        result = await link_voucher_to_movimiento(
            db,
            voucher_id=voucher_id,
            movimiento_id=body.movimiento_id,
            auto_match=False,
        )
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return ReconcileResponse.model_validate(result)


@router.post(
    "/vouchers/{voucher_id}/unreconcile",
    dependencies=[Depends(require_scope("legal:write"))],
)
async def unreconcile_voucher(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    voucher_id: int,
) -> dict[str, Any]:
    try:
        result = await unlink_voucher_movimiento(db, voucher_id=voucher_id)
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return result
