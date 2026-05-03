"""Schemas Pydantic para Avance / Gantt (V3 fase 5).

Validaciones:
- `estado`, `severidad`, `probabilidad` son `Literal[...]` (whitelist) — la
  DB duplica con CHECK constraints.
- `progreso_pct` constrained 0..100.
- `HitoRead` y `RiesgoRead` se sirven embebidos en `ProyectoDetail`.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

EstadoProyecto = Literal[
    "planificado", "en_progreso", "completado", "cancelado", "pausado"
]
EstadoHito = Literal["pendiente", "en_progreso", "completado", "cancelado"]
Severidad = Literal["alta", "media", "baja"]
Probabilidad = Literal["alta", "media", "baja"]
EstadoRiesgo = Literal["abierto", "mitigado", "aceptado", "cerrado"]


# ---------------------------------------------------------------------------
# Proyecto
# ---------------------------------------------------------------------------


class ProyectoBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=255)
    descripcion: str | None = None
    fecha_inicio: date | None = None
    fecha_fin_estimada: date | None = None
    estado: EstadoProyecto = "en_progreso"
    progreso_pct: int = Field(default=0, ge=0, le=100)
    owner_email: str | None = None
    dropbox_roadmap_path: str | None = None


class ProyectoCreate(ProyectoBase):
    empresa_codigo: str = Field(..., min_length=1, max_length=64)


class ProyectoUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=255)
    descripcion: str | None = None
    fecha_inicio: date | None = None
    fecha_fin_estimada: date | None = None
    estado: EstadoProyecto | None = None
    progreso_pct: int | None = Field(default=None, ge=0, le=100)
    owner_email: str | None = None
    dropbox_roadmap_path: str | None = None


class ProyectoRead(BaseModel):
    proyecto_id: int
    empresa_codigo: str
    nombre: str
    descripcion: str | None = None
    fecha_inicio: date | None = None
    fecha_fin_estimada: date | None = None
    estado: str
    progreso_pct: int
    owner_email: str | None = None
    dropbox_roadmap_path: str | None = None
    metadata_: dict[str, Any] | None = Field(default=None, alias="metadata_")
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


# ---------------------------------------------------------------------------
# Hito
# ---------------------------------------------------------------------------


class HitoBase(BaseModel):
    nombre: str = Field(..., min_length=1, max_length=255)
    descripcion: str | None = None
    fecha_planificada: date | None = None
    fecha_completado: date | None = None
    estado: EstadoHito = "pendiente"
    orden: int = 0
    progreso_pct: int = Field(default=0, ge=0, le=100)
    deliverable_url: str | None = None


class HitoCreate(HitoBase):
    pass


class HitoUpdate(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=255)
    descripcion: str | None = None
    fecha_planificada: date | None = None
    fecha_completado: date | None = None
    estado: EstadoHito | None = None
    orden: int | None = None
    progreso_pct: int | None = Field(default=None, ge=0, le=100)
    deliverable_url: str | None = None


class HitoRead(BaseModel):
    hito_id: int
    proyecto_id: int
    nombre: str
    descripcion: str | None = None
    fecha_planificada: date | None = None
    fecha_completado: date | None = None
    estado: str
    orden: int
    progreso_pct: int
    deliverable_url: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Riesgo
# ---------------------------------------------------------------------------


class RiesgoBase(BaseModel):
    titulo: str = Field(..., min_length=1, max_length=255)
    descripcion: str | None = None
    severidad: Severidad = "media"
    probabilidad: Probabilidad = "media"
    estado: EstadoRiesgo = "abierto"
    owner_email: str | None = None
    mitigacion: str | None = None
    fecha_identificado: date | None = None
    fecha_cierre: date | None = None


class RiesgoCreate(RiesgoBase):
    proyecto_id: int | None = None
    empresa_codigo: str | None = Field(default=None, min_length=1, max_length=64)


class RiesgoUpdate(BaseModel):
    titulo: str | None = Field(default=None, min_length=1, max_length=255)
    descripcion: str | None = None
    severidad: Severidad | None = None
    probabilidad: Probabilidad | None = None
    estado: EstadoRiesgo | None = None
    owner_email: str | None = None
    mitigacion: str | None = None
    fecha_cierre: date | None = None


class RiesgoRead(BaseModel):
    riesgo_id: int
    proyecto_id: int | None = None
    empresa_codigo: str | None = None
    titulo: str
    descripcion: str | None = None
    severidad: str
    probabilidad: str
    estado: str
    owner_email: str | None = None
    mitigacion: str | None = None
    fecha_identificado: date
    fecha_cierre: date | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Listado y detalle compuesto
# ---------------------------------------------------------------------------


class ProyectoListItem(ProyectoRead):
    """Item del listado: incluye hitos embebidos + count de riesgos abiertos."""

    hitos: list[HitoRead] = Field(default_factory=list)
    riesgos_abiertos: int = 0


class ProyectoDetail(ProyectoRead):
    """Detalle completo con hitos y riesgos asociados."""

    hitos: list[HitoRead] = Field(default_factory=list)
    riesgos: list[RiesgoRead] = Field(default_factory=list)


class SyncRoadmapResponse(BaseModel):
    """Respuesta del sync con Dropbox Roadmap.xlsx."""

    empresa_codigo: str
    found: bool
    dropbox_path: str | None = None
    proyectos_creados: int = 0
    hitos_creados: int = 0
    message: str


# ---------------------------------------------------------------------------
# Import Excel Gantt (V4 fase 8)
# ---------------------------------------------------------------------------


class GanttHitoPreview(BaseModel):
    """Hito tal como salió del parser, antes de ir a DB."""

    nombre: str
    descripcion: str | None = None
    fecha_planificada: date | None = None
    fecha_completado: date | None = None
    estado: str
    progreso_pct: int
    orden: int = 0
    encargado: str | None = None
    monto_real: float | None = None
    monto_proyectado: float | None = None
    actividad_principal: str | None = None
    avance_decimal: float | None = None


class GanttProyectoPreview(BaseModel):
    """Proyecto parseado con sus hitos (modo preview o commit)."""

    codigo: str
    nombre: str
    descripcion: str | None = None
    estado: str
    fecha_inicio: date | None = None
    fecha_fin_estimada: date | None = None
    progreso_pct: int
    hitos: list[GanttHitoPreview] = Field(default_factory=list)


class GanttImportPreview(BaseModel):
    """Resultado del modo preview (sin tocar DB).

    El cliente lo muestra al usuario para que confirme antes del commit.
    """

    formato: Literal["classic", "ee", "revtech", "unknown"]
    empresa_codigo: str
    proyectos: list[GanttProyectoPreview] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    total_proyectos: int = 0
    total_hitos: int = 0


class GanttImportResult(BaseModel):
    """Resultado del modo commit — qué se creó/actualizó/saltó."""

    formato: Literal["classic", "ee", "revtech", "unknown"]
    empresa_codigo: str
    proyectos_creados: int = 0
    proyectos_actualizados: int = 0
    hitos_creados: int = 0
    hitos_actualizados: int = 0
    warnings: list[str] = Field(default_factory=list)
    message: str


class GanttSyncAllItem(BaseModel):
    """Resultado del sync por empresa dentro del bulk."""

    empresa_codigo: str
    status: Literal["ok", "not_found", "error", "no_dropbox"]
    formato: str | None = None
    proyectos_creados: int = 0
    proyectos_actualizados: int = 0
    hitos_creados: int = 0
    hitos_actualizados: int = 0
    message: str
    dropbox_path: str | None = None


class GanttSyncAllResult(BaseModel):
    """Resultado agregado del bulk-sync de Gantts del portafolio."""

    total_empresas: int
    sincronizadas: int
    no_encontradas: int
    con_error: int
    items: list[GanttSyncAllItem] = Field(default_factory=list)
    proyectos_creados_total: int = 0
    proyectos_actualizados_total: int = 0
    hitos_creados_total: int = 0
    hitos_actualizados_total: int = 0
    message: str
