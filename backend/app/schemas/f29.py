from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel


class F29Create(BaseModel):
    empresa_codigo: str
    periodo_tributario: str
    fecha_vencimiento: date
    monto_a_pagar: Decimal | None = None
    estado: Literal["pendiente", "pagado", "vencido", "exento"] = "pendiente"


class F29EstadoUpdate(BaseModel):
    estado: Literal["pendiente", "pagado", "vencido", "exento"]
    fecha_pago: date | None = None
    comprobante_url: str | None = None


class F29Read(BaseModel):
    f29_id: int
    empresa_codigo: str
    periodo_tributario: str
    fecha_vencimiento: date
    monto_a_pagar: Decimal | None
    fecha_pago: date | None
    estado: str
    comprobante_url: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
