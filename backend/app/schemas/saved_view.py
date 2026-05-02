"""Schemas Pydantic para SavedViews (V3 fase 11)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# Enum cerrado de páginas — cualquier valor fuera de esta unión Pydantic
# rechaza la request 422. Mantener sincronizado con el CHECK constraint
# en migración 0015 y con `SavedViewPage` en frontend (schema.ts).
SavedViewPage = Literal[
    "oc", "f29", "trabajadores", "proveedores", "legal", "fondos",
    "entregables", "cartas_gantt", "suscripciones", "calendario"
]


class SavedViewBase(BaseModel):
    page: SavedViewPage
    name: str = Field(..., min_length=1, max_length=80)
    filters: dict[str, Any] = Field(default_factory=dict)


class SavedViewCreate(SavedViewBase):
    """Crear una vista — siempre toma la `page` actual + filtros snapshot."""


class SavedViewUpdate(BaseModel):
    """Update parcial — todos los campos opcionales.

    El frontend usa este schema para rename, cambio de filtros (overwrite
    "current") y toggle pin. Si todos vienen None, la mutation es no-op.
    """

    name: str | None = Field(default=None, min_length=1, max_length=80)
    filters: dict[str, Any] | None = None
    is_pinned: bool | None = None


class SavedViewRead(BaseModel):
    id: str
    user_id: str
    page: str
    name: str
    filters: dict[str, Any]
    is_pinned: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
