"""Repository para `core.legal_document_versions` (V4 fase 3).

API:

* ``list_for_document(documento_id)`` — devuelve todas las versiones
  ordenadas por ``version_number DESC`` (la más reciente primero).
* ``create_snapshot(documento_id, snapshot, changed_by, change_summary)`` —
  inserta una nueva versión con auto-incremento del ``version_number``
  (SELECT MAX(...) + 1 dentro de la misma sesión). Best-effort sobre
  contención: con el volumen low-throughput de legal docs, no hay riesgo
  real de race; igual el UNIQUE constraint protege la integridad.
* ``get_version(documento_id, version_number)`` — busca la versión exacta
  para los endpoints de detalle, compare y restore.

Patrón consistente con `LegalRepository`: el commit lo hace el endpoint,
acá sólo flush + refresh.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.legal_document_version import LegalDocumentVersion


class LegalVersionRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_for_document(
        self, documento_id: int
    ) -> list[LegalDocumentVersion]:
        """Versiones del documento, más nueva primero."""
        q = (
            select(LegalDocumentVersion)
            .where(LegalDocumentVersion.documento_id == documento_id)
            .order_by(LegalDocumentVersion.version_number.desc())
        )
        return list((await self._session.scalars(q)).all())

    async def get_version(
        self, documento_id: int, version_number: int
    ) -> LegalDocumentVersion | None:
        q = select(LegalDocumentVersion).where(
            LegalDocumentVersion.documento_id == documento_id,
            LegalDocumentVersion.version_number == version_number,
        )
        return (await self._session.scalars(q)).one_or_none()

    async def _next_version_number(self, documento_id: int) -> int:
        """SELECT MAX(version_number) + 1, default 1."""
        q = select(func.max(LegalDocumentVersion.version_number)).where(
            LegalDocumentVersion.documento_id == documento_id
        )
        current = await self._session.scalar(q)
        return (current or 0) + 1

    async def create_snapshot(
        self,
        *,
        documento_id: int,
        snapshot: dict[str, Any],
        changed_by: str | None,
        change_summary: str | None,
    ) -> LegalDocumentVersion:
        """Inserta una nueva versión con version_number auto-incrementado."""
        version_number = await self._next_version_number(documento_id)
        row = LegalDocumentVersion(
            documento_id=documento_id,
            version_number=version_number,
            snapshot=snapshot,
            changed_by=changed_by,
            change_summary=change_summary,
        )
        self._session.add(row)
        await self._session.flush()
        await self._session.refresh(row)
        return row
