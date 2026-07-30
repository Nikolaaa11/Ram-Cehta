"""MEGAPROMPT PROVEEDOR-ENCARGADOS — catálogo de contactos por proveedor.

Mismo patrón que `schemas/oc_equipo.py` (empresa_equipo): catálogo con ID
estable para poder elegir "a quién va dirigida la OC" con un click en vez
de re-tipear el nombre cada vez.
"""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class ContactoCreate(BaseModel):
    nombre: str = Field(..., min_length=2, max_length=200)
    cargo: str | None = Field(default=None, max_length=120)
    email: str | None = None
    telefono: str | None = Field(default=None, max_length=40)
    es_default: bool = False

    @field_validator("email", mode="before")
    @classmethod
    def _empty_to_none(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


class ContactoUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=2, max_length=200)
    cargo: str | None = None
    email: str | None = None
    telefono: str | None = None
    es_default: bool | None = None
    activo: bool | None = None

    model_config = {"extra": "forbid"}


class ContactoRead(BaseModel):
    contacto_id: int
    proveedor_id: int
    nombre: str
    cargo: str | None
    email: str | None
    telefono: str | None
    orden: int
    es_default: bool
    activo: bool

    model_config = {"from_attributes": True}
