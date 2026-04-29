"""audit.action_log (V3 fase 8 — audit log per-action)

Revision ID: 0013
Revises: 0012
Create Date: 2026-04-29

Per-action audit trail. Cada mutación API logea quién, qué, antes/después,
IP, UA. Best-effort: el service nunca rompe la mutación si falla el insert.

Schema `audit` ya existe (lo crearon migraciones previas). Acá sólo
creamos la tabla + índices.
"""
from __future__ import annotations

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE SCHEMA IF NOT EXISTS audit;

        CREATE TABLE IF NOT EXISTS audit.action_log (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id       UUID,
            user_email    TEXT,
            action        TEXT NOT NULL CHECK (action IN (
                'create','update','delete','approve','reject','sync','upload','other'
            )),
            entity_type   TEXT NOT NULL,
            entity_id     TEXT NOT NULL,
            entity_label  TEXT,
            summary       TEXT NOT NULL,
            diff_before   JSONB,
            diff_after    JSONB,
            ip            TEXT,
            user_agent    TEXT,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_action_log_entity
            ON audit.action_log(entity_type, entity_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_action_log_user
            ON audit.action_log(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_action_log_created
            ON audit.action_log(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_action_log_action
            ON audit.action_log(action, created_at DESC);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS audit.action_log CASCADE;
        """
    )
