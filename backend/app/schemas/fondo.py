"""Schemas Pydantic para Fondos (V3 fase 5)."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

TipoFondo = Literal[
    "lp", "banco", "programa_estado", "family_office", "vc", "angel", "otro"
]
EstadoOutreach = Literal[
    "no_contactado", "contactado", "en_negociacion", "cerrado", "descartado"
]


class FondoBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=255)
    tipo: TipoFondo
    descripcion: str | None = None
    pais: str | None = None
    region: str | None = None
    ticket_min_usd: Decimal | None = None
    ticket_max_usd: Decimal | None = None
    sectores: list[str] | None = None
    stage: list[str] | None = None
    thesis: str | None = None
    website: str | None = None
    contacto_nombre: str | None = None
    contacto_email: str | None = None
    contacto_linkedin: str | None = None
    estado_outreach: EstadoOutreach = "no_contactado"
    fecha_proximo_contacto: date | None = None
    notas: str | None = None


class FondoCreate(FondoBase):
    pass


class FondoUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=255)
    tipo: TipoFondo | None = None
    descripcion: str | None = None
    pais: str | None = None
    region: str | None = None
    ticket_min_usd: Decimal | None = None
    ticket_max_usd: Decimal | None = None
    sectores: list[str] | None = None
    stage: list[str] | None = None
    thesis: str | None = None
    website: str | None = None
    contacto_nombre: str | None = None
    contacto_email: str | None = None
    contacto_linkedin: str | None = None
    estado_outreach: EstadoOutreach | None = None
    fecha_proximo_contacto: date | None = None
    notas: str | None = None


class FondoRead(BaseModel):
    fondo_id: int
    nombre: str
    tipo: str
    descripcion: str | None = None
    pais: str | None = None
    region: str | None = None
    ticket_min_usd: Decimal | None = None
    ticket_max_usd: Decimal | None = None
    sectores: list[str] | None = None
    stage: list[str] | None = None
    thesis: str | None = None
    website: str | None = None
    contacto_nombre: str | None = None
    contacto_email: str | None = None
    contacto_linkedin: str | None = None
    estado_outreach: str
    fecha_proximo_contacto: date | None = None
    notas: str | None = None
    metadata_: dict[str, Any] | None = Field(default=None, alias="metadata_")
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class FondoListItem(BaseModel):
    """Vista resumida para tabla."""

    fondo_id: int
    nombre: str
    tipo: str
    pais: str | None = None
    ticket_min_usd: Decimal | None = None
    ticket_max_usd: Decimal | None = None
    sectores: list[str] | None = None
    estado_outreach: str
    fecha_proximo_contacto: date | None = None

    model_config = {"from_attributes": True}


class FondoStats(BaseModel):
    """Counts agregados por tipo y estado."""

    total: int
    por_tipo: dict[str, int]
    por_estado: dict[str, int]


class ImportFromDropboxResponse(BaseModel):
    found: bool
    dropbox_path: str | None = None
    fondos_creados: int = 0
    fondos_actualizados: int = 0
    message: str
