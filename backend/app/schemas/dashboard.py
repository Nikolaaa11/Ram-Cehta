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
