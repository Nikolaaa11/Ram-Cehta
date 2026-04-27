"""Schemas Pydantic para el módulo de Trabajadores (HR) — V3.

Validaciones clave:
- RUT validado con `validate_rut` y formateado canónicamente vía `format_rut`.
- `tipo_contrato` y `estado` son `Literal[...]` (whitelist exacta) — la DB
  duplica el chequeo con `CHECK` constraints.
- `MarkInactiveRequest` exige `fecha_egreso`: la transición a `inactivo` no
  tiene sentido sin ella (regulación laboral CL).
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.domain.value_objects.rut import format_rut, validate_rut

TipoContrato = Literal["indefinido", "plazo_fijo", "honorarios", "part_time"]
EstadoTrabajador = Literal["activo", "inactivo", "licencia"]
TipoDocumento = Literal[
    "contrato",
    "anexo",
    "dni",
    "cv",
    "liquidacion",
    "finiquito",
    "cert_afp",
    "cert_fonasa",
    "otro",
]


def _validate_rut(v: str | None) -> str | None:
    if v is None or v.strip() == "":
        return None
    if not validate_rut(v):
        raise ValueError(f"RUT inválido: {v!r}")
    return format_rut(v)


def _require_rut(v: str) -> str:
    if not validate_rut(v):
        raise ValueError(f"RUT inválido: {v!r}")
    return format_rut(v)


# ---------------------------------------------------------------------------
# Trabajador
# ---------------------------------------------------------------------------


class TrabajadorBase(BaseModel):
    empresa_codigo: str = Field(..., min_length=1, max_length=64)
    nombre_completo: str = Field(..., min_length=1, max_length=255)
    rut: str = Field(..., min_length=1)
    cargo: str | None = None
    email: str | None = None
    telefono: str | None = None
    fecha_ingreso: date
    fecha_egreso: date | None = None
    sueldo_bruto: Decimal | None = None
    tipo_contrato: TipoContrato | None = None
    estado: EstadoTrabajador = "activo"
    notas: str | None = None

    @field_validator("rut", mode="before")
    @classmethod
    def validate_rut_field(cls, v: str) -> str:
        return _require_rut(v)


class TrabajadorCreate(TrabajadorBase):
    """Body para POST /trabajadores. `dropbox_folder` lo calcula el service."""


class TrabajadorUpdate(BaseModel):
    nombre_completo: str | None = Field(default=None, min_length=1, max_length=255)
    rut: str | None = None
    cargo: str | None = None
    email: str | None = None
    telefono: str | None = None
    fecha_ingreso: date | None = None
    fecha_egreso: date | None = None
    sueldo_bruto: Decimal | None = None
    tipo_contrato: TipoContrato | None = None
    estado: EstadoTrabajador | None = None
    notas: str | None = None

    @field_validator("rut", mode="before")
    @classmethod
    def validate_rut_field(cls, v: str | None) -> str | None:
        return _validate_rut(v)


class MarkInactiveRequest(BaseModel):
    """Marca a un trabajador como inactivo. La fecha de egreso es obligatoria."""

    fecha_egreso: date
    motivo: str | None = None


# ---------------------------------------------------------------------------
# Trabajador Documento
# ---------------------------------------------------------------------------


class TrabajadorDocumentoRead(BaseModel):
    documento_id: int
    trabajador_id: int
    tipo: str
    nombre_archivo: str
    dropbox_path: str
    tamano_bytes: int | None = None
    uploaded_by: str | None = None
    uploaded_at: datetime
    metadata_: dict[str, Any] | None = Field(default=None, alias="metadata_")

    model_config = {"from_attributes": True, "populate_by_name": True}


# ---------------------------------------------------------------------------
# Read / List
# ---------------------------------------------------------------------------


class TrabajadorRead(BaseModel):
    trabajador_id: int
    empresa_codigo: str
    nombre_completo: str
    rut: str
    cargo: str | None = None
    email: str | None = None
    telefono: str | None = None
    fecha_ingreso: date
    fecha_egreso: date | None = None
    sueldo_bruto: Decimal | None = None
    tipo_contrato: str | None = None
    estado: str
    dropbox_folder: str | None = None
    notas: str | None = None
    created_at: datetime
    updated_at: datetime
    documentos: list[TrabajadorDocumentoRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class TrabajadorListItem(BaseModel):
    """Vista resumida para listados (sin documentos / sueldo / notas)."""

    trabajador_id: int
    empresa_codigo: str
    nombre_completo: str
    rut: str
    cargo: str | None = None
    fecha_ingreso: date
    fecha_egreso: date | None = None
    tipo_contrato: str | None = None
    estado: str

    model_config = {"from_attributes": True}
