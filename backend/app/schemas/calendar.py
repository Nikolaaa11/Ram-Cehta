"""Schemas Pydantic para Calendar Events (V3 fase 5).

Extendido en V3 fase 9 con `ObligationItem` para el calendario unificado
de obligaciones (F29 + Legal + OC + Suscripciones + eventos manuales).
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

TipoEvento = Literal[
    "f29", "reporte_lp", "comite", "reporte_trimestral", "vencimiento", "otro"
]

ObligationTipo = Literal[
    "f29",
    "legal",
    "oc",
    "suscripcion",
    "event",
    "hito",  # V4 fase 9.1: hitos del Gantt cross-empresa
    "entregable",  # V4 fase 9.1: entregables regulatorios CMF/CORFO/UAF
]
ObligationSeverity = Literal["critical", "warning", "info"]


class CalendarEventBase(BaseModel):
    titulo: str = Field(..., min_length=1, max_length=255)
    descripcion: str | None = None
    tipo: TipoEvento
    empresa_codigo: str | None = Field(default=None, min_length=1, max_length=64)
    fecha_inicio: datetime
    fecha_fin: datetime | None = None
    todo_el_dia: bool = True
    recurrencia: str | None = None
    notificar_dias_antes: int = Field(default=3, ge=0, le=365)
    notificar_emails: list[str] | None = None


class CalendarEventCreate(CalendarEventBase):
    pass


class CalendarEventUpdate(BaseModel):
    titulo: str | None = Field(default=None, min_length=1, max_length=255)
    descripcion: str | None = None
    tipo: TipoEvento | None = None
    empresa_codigo: str | None = None
    fecha_inicio: datetime | None = None
    fecha_fin: datetime | None = None
    todo_el_dia: bool | None = None
    recurrencia: str | None = None
    notificar_dias_antes: int | None = Field(default=None, ge=0, le=365)
    notificar_emails: list[str] | None = None
    completado: bool | None = None


class CalendarEventRead(BaseModel):
    event_id: int
    titulo: str
    descripcion: str | None = None
    tipo: str
    empresa_codigo: str | None = None
    fecha_inicio: datetime
    fecha_fin: datetime | None = None
    todo_el_dia: bool
    recurrencia: str | None = None
    notificar_dias_antes: int
    notificar_emails: list[str] | None = None
    metadata_: dict[str, Any] | None = Field(default=None, alias="metadata_")
    auto_generado: bool
    completado: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class AgentRunReport(BaseModel):
    """Reporte de los agentes scheduled."""

    f29_eventos_creados: int = 0
    reporte_lp_eventos_creados: int = 0
    total_creados: int = 0
    errores: list[str] = Field(default_factory=list)


class ObligationItem(BaseModel):
    """Item del timeline unificado de obligaciones (V3 fase 9).

    Agrega 5 fuentes en un único contrato:

      * `f29`        — F29 con `fecha_vencimiento` y `estado != 'pagado'`
      * `legal`      — documentos legales `vigente` con `fecha_vigencia_hasta`
      * `oc`         — OC `emitida`/`aprobada` (no pagada/anulada)
      * `suscripcion`— suscripciones de acciones por firmar
      * `event`      — eventos manuales del calendario (`core.calendar_events`)

    El `id` es compuesto (`f"{tipo}:{entity_id}"`) para evitar colisiones
    entre fuentes y permitir keys estables en el frontend.
    """

    id: str
    tipo: ObligationTipo
    severity: ObligationSeverity
    title: str
    subtitle: str | None = None
    empresa_codigo: str | None = None
    due_date: date
    days_until: int
    monto: Decimal | None = None
    moneda: str | None = None
    link: str
