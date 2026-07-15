"""MEGAPROMPT F3 — Schemas del flujo de firmas de OC."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class FirmanteIn(BaseModel):
    email: EmailStr
    nombre: str | None = Field(default=None, max_length=200)
    cargo: str | None = Field(default=None, max_length=120)


class FirmantesAssignRequest(BaseModel):
    firmantes: list[FirmanteIn] = Field(min_length=1, max_length=10)
    mensaje: str | None = Field(default=None, max_length=500)


class FirmarRequest(BaseModel):
    comments: str | None = Field(default=None, max_length=500)


class RechazarFirmaRequest(BaseModel):
    motivo: str = Field(min_length=3, max_length=500)


class MarcarFacturadaRequest(BaseModel):
    folio: str | None = Field(default=None, max_length=50)


class FirmaRead(BaseModel):
    firma_id: int
    firmante_email: str
    firmante_nombre: str | None
    firmante_cargo: str | None
    orden: int
    status: str  # PENDIENTE | FIRMADA | RECHAZADA
    signed_at: datetime | None
    notified_at: datetime | None
    reminder_sent_at: datetime | None
    comments: str | None
    es_mi_firma: bool = False


class OcFirmasResponse(BaseModel):
    oc_id: int
    numero_oc: str
    estado: str
    firmas: list[FirmaRead]
    # Sugerencias para el dialog "Enviar a firma" (GG + firmantes_extra de la
    # empresa). Puede venir sin email si el branding no lo tiene cargado.
    sugeridos: list[FirmanteIn]
    puedo_firmar: bool
    pendientes: int


class FirmarResponse(BaseModel):
    ok: bool
    estado: str
    completamente_firmada: bool
    enviada_proveedor: bool = False
    proveedor_email: str | None = None
    detalle: str | None = None
