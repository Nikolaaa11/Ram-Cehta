"""Schemas Pydantic para `core.policies_fondo` (V5)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

PolicyTipo = Literal[
    "reglamento_interno",
    "manual_uaf",
    "codigo_etica",
    "politica_pep",
    "politica_inversion",
    "politica_riesgo",
    "politica_conflicto_interes",
    "manual_compliance",
    "otro",
]

PolicyEstado = Literal["vigente", "derogada", "borrador"]


class PolicyFondoBase(BaseModel):
    tipo: PolicyTipo
    nombre: str = Field(min_length=2, max_length=200)
    version: str = Field(min_length=1, max_length=50)
    fecha_aprobacion: date
    fecha_vigencia_desde: date | None = None
    fecha_proxima_revision: date | None = None
    aprobado_por: str | None = Field(default=None, max_length=200)
    dropbox_path: str | None = Field(default=None, max_length=500)
    hash_sha256: str | None = Field(default=None, max_length=64)
    estado: PolicyEstado = "vigente"
    metadata: dict[str, Any] = Field(default_factory=dict)


class PolicyFondoCreate(PolicyFondoBase):
    pass


class PolicyFondoUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=2, max_length=200)
    version: str | None = Field(default=None, min_length=1, max_length=50)
    fecha_aprobacion: date | None = None
    fecha_vigencia_desde: date | None = None
    fecha_proxima_revision: date | None = None
    aprobado_por: str | None = Field(default=None, max_length=200)
    dropbox_path: str | None = Field(default=None, max_length=500)
    hash_sha256: str | None = Field(default=None, max_length=64)
    estado: PolicyEstado | None = None
    metadata: dict[str, Any] | None = None


class PolicyFondoRead(PolicyFondoBase):
    model_config = ConfigDict(from_attributes=True)

    policy_id: int
    created_at: datetime
    updated_at: datetime
