"""Schemas Pydantic para `core.lp_documents` (V5)."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

LpDocumentTipo = Literal[
    "contrato_suscripcion",
    "kyc",
    "ddq",
    "side_letter",
    "aml_pep",
    "recibo_aporte",
    "acta_aprobacion",
    "w8_w9_tax",
    "dni_pasaporte",
    "power_of_attorney",
    "otro",
]

LpDocumentEstado = Literal["vigente", "vencido", "borrador", "archivado"]


class LpDocumentBase(BaseModel):
    tipo: LpDocumentTipo
    nombre: str = Field(min_length=2, max_length=200)
    fecha_firma: date | None = None
    fecha_vigencia_hasta: date | None = None
    monto_clp: Decimal | None = None
    dropbox_path: str | None = Field(default=None, max_length=500)
    hash_sha256: str | None = Field(default=None, max_length=64)
    estado: LpDocumentEstado = "vigente"
    metadata: dict[str, Any] = Field(default_factory=dict)


class LpDocumentCreate(LpDocumentBase):
    uploaded_by: str | None = None


class LpDocumentUpdate(BaseModel):
    tipo: LpDocumentTipo | None = None
    nombre: str | None = Field(default=None, min_length=2, max_length=200)
    fecha_firma: date | None = None
    fecha_vigencia_hasta: date | None = None
    monto_clp: Decimal | None = None
    dropbox_path: str | None = Field(default=None, max_length=500)
    hash_sha256: str | None = Field(default=None, max_length=64)
    estado: LpDocumentEstado | None = None
    metadata: dict[str, Any] | None = None


class LpDocumentRead(LpDocumentBase):
    model_config = ConfigDict(from_attributes=True)

    lp_doc_id: int
    lp_id: int
    uploaded_by: str | None = None
    created_at: datetime
    updated_at: datetime
