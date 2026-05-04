"""Schemas Pydantic para `core.fondo_actas` (V5)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

FondoActaTipo = Literal[
    "directorio_afis",
    "comite_inversion",
    "asamblea_lps",
    "comite_vigilancia",
    "comite_riesgo",
    "otro",
]

FondoActaEstado = Literal["borrador", "aprobada", "firmada", "archivada"]


class Acuerdo(BaseModel):
    """Un acuerdo dentro del acta — punto del orden del día votado."""

    orden_dia: str = Field(min_length=1, max_length=200)
    descripcion: str = Field(min_length=1)
    votos_a_favor: int = Field(default=0, ge=0)
    votos_en_contra: int = Field(default=0, ge=0)
    abstenciones: int = Field(default=0, ge=0)
    aprobado: bool = False


class FondoActaBase(BaseModel):
    tipo_organo: FondoActaTipo
    numero_acta: int = Field(ge=1)
    fecha_reunion: date
    lugar: str | None = Field(default=None, max_length=300)
    quorum: int | None = Field(default=None, ge=0)
    quorum_total: int | None = Field(default=None, ge=0)
    presidente: str | None = Field(default=None, max_length=200)
    secretario: str | None = Field(default=None, max_length=200)
    asistentes: list[str] = Field(default_factory=list)
    temario: str | None = None
    acuerdos: list[Acuerdo] = Field(default_factory=list)
    dropbox_path: str | None = Field(default=None, max_length=500)
    hash_sha256: str | None = Field(default=None, max_length=64)
    estado: FondoActaEstado = "borrador"
    metadata: dict[str, Any] = Field(default_factory=dict)


class FondoActaCreate(FondoActaBase):
    pass


class FondoActaUpdate(BaseModel):
    tipo_organo: FondoActaTipo | None = None
    numero_acta: int | None = Field(default=None, ge=1)
    fecha_reunion: date | None = None
    lugar: str | None = Field(default=None, max_length=300)
    quorum: int | None = Field(default=None, ge=0)
    quorum_total: int | None = Field(default=None, ge=0)
    presidente: str | None = Field(default=None, max_length=200)
    secretario: str | None = Field(default=None, max_length=200)
    asistentes: list[str] | None = None
    temario: str | None = None
    acuerdos: list[Acuerdo] | None = None
    dropbox_path: str | None = Field(default=None, max_length=500)
    hash_sha256: str | None = Field(default=None, max_length=64)
    estado: FondoActaEstado | None = None
    metadata: dict[str, Any] | None = None


class FondoActaRead(FondoActaBase):
    model_config = ConfigDict(from_attributes=True)

    acta_id: int
    created_at: datetime
    updated_at: datetime
