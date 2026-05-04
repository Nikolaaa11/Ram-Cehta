"""Schemas Pydantic para `core.estados_financieros` (V5)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

TipoEf = Literal[
    "balance",
    "estado_resultados",
    "flujo_caja",
    "cambios_patrimonio",
    "consolidado",
    "notas",
]

PeriodoTipo = Literal[
    "mensual",
    "trimestral",
    "semestral",
    "anual",
]


class EstadoFinancieroBase(BaseModel):
    empresa_codigo: str = Field(min_length=1, max_length=50)
    tipo_ef: TipoEf
    periodo_tipo: PeriodoTipo
    periodo: str = Field(min_length=1, max_length=50)
    fecha_corte: date
    auditado: bool = False
    auditor: str | None = Field(default=None, max_length=200)
    aprobado_directorio: bool = False
    fecha_aprobacion: date | None = None
    dropbox_path: str | None = Field(default=None, max_length=500)
    hash_sha256: str | None = Field(default=None, max_length=64)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EstadoFinancieroCreate(EstadoFinancieroBase):
    pass


class EstadoFinancieroUpdate(BaseModel):
    tipo_ef: TipoEf | None = None
    periodo_tipo: PeriodoTipo | None = None
    periodo: str | None = Field(default=None, min_length=1, max_length=50)
    fecha_corte: date | None = None
    auditado: bool | None = None
    auditor: str | None = Field(default=None, max_length=200)
    aprobado_directorio: bool | None = None
    fecha_aprobacion: date | None = None
    dropbox_path: str | None = Field(default=None, max_length=500)
    hash_sha256: str | None = Field(default=None, max_length=64)
    metadata: dict[str, Any] | None = None


class EstadoFinancieroRead(EstadoFinancieroBase):
    model_config = ConfigDict(from_attributes=True)

    ef_id: int
    created_at: datetime
    updated_at: datetime
