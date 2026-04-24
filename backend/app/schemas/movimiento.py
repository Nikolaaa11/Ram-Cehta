from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


class MovimientoRead(BaseModel):
    movimiento_id: int
    fecha: date
    descripcion: str | None
    abono: Decimal
    egreso: Decimal
    saldo_contable: Decimal | None
    saldo_cehta: Decimal | None
    saldo_corfo: Decimal | None
    concepto_general: str | None
    concepto_detallado: str | None
    tipo_egreso: str | None
    fuente: str | None
    proyecto: str | None
    banco: str | None
    real_proyectado: str | None
    anio: int
    periodo: str
    empresa_codigo: str
    iva_credito_fiscal: Decimal
    iva_debito_fiscal: Decimal
    tipo_documento: str | None
    numero_documento: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
