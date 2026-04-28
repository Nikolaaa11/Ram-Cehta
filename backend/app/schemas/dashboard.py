from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


# =====================================================================
# Esquemas existentes (compatibilidad con GET /dashboard)
# =====================================================================
class SaldoEmpresa(BaseModel):
    empresa_codigo: str
    razon_social: str
    saldo_cehta: Decimal | None
    saldo_corfo: Decimal | None
    saldo_contable: Decimal | None
    periodo: str | None


class MovimientoReciente(BaseModel):
    movimiento_id: int
    fecha: str
    empresa_codigo: str
    descripcion: str | None
    abono: Decimal
    egreso: Decimal
    concepto_general: str | None
    proyecto: str | None


class OCResumen(BaseModel):
    total_emitidas: int
    monto_total_emitidas: Decimal
    total_pagadas: int
    monto_total_pagadas: Decimal
    total_anuladas: int


class F29Resumen(BaseModel):
    empresa_codigo: str
    periodo_tributario: str
    fecha_vencimiento: str
    monto_a_pagar: Decimal | None
    estado: str


class DashboardResponse(BaseModel):
    saldos_por_empresa: list[SaldoEmpresa]
    movimientos_recientes: list[MovimientoReciente]
    oc_resumen: OCResumen
    f29_pendientes: list[F29Resumen]
    periodo_actual: str


# =====================================================================
# Nuevos esquemas — dashboard ultra-pro
# =====================================================================
class DashboardKPIs(BaseModel):
    """Hero stats del dashboard. Todo lo necesario para 6 tarjetas grandes."""

    saldo_total_consolidado: Decimal
    saldo_total_cehta: Decimal
    saldo_total_corfo: Decimal

    egreso_mes_actual: Decimal
    egreso_mes_anterior: Decimal
    egreso_delta_pct: float

    abono_mes_actual: Decimal
    abono_mes_anterior: Decimal
    abono_delta_pct: float

    flujo_neto_mes: Decimal
    iva_a_pagar_mes: Decimal

    oc_emitidas_pendientes: int
    monto_oc_pendiente: Decimal

    f29_proximas_30d: int
    f29_vencidas: int

    ultimo_etl_run: datetime | None
    etl_status: str  # 'success' | 'failed' | 'stale' | 'never'


class CashflowPoint(BaseModel):
    periodo: str           # "MM_YY"
    fecha_inicio: date     # primer día del periodo (para xAxis)
    abono_real: Decimal
    egreso_real: Decimal
    abono_proyectado: Decimal
    egreso_proyectado: Decimal
    flujo_neto_real: Decimal
    flujo_neto_proyectado: Decimal
    saldo_acumulado: Decimal


class CashflowResponse(BaseModel):
    empresa_codigo: str | None  # None = consolidado
    points: list[CashflowPoint]


class EgresoConcepto(BaseModel):
    concepto_general: str
    concepto_detallado: str | None
    total_egreso: Decimal
    porcentaje: float
    num_movimientos: int


class SaldoEmpresaDetalle(BaseModel):
    empresa_codigo: str
    razon_social: str
    saldo_contable: Decimal | None
    saldo_cehta: Decimal | None
    saldo_corfo: Decimal | None
    ultima_actualizacion: date | None
    delta_30d: Decimal


class IvaPoint(BaseModel):
    periodo: str
    fecha_inicio: date
    iva_credito: Decimal
    iva_debito: Decimal
    iva_a_pagar: Decimal


class ProyectoRanking(BaseModel):
    proyecto: str
    total_egreso: Decimal
    num_movimientos: int
    empresas: list[str]


# =====================================================================
# CEO Dashboard — V3 fase 3+4 (vista consolidada del portafolio)
# =====================================================================
class EmpresaCEOKPIs(BaseModel):
    """KPIs por empresa para el comparador del CEO Dashboard."""

    empresa_codigo: str
    razon_social: str
    saldo_contable: Decimal
    flujo_neto_30d: Decimal
    oc_pendientes: int
    monto_oc_pendiente: Decimal
    f29_proximas: int
    f29_vencidas: int
    health_score: int  # 0-100; >=80 ok, 60-79 warning, <60 crítico
    trend: str  # 'up' | 'flat' | 'down'


class HeatmapCell(BaseModel):
    """Celda del heatmap empresa × KPI.

    `kpi` ∈ {saldo, flujo, oc, f29, etl, audit}
    `value` 0-100
    `color` ∈ {green, yellow, red}
    """

    empresa_codigo: str
    kpi: str
    value: int
    color: str


class Alert(BaseModel):
    """Alerta priorizada para el panel del CEO."""

    severity: str  # 'critical' | 'warning' | 'info'
    empresa_codigo: str | None = None
    title: str
    detail: str
    href: str | None = None  # link sugerido para resolver


class CEOConsolidatedReport(BaseModel):
    """Reporte consolidado para Dashboard CEO."""

    aum_total: Decimal
    aum_cehta: Decimal
    aum_corfo: Decimal
    delta_30d: float       # cambio porcentual del AUM últimos 30d
    delta_90d: float       # cambio porcentual del AUM últimos 90d
    flujo_neto_30d: Decimal

    by_empresa: list[EmpresaCEOKPIs]
    heatmap: list[HeatmapCell]
    top_alerts: list[Alert]
    insights_ai: str       # placeholder texto generado (Q AI fase futura)
    last_updated: datetime
