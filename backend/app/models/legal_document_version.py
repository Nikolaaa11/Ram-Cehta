"""Modelo `core.legal_document_versions` (V4 fase 3 — version history).

Cada PATCH sobre `core.legal_documents` genera una fila acá ANTES de aplicar
el update — versionamos el estado anterior. La creación inicial (POST /legal)
graba la versión 1 (snapshot del estado recién creado). Restore es
forward-only: nunca pisamos historia, siempre creamos una nueva versión.

Decisiones:
- `documento_id` con ON DELETE CASCADE — si el documento se borra físicamente
  (no es nuestro flujo, pero por si acaso), las versiones se limpian solas.
- `version_number` int sequential per documento_id (UNIQUE composite). El
  repo lo auto-incrementa con un SELECT MAX(...) + 1 dentro de la misma
  transacción — best-effort, si dos PATCHs concurrentes corren el segundo
  reintentaría, pero con la naturaleza low-throughput de legal eso es un
  no-issue real.
- `snapshot` JSONB con la representación completa del documento (output de
  `LegalDocumentRead.model_dump(mode='json')`). Guardamos todo el dict por
  simplicidad — el storage es trivialmente barato y permite reconstruir el
  documento sin joins.
- `change_summary` TEXT — resumen auto-generado del diff (1 campo →
  "Cambió X: A → B"; 2-3 → lista; 4+ → "Editó N campos"). Para versión 1
  (creación) → "Documento creado".
- Índices: por `(documento_id, version_number DESC)` para "list versions of
  doc X" y por `(changed_at DESC)` para timeline global eventual.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class LegalDocumentVersion(Base):
    __tablename__ = "legal_document_versions"
    __table_args__ = (
        UniqueConstraint(
            "documento_id",
            "version_number",
            name="uq_legal_doc_version",
        ),
        Index(
            "idx_legal_doc_version_doc",
            "documento_id",
            "version_number",
        ),
        Index("idx_legal_doc_version_changed_at", "changed_at"),
        {"schema": "core"},
    )

    version_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    documento_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("core.legal_documents.documento_id", ondelete="CASCADE"),
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    changed_by: Mapped[str | None] = mapped_column(UUID(as_uuid=False))
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    change_summary: Mapped[str | None] = mapped_column(Text)
