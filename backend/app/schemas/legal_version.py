"""Schemas Pydantic para version history de Legal Vault (V4 fase 3).

Tres schemas:

* ``LegalDocumentVersionRead`` — fila de ``core.legal_document_versions``.
  Incluye ``snapshot`` (dict completo, output de ``LegalDocumentRead.model_dump
  (mode='json')``) y el ``change_summary`` auto-generado.
* ``LegalDocumentVersionListItem`` — alias liviano para listados (timeline).
  Misma forma que ``...Read`` por simplicidad — el snapshot ya es JSON
  liviano y no vale la pena recortar campos en este volumen de datos.
* ``LegalDocumentVersionCompareResponse`` — payload para el endpoint de
  compare side-by-side. Devuelve dos snapshots completos + ``diff`` (sólo
  claves que cambiaron, mismo formato que ``audit.action_log.diff_after``).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class LegalDocumentVersionRead(BaseModel):
    version_id: int
    documento_id: int
    version_number: int
    snapshot: dict[str, Any]
    changed_by: str | None = None
    changed_at: datetime
    change_summary: str | None = None

    model_config = {"from_attributes": True}


class LegalDocumentVersionCompareResponse(BaseModel):
    """Payload del endpoint compare. ``diff`` lista sólo las claves que
    difieren — mismo contrato que ``audit.action_log.diff_*``.
    """

    version_a: dict[str, Any]
    version_b: dict[str, Any]
    diff: dict[str, Any]
