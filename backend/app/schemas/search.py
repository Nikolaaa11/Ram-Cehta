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
    "f22",  # V5+: declaración anual de renta
    "trabajador",
    "legal_document",
    "fondo",
    "suscripcion",
    "voucher",  # V5: vouchers contables
    "inbox",  # V5+: emails procesados de contactocehta@gmail.com
    # R152EEEE — módulos nuevos
    "empleado",          # R152vvv: empleados RRHH (con gate canSeeRRHH)
    "proyecto_contable", # R152w: proyectos CORFO/Privado/Interno
    "oc_cuota",          # R152yyy: cuotas de OC con voucher asociado
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
