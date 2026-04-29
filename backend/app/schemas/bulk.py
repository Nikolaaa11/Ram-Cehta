"""Schemas compartidos para operaciones bulk.

Toda operación masiva devuelve `BulkUpdateResult` con conteos y, si aplica,
errores por id. Diseñado para que el frontend muestre un toast del estilo
"15 actualizadas, 2 fallaron" sin tener que correlacionar.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class BulkUpdateEstadoRequest(BaseModel):
    """Body para `POST /<entity>/bulk-update-estado`.

    `ids` se valida con techo defensivo (200) — si necesitamos más, lo
    movemos a job en background.
    """

    ids: list[int] = Field(..., min_length=1, max_length=200)
    estado: str = Field(..., min_length=1)


class BulkDeleteRequest(BaseModel):
    ids: list[int] = Field(..., min_length=1, max_length=200)


class BulkItemError(BaseModel):
    id: int
    detail: str


class BulkUpdateResult(BaseModel):
    """Reporte de una operación masiva.

    `requested` = cuántos IDs vinieron en el request. `succeeded` + len(failed)
    debería igualar `requested` si todos los items existían; los IDs que no
    existen aparecen en `failed` con `detail="not found"`.
    """

    operation: Literal["update_estado", "delete"]
    requested: int
    succeeded: int
    failed: list[BulkItemError] = []
