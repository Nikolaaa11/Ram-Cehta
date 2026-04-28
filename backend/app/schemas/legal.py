"""Schemas Pydantic para Legal Vault (V3 fase 3+4).

Validaciones:
- `categoria` y `estado` son `Literal[...]` (whitelist exacta) — la DB
  duplica el chequeo con CHECK constraints.
- `subcategoria` es libre porque varía mucho por categoría (cliente/proveedor/
  bancario/f29/f22/contractual/etc.) — el frontend ofrece sugerencias.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

CategoriaLegal = Literal[
    "contrato",
    "acta",
    "declaracion_sii",
    "permiso",
    "poliza",
    "estatuto",
    "otro",
]
EstadoLegal = Literal["vigente", "vencido", "renovado", "cancelado", "borrador"]
NivelAlerta = Literal["vencido", "critico", "proximo", "ok"]


class LegalDocumentBase(BaseModel):
    empresa_codigo: str = Field(..., min_length=1, max_length=64)
    categoria: CategoriaLegal
    subcategoria: str | None = None
    nombre: str = Field(..., min_length=1, max_length=255)
    descripcion: str | None = None
    contraparte: str | None = None
    fecha_emision: date | None = None
    fecha_vigencia_desde: date | None = None
    fecha_vigencia_hasta: date | None = None
    monto: Decimal | None = None
    moneda: str | None = None
    estado: EstadoLegal = "vigente"


class LegalDocumentCreate(LegalDocumentBase):
    """Body para POST /legal. `dropbox_path` se setea via upload separado."""


class LegalDocumentUpdate(BaseModel):
    categoria: CategoriaLegal | None = None
    subcategoria: str | None = None
    nombre: str | None = Field(default=None, min_length=1, max_length=255)
    descripcion: str | None = None
    contraparte: str | None = None
    fecha_emision: date | None = None
    fecha_vigencia_desde: date | None = None
    fecha_vigencia_hasta: date | None = None
    monto: Decimal | None = None
    moneda: str | None = None
    estado: EstadoLegal | None = None


class LegalDocumentRead(BaseModel):
    documento_id: int
    empresa_codigo: str
    categoria: str
    subcategoria: str | None = None
    nombre: str
    descripcion: str | None = None
    contraparte: str | None = None
    fecha_emision: date | None = None
    fecha_vigencia_desde: date | None = None
    fecha_vigencia_hasta: date | None = None
    monto: Decimal | None = None
    moneda: str | None = None
    dropbox_path: str | None = None
    estado: str
    metadata_: dict[str, Any] | None = Field(default=None, alias="metadata_")
    uploaded_by: str | None = None
    uploaded_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class LegalDocumentListItem(BaseModel):
    """Vista resumida para tabla."""

    documento_id: int
    empresa_codigo: str
    categoria: str
    subcategoria: str | None = None
    nombre: str
    contraparte: str | None = None
    fecha_vigencia_hasta: date | None = None
    monto: Decimal | None = None
    moneda: str | None = None
    estado: str
    dias_para_vencer: int | None = None
    alerta_nivel: str | None = None

    model_config = {"from_attributes": True}


class LegalAlert(BaseModel):
    """Alerta de vencimiento próximo (consumido por dashboard CEO + emails)."""

    documento_id: int
    empresa_codigo: str
    categoria: str
    nombre: str
    contraparte: str | None = None
    fecha_vigencia_hasta: date | None = None
    dias_para_vencer: int
    alerta_nivel: str
