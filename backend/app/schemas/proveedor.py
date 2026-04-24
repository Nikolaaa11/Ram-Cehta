from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.domain.value_objects.rut import format_rut, validate_rut


def _validate_rut(v: str | None) -> str | None:
    if v is None or v.strip() == "":
        return None
    if not validate_rut(v):
        raise ValueError(f"RUT inválido: {v!r}")
    return format_rut(v)


class ProveedorBase(BaseModel):
    razon_social: str = Field(..., min_length=1, max_length=255)
    rut: str | None = None
    giro: str | None = None
    direccion: str | None = None
    ciudad: str | None = None
    contacto: str | None = None
    telefono: str | None = None
    email: str | None = None
    banco: str | None = None
    tipo_cuenta: str | None = None
    numero_cuenta: str | None = None

    @field_validator("rut", mode="before")
    @classmethod
    def validate_rut_field(cls, v: str | None) -> str | None:
        return _validate_rut(v)


class ProveedorCreate(ProveedorBase):
    pass


class ProveedorUpdate(BaseModel):
    razon_social: str | None = Field(default=None, min_length=1, max_length=255)
    rut: str | None = None
    giro: str | None = None
    direccion: str | None = None
    ciudad: str | None = None
    contacto: str | None = None
    telefono: str | None = None
    email: str | None = None
    banco: str | None = None
    tipo_cuenta: str | None = None
    numero_cuenta: str | None = None

    @field_validator("rut", mode="before")
    @classmethod
    def validate_rut_field(cls, v: str | None) -> str | None:
        return _validate_rut(v)


class ProveedorRead(ProveedorBase):
    proveedor_id: int
    activo: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
