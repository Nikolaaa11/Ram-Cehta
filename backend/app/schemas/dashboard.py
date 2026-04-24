from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel


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
