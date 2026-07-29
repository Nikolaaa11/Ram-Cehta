"""MEGAPROMPT F3 — Schemas del flujo de firmas de OC.

OC-FIRMANTES-EXTERNOS — se suma el "picker" de firmantes: el operador arma la
OC clickeando gente del equipo (core.empresa_equipo) y agregando externos
(proveedor/cliente). Por eso conviven dos familias de schemas:
  · FirmanteIn / FirmantesAssignRequest → el POST legacy (invita y manda a
    firma en un solo paso). Se mantiene intacto.
  · FirmanteSet / FirmantesReplaceRequest → el PUT replace-all del picker, que
    por defecto NO notifica ni cambia el estado de la OC.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

# El catálogo de personas firmantes vive en oc_equipo.py (su router lo manda
# como MiembroRead). Se importa —no se redefine— para que la UI reciba UN solo
# tipo: OcFirmasResponse.equipo trae el mismo shape que GET /empresas/{c}/equipo.
from app.schemas.oc_equipo import MiembroRead


class FirmanteIn(BaseModel):
    email: EmailStr
    nombre: str | None = Field(default=None, max_length=200)
    cargo: str | None = Field(default=None, max_length=120)


class FirmantesAssignRequest(BaseModel):
    firmantes: list[FirmanteIn] = Field(min_length=1, max_length=10)
    mensaje: str | None = Field(default=None, max_length=500)


# ---------------------------------------------------------------------------
# Picker de firmantes de la OC
# ---------------------------------------------------------------------------


class FirmanteSet(BaseModel):
    """Un firmante dentro del set completo que manda el PUT replace-all.

    `email` es opcional SOLO para externos: alguien del proveedor que firma a
    mano el PDF impreso y no tiene (ni necesita) cuenta en la plataforma.
    """

    email: EmailStr | None = None
    nombre: str = Field(min_length=2, max_length=200)
    cargo: str | None = Field(default=None, max_length=120)
    es_externo: bool = False
    # Razón social a imprimir bajo el cargo. NULL = la empresa emisora.
    empresa_firmante: str | None = Field(default=None, max_length=200)


class FirmantesReplaceRequest(BaseModel):
    """PUT /{oc_id}/firmantes — deja exactamente este set de firmantes.

    `notificar=False` (default) es el modo "preparar la OC": el usuario clickea
    integrantes decenas de veces y ni se manda un mail ni se mueve el estado.
    """

    firmantes: list[FirmanteSet] = Field(default_factory=list, max_length=20)
    notificar: bool = False
    mensaje: str | None = Field(default=None, max_length=500)


class AplicarPlantillaRequest(BaseModel):
    """`default` = firmantes habituales de la empresa;
    `anterior` = los de la última OC de la misma empresa que tenga firmantes."""

    origen: Literal["default", "anterior"] = "default"


class EnviarAFirmaRequest(BaseModel):
    mensaje: str | None = Field(default=None, max_length=500)


class FirmarRequest(BaseModel):
    comments: str | None = Field(default=None, max_length=500)
    # Texto que se dibuja en cursiva sobre la línea del PDF (nombre y
    # apellido, como al firmar un PDF). Si no viene, el backend usa el
    # nombre registrado del firmante. Se congela al firmar: cambiar el
    # nombre en el catálogo después NO altera una firma ya estampada.
    firma_visual: str | None = Field(default=None, max_length=120)


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
    # OC-FIRMANTES-EXTERNOS
    es_externo: bool = False
    empresa_firmante: str | None = None
    # TRUE = firmante externo cargado sin correo: firma el PDF a mano y no
    # recibe invitaciones. `firmante_email` trae un placeholder (la columna es
    # NOT NULL en la BD) que la UI no debería mostrar.
    sin_email: bool = False
    # Texto manuscrito estampado en el PDF. Sólo tiene valor en firmas
    # FIRMADA; se congela al firmar (ver migración megaprompt_oc_firma_visual).
    firma_visual: str | None = None


class OcFirmasResponse(BaseModel):
    oc_id: int
    numero_oc: str
    estado: str
    firmas: list[FirmaRead]
    # Sugerencias para el dialog "Enviar a firma" (GG + firmantes_extra de la
    # empresa). Puede venir sin email si el branding no lo tiene cargado.
    sugeridos: list[FirmanteIn]
    # Catálogo de la empresa (core.empresa_equipo, solo activos) para pintar
    # los chips clickeables sin una segunda llamada.
    equipo: list[MiembroRead] = Field(default_factory=list)
    puedo_firmar: bool
    pendientes: int


class FirmarResponse(BaseModel):
    ok: bool
    estado: str
    completamente_firmada: bool
    enviada_proveedor: bool = False
    proveedor_email: str | None = None
    detalle: str | None = None
