"""Schemas de búsqueda global (Cmd+K).

Una sola query de texto recorre 7 entidades (empresas, OCs, proveedores, F29,
trabajadores, documentos legales, fondos) y devuelve hits homogéneos para
poblar el command-palette.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SearchEntityType = Literal[
    "empresa",
    "orden_compra",
    "proveedor",
    "f29",
    "trabajador",
    "legal_document",
    "fondo",
    "suscripcion",
]


class SearchHit(BaseModel):
    """Un resultado individual; agnóstico de la entidad de origen.

    `link` es la ruta relativa del frontend a la que el palette navega al
    seleccionar el resultado. `score` es solo informativo (lex-similarity rank
    crudo); el frontend ya recibe los hits ordenados.
    """

    entity_type: SearchEntityType
    entity_id: str
    title: str
    subtitle: str | None = None
    badge: str | None = None  # estado o etiqueta corta para chip
    link: str
    score: float = 0.0


class SearchResponse(BaseModel):
    """Respuesta agregada por entidad — el frontend pinta secciones."""

    query: str
    total: int
    by_entity: dict[SearchEntityType, list[SearchHit]] = Field(
        default_factory=dict,
        description=(
            "Mapa entity_type → hits (cap. 5 por entidad). El frontend renderea"
            " una sección por clave presente."
        ),
    )
