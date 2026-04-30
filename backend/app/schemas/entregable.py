"""Schemas — Entregables Regulatorios FIP CEHTA ESG (V4 fase 6).

Implementa el contrato del PROMPT_MAESTRO_calendario_entregables:
- Estados: pendiente / en_proceso / entregado / no_entregado
- Categorías: CMF / CORFO / UAF / SII / INTERNO / AUDITORIA / ASAMBLEA / OPERACIONAL
- Sistema de alertas 15 / 10 / 5 días antes
- Niveles de alerta calculados: vencido / hoy / critico / urgente / proximo / en_rango / normal
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

EstadoEntregable = Literal["pendiente", "en_proceso", "entregado", "no_entregado"]
Categoria = Literal[
    "CMF",
    "CORFO",
    "UAF",
    "SII",
    "INTERNO",
    "AUDITORIA",
    "ASAMBLEA",
    "OPERACIONAL",
]
Frecuencia = Literal[
    "mensual",
    "trimestral",
    "semestral",
    "anual",
    "bienal",
    "unico",
    "segun_evento",
]
Prioridad = Literal["critica", "alta", "media", "baja"]
NivelAlerta = Literal[
    "vencido",
    "hoy",
    "critico",   # ≤ 5 días
    "urgente",   # ≤ 10 días
    "proximo",   # ≤ 15 días
    "en_rango",  # ≤ 30 días
    "normal",    # > 30 días
]


class EntregableBase(BaseModel):
    id_template: str = Field(..., min_length=1, max_length=120)
    nombre: str = Field(..., min_length=1, max_length=300)
    descripcion: str | None = Field(None, max_length=2000)
    categoria: Categoria
    subcategoria: str | None = Field(None, max_length=120)
    referencia_normativa: str | None = Field(None, max_length=500)
    fecha_limite: date
    frecuencia: Frecuencia
    prioridad: Prioridad
    responsable: str = Field(..., min_length=1, max_length=120)
    periodo: str = Field(..., min_length=1, max_length=40)
    alerta_15: bool = True
    alerta_10: bool = True
    alerta_5: bool = True


class EntregableCreate(EntregableBase):
    notas: str | None = Field(None, max_length=2000)
    adjunto_url: str | None = Field(None, max_length=500)
    estado: EstadoEntregable = "pendiente"
    extra: dict[str, Any] | None = None


class EntregableUpdate(BaseModel):
    """PATCH parcial — todos los campos opcionales."""

    estado: EstadoEntregable | None = None
    fecha_entrega_real: date | None = None
    motivo_no_entrega: str | None = Field(None, max_length=1000)
    notas: str | None = Field(None, max_length=2000)
    adjunto_url: str | None = Field(None, max_length=500)
    fecha_limite: date | None = None
    nombre: str | None = Field(None, min_length=1, max_length=300)
    descripcion: str | None = Field(None, max_length=2000)
    prioridad: Prioridad | None = None
    responsable: str | None = Field(None, max_length=120)
    alerta_15: bool | None = None
    alerta_10: bool | None = None
    alerta_5: bool | None = None
    extra: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _no_entregado_requires_motivo(self) -> "EntregableUpdate":
        # Cross-field: si marcás como no_entregado, exigimos motivo.
        if self.estado == "no_entregado" and not self.motivo_no_entrega:
            raise ValueError(
                "Estado 'no_entregado' requiere especificar motivo_no_entrega"
            )
        # Si marcás como entregado, fecha_entrega_real debería estar.
        # Lo permitimos no-set (default a hoy del lado del endpoint).
        return self


class EntregableRead(EntregableBase):
    entregable_id: int
    estado: EstadoEntregable
    fecha_entrega_real: date | None
    motivo_no_entrega: str | None
    notas: str | None
    adjunto_url: str | None
    generado_automaticamente: bool
    es_publico: bool
    extra: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime

    # Calculado server-side para que el frontend no tenga que pensar:
    nivel_alerta: NivelAlerta | None = None
    dias_restantes: int | None = None

    model_config = {"from_attributes": True}


class EntregableEstadosCounts(BaseModel):
    pendiente: int = 0
    en_proceso: int = 0
    entregado: int = 0
    no_entregado: int = 0


class ReporteRegulatorio(BaseModel):
    """Snapshot resumido para actas del Comité de Vigilancia."""

    generado_at: datetime
    estados: EntregableEstadosCounts
    proximos_30d: list[EntregableRead]
    vencidos_sin_entregar: list[EntregableRead]
    tasa_cumplimiento_ytd: float  # 0.0 - 100.0
    total_ytd: int
    entregados_ytd: int


class GenerarSerieRequest(BaseModel):
    """Genera N instancias de un template recurrente para un año dado."""

    id_template: str = Field(..., min_length=1)
    nombre: str = Field(..., min_length=1)
    descripcion: str | None = None
    categoria: Categoria
    subcategoria: str | None = None
    referencia_normativa: str | None = None
    frecuencia: Frecuencia
    prioridad: Prioridad
    responsable: str = Field(..., min_length=1)
    anio: int = Field(..., ge=2024, le=2030)
    alerta_15: bool = True
    alerta_10: bool = True
    alerta_5: bool = True

    @model_validator(mode="after")
    def _frecuencia_recurrente(self) -> "GenerarSerieRequest":
        if self.frecuencia in ("unico", "segun_evento"):
            raise ValueError(
                "Generar serie solo aplica a frecuencias recurrentes "
                "(mensual / trimestral / semestral / anual / bienal)"
            )
        return self


class GenerarSerieResponse(BaseModel):
    template: str
    anio: int
    instancias_creadas: int
    instancias_existentes: int  # ya existían (ON CONFLICT)
    fechas: list[date]
