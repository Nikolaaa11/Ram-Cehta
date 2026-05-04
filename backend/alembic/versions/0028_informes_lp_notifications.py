"""V4 fase 9.2 — Tabla `app.informes_lp_notifications` para tracking de
emails enviados (anti-duplicado).

Cuando un LP comparte y el destinatario abre/convierte, queremos avisar al
LP padre. Pero no queremos spamear: si el destinatario abre 5 veces el
informe, mandamos UNA sola notificación de "open".

Esta tabla guarda qué notificaciones ya enviamos. La unicidad es por
(child_token, tipo) — una notificación de cada tipo (`open`, `convert`)
por cada child.

Idempotencia:
- INSERT con ON CONFLICT DO NOTHING en el service de notifications.
- Si la tabla está rota, el cron loggea warning y sigue (no critical).
"""
from __future__ import annotations

from alembic import op

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS app.informes_lp_notifications (
            notification_id   BIGSERIAL PRIMARY KEY,
            child_token       TEXT NOT NULL,
            parent_token      TEXT NOT NULL,
            tipo              TEXT NOT NULL CHECK (tipo IN ('share_sent', 'open', 'convert')),
            email_destinatario TEXT NOT NULL,
            email_to          TEXT NOT NULL,
            sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            resend_id         TEXT,
            error             TEXT,
            metadata          JSONB DEFAULT '{}'::jsonb,
            UNIQUE (child_token, tipo)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_informes_notifs_parent ON app.informes_lp_notifications(parent_token);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_informes_notifs_sent_at ON app.informes_lp_notifications(sent_at DESC);"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app.informes_lp_notifications CASCADE;")
