"""Schemas pydantic para `core.suscripciones_acciones`."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class SuscripcionCreate(BaseModel):
    empresa_codigo: str = Field(..., min_length=1, max_length=64)
    fecha_recibo: date
    acciones_pagadas: Decimal = Field(..., gt=0)
    monto_uf: Decimal | None = Field(default=None, ge=0)
    monto_clp: Decimal = Field(..., gt=0)
    contrato_ref: str | None = None
    recibo_url: str | None = None
    firmado: bool = False
    fecha_firma: datetime | None = None


class SuscripcionUpdate(BaseModel):
    """PATCH /suscripciones-acciones/{id} — edición parcial."""

    fecha_recibo: date | None = None
    acciones_pagadas: Decimal | None = Field(default=None, gt=0)
    monto_uf: Decimal | None = Field(default=None, ge=0)
    monto_clp: Decimal | None = Field(default=None, gt=0)
    contrato_ref: str | None = None
    recibo_url: str | None = None
    firmado: bool | None = None
    fecha_firma: datetime | None = None


class SuscripcionRead(BaseModel):
    suscripcion_id: int
    empresa_codigo: str
    fecha_recibo: date
    acciones_pagadas: Decimal
    monto_uf: Decimal | None
    monto_clp: Decimal
    contrato_ref: str | None
    recibo_url: str | None
    firmado: bool
    fecha_firma: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SuscripcionResumen(BaseModel):
    """Agregado por empresa para reporte a inversionistas.

    Cada item resume todas las suscripciones de una empresa: total de acciones
    emitidas, total CLP cobrado, total UF (si aplica) y conteo de recibos.
    """

    empresa_codigo: str
    total_acciones: Decimal
    total_clp: Decimal
    total_uf: Decimal | None = None
    recibos_count: int
    recibos_firmados: int
