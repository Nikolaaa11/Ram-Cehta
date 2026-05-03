"""Schemas Pydantic para Informes LP (V4 fase 9).

Diseño del shape `secciones`:
- Es JSONB libre, pero validamos un shape recomendado para que el
  frontend tenga TypeScript types limpios.
- Cada sección es un dict con `kind` (discriminator) + payload.
- Permite extender con nuevas secciones sin migrations.

Token: NO es Optional[str] en respuesta — siempre se devuelve. Pero al
crear un informe, el cliente NO lo pasa: lo genera el repository con
secrets.token_urlsafe(24).
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# LP (core.lps)
# ---------------------------------------------------------------------------

EstadoLp = Literal["pipeline", "cualificado", "activo", "inactivo", "declinado"]
PerfilInversor = Literal["conservador", "moderado", "agresivo", "esg_focused"]


class LpBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=255)
    apellido: str | None = None
    email: str | None = None
    telefono: str | None = None
    empresa: str | None = None
    rol: str | None = None
    estado: EstadoLp = "pipeline"
    primer_contacto: date | None = None
    perfil_inversor: PerfilInversor | None = None
    intereses: list[str] = Field(default_factory=list)
    relationship_owner: str | None = None
    aporte_total: Decimal | None = None
    aporte_actual: Decimal | None = None
    empresas_invertidas: list[str] = Field(default_factory=list)
    notas: str | None = None


class LpCreate(LpBase):
    pass


class LpUpdate(BaseModel):
    nombre: str | None = None
    apellido: str | None = None
    email: str | None = None
    telefono: str | None = None
    empresa: str | None = None
    rol: str | None = None
    estado: EstadoLp | None = None
    primer_contacto: date | None = None
    perfil_inversor: PerfilInversor | None = None
    intereses: list[str] | None = None
    relationship_owner: str | None = None
    aporte_total: Decimal | None = None
    aporte_actual: Decimal | None = None
    empresas_invertidas: list[str] | None = None
    notas: str | None = None


class LpRead(LpBase):
    lp_id: int
    metadata_: dict[str, Any] | None = Field(default=None, alias="metadata_")
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


# ---------------------------------------------------------------------------
# Informe LP (app.informes_lp)
# ---------------------------------------------------------------------------

TipoInforme = Literal[
    "periodico", "pitch_inicial", "update_mensual", "tear_sheet", "memoria_anual"
]
EstadoInforme = Literal["borrador", "publicado", "archivado"]
TonoNarrativa = Literal["ejecutivo", "narrativo", "tecnico"]


class InformeLpGenerateRequest(BaseModel):
    """Input del endpoint POST /informes-lp/generate."""

    lp_id: int | None = None  # opcional para pitch_inicial sin LP aún
    tipo: TipoInforme = "periodico"
    titulo: str | None = None  # auto-generado si vacío
    periodo: str | None = None  # ej: "Q1 2026"
    incluir_empresas: list[str] | None = None  # default todas con datos
    tono: TonoNarrativa = "ejecutivo"


class InformeLpEvento(BaseModel):
    """Una sección del informe — JSONB libre con `kind` discriminator."""

    kind: str
    payload: dict[str, Any]


class InformeLpRead(BaseModel):
    """Vista admin (interna) — incluye token + analytics."""

    informe_id: int
    lp_id: int | None = None
    token: str
    parent_token: str | None = None
    titulo: str
    periodo: str | None = None
    tipo: str
    hero_titulo: str | None = None
    hero_narrativa: str | None = None
    secciones: dict[str, Any] | None = None
    estado: str
    publicado_at: datetime | None = None
    expira_at: datetime | None = None
    veces_abierto: int
    veces_compartido: int
    tiempo_promedio_segundos: int | None = None
    creado_por: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class InformeLpListItem(BaseModel):
    """Vista listado admin — sin contenido pesado."""

    informe_id: int
    lp_id: int | None = None
    lp_nombre: str | None = None  # JOIN
    token: str
    titulo: str
    periodo: str | None = None
    tipo: str
    estado: str
    publicado_at: datetime | None = None
    veces_abierto: int
    veces_compartido: int
    created_at: datetime


class InformeLpUpdate(BaseModel):
    """Edición del informe antes de publicar."""

    titulo: str | None = None
    hero_titulo: str | None = None
    hero_narrativa: str | None = None
    secciones: dict[str, Any] | None = None
    estado: EstadoInforme | None = None
    expira_at: datetime | None = None


class InformeLpPublicView(BaseModel):
    """Vista pública del informe — la que ve el LP en /informe/[token].

    Diferencias vs InformeLpRead:
    - NO incluye token (ya lo tiene en la URL)
    - NO incluye analytics ni audit fields
    - Incluye datos del LP destinatario (nombre + foto)
    - Incluye live data del portafolio (KPIs, ESG metrics) que se
      pulea on-demand
    """

    informe_id: int
    titulo: str
    periodo: str | None = None
    tipo: str
    hero_titulo: str | None = None
    hero_narrativa: str | None = None
    secciones: dict[str, Any] | None = None
    publicado_at: datetime | None = None
    expira_at: datetime | None = None
    is_expired: bool = False

    # Datos del LP (si está vinculado)
    lp_nombre: str | None = None
    lp_apellido: str | None = None
    lp_empresa: str | None = None

    # Si vino de un share, mostrar atribución sutil ("Te recomendó X")
    parent_lp_nombre: str | None = None

    # Live data del portafolio (pulled on-demand cuando se abre)
    live_data: dict[str, Any] | None = None


class InformeLpShareRequest(BaseModel):
    """Body de POST /informes-lp/by-token/{token}/share."""

    nombre_destinatario: str = Field(..., min_length=1, max_length=255)
    email_destinatario: str = Field(..., min_length=3, max_length=255)
    mensaje_personal: str | None = Field(default=None, max_length=1000)


class InformeLpShareResponse(BaseModel):
    """Respuesta del share — devuelve el child_token para que el
    frontend pueda mostrar el link generado al LP que comparte."""

    child_token: str
    child_url: str
    parent_token: str
    message: str


# ---------------------------------------------------------------------------
# Eventos de tracking
# ---------------------------------------------------------------------------

TipoEvento = Literal[
    "open",
    "scroll",
    "section_view",
    "cta_click",
    "share_click",
    "pdf_download",
    "video_play",
    "time_spent",
    "agendar_click",
]


class TrackEventRequest(BaseModel):
    """Body de POST /informes-lp/by-token/{token}/track.

    Endpoint público — no requiere auth. Rate limited.
    """

    tipo: TipoEvento
    seccion: str | None = Field(default=None, max_length=100)
    valor_numerico: int | None = None
    valor_texto: str | None = Field(default=None, max_length=500)
    referer: str | None = Field(default=None, max_length=500)


class TrackEventResponse(BaseModel):
    """Confirmación mínima del track — no devuelve nada sensible."""

    ok: bool = True


# ---------------------------------------------------------------------------
# Analytics agregadas (admin)
# ---------------------------------------------------------------------------


class TopAdvocate(BaseModel):
    lp_id: int
    lp_nombre: str
    compartio_count: int
    aperturas_downstream: int
    convertidos: int  # cuántos hicieron CTA agendar_click
    aporte_atribuible: Decimal | None = None


class InformesAnalytics(BaseModel):
    """Dashboard de analytics para /admin/informes-lp."""

    total_generados: int
    total_publicados: int
    total_aperturas: int
    total_compartidos: int
    tiempo_promedio_segundos: int | None = None
    tasa_apertura: float  # 0.0-1.0
    tasa_share: float
    tasa_conversion: float  # CTA agendar / aperturas
    tasa_viral: float  # downstream views / opens — el KPI norte
    top_advocates: list[TopAdvocate] = Field(default_factory=list)
