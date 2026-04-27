from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.domain.value_objects.iva import calcular_iva


class OCDetalleCreate(BaseModel):
    item: int = Field(..., ge=1)
    descripcion: str = Field(..., min_length=1)
    precio_unitario: Decimal = Field(..., gt=0)
    cantidad: Decimal = Field(..., gt=0)


class OCDetalleRead(BaseModel):
    detalle_id: int
    item: int
    descripcion: str
    precio_unitario: Decimal
    cantidad: Decimal
    total_linea: Decimal | None

    model_config = {"from_attributes": True}


class OrdenCompraCreate(BaseModel):
    numero_oc: str = Field(..., min_length=1, max_length=50)
    empresa_codigo: str
    proveedor_id: int | None = None
    fecha_emision: date
    validez_dias: int = Field(default=30, ge=1)
    moneda: Literal["CLP", "UF", "USD"] = "CLP"
    neto: Decimal = Field(..., gt=0)
    forma_pago: str | None = None
    plazo_pago: str | None = None
    observaciones: str | None = None
    items: list[OCDetalleCreate] = Field(..., min_length=1)

    @model_validator(mode="after")
    def compute_totals(self) -> "OrdenCompraCreate":
        return self

    @property
    def iva_calculado(self) -> Decimal:
        return calcular_iva(self.neto) if self.moneda == "CLP" else Decimal("0")

    @property
    def total_calculado(self) -> Decimal:
        return self.neto + self.iva_calculado


class OrdenCompraRead(BaseModel):
    oc_id: int
    numero_oc: str
    empresa_codigo: str
    proveedor_id: int | None
    fecha_emision: date
    validez_dias: int
    moneda: str
    neto: Decimal
    iva: Decimal
    total: Decimal
    forma_pago: str | None
    plazo_pago: str | None
    observaciones: str | None
    estado: str
    pdf_url: str | None
    items: list[OCDetalleRead]
    created_at: datetime
    updated_at: datetime
    allowed_actions: list[str] = []

    model_config = {"from_attributes": True}


class OrdenCompraListItem(BaseModel):
    oc_id: int
    numero_oc: str
    empresa_codigo: str
    proveedor_id: int | None
    fecha_emision: date
    moneda: str
    neto: Decimal
    total: Decimal
    estado: str
    pdf_url: str | None
    allowed_actions: list[str] = []

    model_config = {"from_attributes": True}


class EstadoUpdateRequest(BaseModel):
    estado: Literal["emitida", "pagada", "anulada", "parcial"]


class OrdenCompraUpdate(BaseModel):
    """PATCH /ordenes-compra/{id} — edición de campos no-críticos.

    Sólo permite editar campos operativos. Los campos críticos
    (numero_oc, empresa_codigo, fecha_emision, neto, iva, total, estado)
    NO se pueden modificar acá: 'numero_oc' rompería trazabilidad,
    los montos se recalculan al crear, y 'estado' tiene su propio endpoint
    `PATCH /{id}/estado` con validación de transiciones.

    Si el body trae alguno de esos campos, son ignorados (extra='ignore'
    por default en pydantic v2). Si querés que sea hard-fail, cambiar a
    `model_config = {"extra": "forbid"}`.
    """

    forma_pago: str | None = None
    plazo_pago: str | None = None
    validez_dias: int | None = Field(default=None, ge=1)
    observaciones: str | None = None
    pdf_url: str | None = None

    model_config = {"extra": "ignore"}
