from __future__ import annotations

from pydantic import BaseModel


class ConceptoDetallado(BaseModel):
    concepto_detallado: str
    concepto_general: str | None


class CatalogosResponse(BaseModel):
    empresas: list[dict[str, str | None]]
    concepto_general: list[str]
    concepto_detallado: list[ConceptoDetallado]
    tipo_egreso: list[str]
    fuente: list[str]
    proyecto: list[str]
    banco: list[str]
