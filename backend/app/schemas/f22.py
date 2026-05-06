"""Schemas Pydantic para F22 — declaración anual de impuesto a la renta."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator

F22Estado = Literal["pendiente", "pagado", "vencido", "prorrogado", "exento"]


class F22Create(BaseModel):
    empresa_codigo: str
    ano_tributario: int = Field(..., ge=2000, le=2100)
    fecha_vencimiento: date
    monto_a_pagar: Decimal | None = None
    estado: F22Estado = "pendiente"
    notas: str | None = None


class F22Update(BaseModel):
    """PATCH /f22/{id} — edición parcial.

    Reglas:
    - Si estado=='pagado', `fecha_pago` es obligatoria.
    - Si estado!='pagado', `fecha_pago` puede ser None.
    """

    estado: F22Estado | None = None
    fecha_pago: date | None = None
    fecha_vencimiento: date | None = None
    comprobante_url: str | None = None
    monto_a_pagar: Decimal | None = None
    notas: str | None = None

    @model_validator(mode="after")
    def _check_pago_consistente(self) -> "F22Update":
        if self.estado == "pagado" and self.fecha_pago is None:
            raise ValueError("estado='pagado' requiere fecha_pago no nula")
        return self


class F22EstadoUpdate(BaseModel):
    """Marcar pagado / prorrogado en un solo POST."""

    estado: F22Estado
    fecha_pago: date | None = None
    comprobante_url: str | None = None


class F22Read(BaseModel):
    f22_id: int
    empresa_codigo: str
    ano_tributario: int
    fecha_vencimiento: date
    monto_a_pagar: Decimal | None
    fecha_pago: date | None
    estado: str
    comprobante_url: str | None
    dropbox_path: str | None
    notas: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
