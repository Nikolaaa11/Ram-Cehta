from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, model_validator


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


class F29Update(BaseModel):
    """PATCH /f29/{id} — edición parcial.

    Reglas cross-field (model_validator):
    - Si estado=='pagado', `fecha_pago` es obligatoria (no None).
    - Si estado!='pagado', `fecha_pago` puede ser None (limpieza permitida).
    """

    estado: Literal["pendiente", "pagado", "vencido", "exento"] | None = None
    fecha_pago: date | None = None
    comprobante_url: str | None = None
    monto_a_pagar: Decimal | None = None

    @model_validator(mode="after")
    def _check_pago_consistente(self) -> "F29Update":
        if self.estado == "pagado" and self.fecha_pago is None:
            raise ValueError(
                "estado='pagado' requiere fecha_pago no nula"
            )
        return self


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
