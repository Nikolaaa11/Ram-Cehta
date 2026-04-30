"""legal_document_versions (V4 fase 3 — document version history)

Revision ID: 0019
Revises: 0018
Create Date: 2026-04-29

Tabla `core.legal_document_versions`: snapshot JSONB del documento legal
en cada PATCH (estado anterior) y en POST (estado inicial). Permite que
auditores y abogados reconstruyan qué decía un contrato en una fecha X.

Decisiones:
- ON DELETE CASCADE sobre `documento_id` — si por algún motivo se borra
  físicamente el documento padre, las versiones se limpian solas.
- UNIQUE (documento_id, version_number) — secuencial por documento.
- Index DESC sobre (documento_id, version_number) para "list versions of
  doc X" en O(log n) sin sort en runtime.
- Index sobre changed_at para timeline global eventual.

RLS: misma política que `core.legal_documents` — read abierto a
authenticated, write a admin/finance. Restore va via endpoint que ya
gates con `current_admin_with_2fa` (defense-in-depth).

Idempotente: CREATE IF NOT EXISTS / DROP POLICY IF EXISTS.
"""
from __future__ import annotations

from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.legal_document_versions (
            version_id      BIGSERIAL PRIMARY KEY,
            documento_id    BIGINT NOT NULL REFERENCES core.legal_documents(documento_id) ON DELETE CASCADE,
            version_number  INTEGER NOT NULL,
            snapshot        JSONB NOT NULL,
            changed_by      UUID NULL,
            changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            change_summary  TEXT NULL,
            CONSTRAINT uq_legal_doc_version UNIQUE (documento_id, version_number)
        );

        CREATE INDEX IF NOT EXISTS idx_legal_doc_version_doc
            ON core.legal_document_versions(documento_id, version_number DESC);

        CREATE INDEX IF NOT EXISTS idx_legal_doc_version_changed_at
            ON core.legal_document_versions(changed_at DESC);

        ALTER TABLE core.legal_document_versions ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS legal_versions_read ON core.legal_document_versions;
        CREATE POLICY legal_versions_read ON core.legal_document_versions
            FOR SELECT TO authenticated USING (TRUE);

        DROP POLICY IF EXISTS legal_versions_write ON core.legal_document_versions;
        CREATE POLICY legal_versions_write ON core.legal_document_versions
            FOR ALL TO authenticated
            USING (public.app_role() IN ('admin','finance'))
            WITH CHECK (public.app_role() IN ('admin','finance'));
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS core.legal_document_versions CASCADE;
        """
    )
