"""Schema Pydantic para el AI Document Analyzer (V3 fase 7).

Este módulo define el contrato entre backend y frontend para los campos
extraídos por el LLM. El frontend usa `fields` (dict abierto) para
auto-rellenar formularios y `tipo_detectado` para enrutar a la lógica
correcta cuando el caller pidió `tipo='auto'`.

Decisiones:
- `fields` es `dict[str, Any]` porque cada `tipo_detectado` tiene un
  schema distinto (un contrato no tiene período tributario; un F29 sí).
  El frontend conoce los nombres canónicos por tipo. Validar acá sería
  redundante porque cada formulario revalida al submit.
- `confidence` viene del LLM (rango 0-1). Si el LLM devuelve algo fuera
  de rango, lo clamp-eamos.
- `raw_text_preview` se usa SOLO para debug/UX ("este es el texto que
  vio el modelo"). NO se persiste en DB ni en logs estructurados.
- `warnings` es un canal abierto: el LLM puede flaggear ambigüedades
  ("fecha 03/04/2026 podría ser 3 abr o 4 mar") y el frontend las
  muestra inline.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

DocumentTipo = Literal[
    "contrato",
    "f29",
    "trabajador_contrato",
    "factura",
    "liquidacion",
    "auto",
]


class DocumentExtraction(BaseModel):
    """Campos extraídos de un documento por el AI analyzer."""

    tipo_detectado: str = Field(
        ...,
        description="Tipo concreto detectado (nunca 'auto' — el LLM resuelve).",
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confianza del LLM en la extraccion (0-1).",
    )
    fields: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Pares clave-valor con los campos del documento. Las claves dependen "
            "de `tipo_detectado` (ver `document_analyzer_service.SCHEMAS`)."
        ),
    )
    raw_text_preview: str = Field(
        default="",
        description="Primeros ~500 chars del texto extraído (solo debug UX).",
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Notas del LLM sobre ambigüedades o campos imputados.",
    )
    extraction_method: str | None = Field(
        default=None,
        description=(
            "Cómo se extrajo el texto: 'pypdf' (PDF digital), 'ocr' (PDF/imagen escaneado), "
            "'hybrid' (mezcla pypdf+ocr), 'docx', 'text', 'image_ocr', 'failed' (soft-fail "
            "cuando tesseract no está instalado en el host). Útil para que el frontend "
            "explique al usuario por qué el análisis fue lento."
        ),
    )
    ocr_pages: int | None = Field(
        default=None,
        ge=0,
        description="Número de páginas que pasaron por OCR (None si no se usó OCR).",
    )
