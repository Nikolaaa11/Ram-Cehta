"""notifications inbox (V3 fase 8 — In-app notifications)

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-29

Inbox in-app de notificaciones por usuario. Las alertas las generan
servicios de backend (F29 por vencer, contratos por vencer, OCs
estancadas) y otras pueden ser system-wide. La tabla vive en el schema
`app` (separado de `core`/Excel).

Idempotencia: el generator filtra por `(user_id, entity_type, entity_id,
tipo)` en las últimas 24h antes de insertar, así correr el cron dos
veces no duplica.
"""
from __future__ import annotations

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE SCHEMA IF NOT EXISTS app;

        CREATE TABLE IF NOT EXISTS app.notifications (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id      UUID NOT NULL,
            tipo         TEXT NOT NULL CHECK (tipo IN (
                'f29_due','contrato_due','oc_pending','legal_due','system','mention'
            )),
            severity     TEXT NOT NULL DEFAULT 'info' CHECK (severity IN (
                'info','warning','critical'
            )),
            title        TEXT NOT NULL,
            body         TEXT NOT NULL DEFAULT '',
            link         TEXT,
            entity_type  TEXT,
            entity_id    TEXT,
            read_at      TIMESTAMPTZ,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
            ON app.notifications(user_id, read_at);
        CREATE INDEX IF NOT EXISTS idx_notifications_user_created
            ON app.notifications(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notifications_user
            ON app.notifications(user_id);

        ALTER TABLE app.notifications ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS notifications_own_read ON app.notifications;
        CREATE POLICY notifications_own_read ON app.notifications
            FOR SELECT TO authenticated
            USING (user_id = auth.uid());

        DROP POLICY IF EXISTS notifications_own_update ON app.notifications;
        CREATE POLICY notifications_own_update ON app.notifications
            FOR UPDATE TO authenticated
            USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid());
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS app.notifications CASCADE;
        """
    )
