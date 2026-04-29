"""Schemas para Bulk CSV Import (V3 fase 11).

Two-step flow:
  1. Dry-run → `ValidationReport` con valid/invalid/duplicate por fila.
  2. Execute → `ImportResult` con created/skipped/errors.

`InvalidRow.original` se devuelve "as-is" para que el frontend pueda mostrar
qué fila exactamente falló sin recargar el CSV.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

EntityType = Literal["trabajadores", "fondos", "proveedores"]


class InvalidRow(BaseModel):
    """Fila que NO pasó validación Pydantic."""

    row_index: int = Field(..., description="0-based index dentro del CSV")
    errors: list[str]
    original: dict[str, Any]


class DuplicateRow(BaseModel):
    """Fila válida pero que duplica un registro existente en DB."""

    row_index: int
    key: str = Field(..., description="Valor único que choca (rut, nombre, etc.)")
    existing_id: int | None = None
    original: dict[str, Any]


class ValidRow(BaseModel):
    """Fila lista para insertar (cleaned + validated)."""

    row_index: int
    data: dict[str, Any]


class ValidationReport(BaseModel):
    entity_type: str
    total_rows: int
    valid_rows: int
    invalid_rows: list[InvalidRow] = Field(default_factory=list)
    duplicates: list[DuplicateRow] = Field(default_factory=list)
    valid: list[ValidRow] = Field(default_factory=list)


class ImportRowError(BaseModel):
    row_index: int
    detail: str


class ImportResult(BaseModel):
    entity_type: str
    created: int
    skipped: int
    errors: list[ImportRowError] = Field(default_factory=list)


class ExecuteImportRequest(BaseModel):
    """Body del POST /execute — son las filas validadas del dry-run."""

    rows: list[dict[str, Any]] = Field(..., min_length=1, max_length=5000)
