"""V4 fase1 — webhook subscriptions + deliveries.

Tablas en schema `app`:
- `webhook_subscriptions` — qué URLs reciben qué eventos
- `webhook_deliveries` — log de cada intento (auditoría)

Revision ID: 0017_webhooks
Revises: 0016_currency_rates
Create Date: 2026-04-29
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "0017_webhooks"
# Tolerante a otras 0016: si el otro agente nombró su revision distinto,
# corremos sobre HEAD generic; verificar al merge.
down_revision = "0016_currency_rates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS app")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS app.webhook_subscriptions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            target_url TEXT NOT NULL,
            secret TEXT NOT NULL,
            events TEXT[] NOT NULL DEFAULT '{}',
            description TEXT,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_by UUID,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_active
            ON app.webhook_subscriptions (active)
            WHERE active = TRUE
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_events_gin
            ON app.webhook_subscriptions USING GIN (events)
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS app.webhook_deliveries (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            subscription_id UUID NOT NULL
                REFERENCES app.webhook_subscriptions(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL,
            payload JSONB NOT NULL,
            status_code INTEGER,
            response_body TEXT,
            error TEXT,
            attempt INTEGER NOT NULL DEFAULT 1,
            delivered_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub_created
            ON app.webhook_deliveries (subscription_id, created_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status
            ON app.webhook_deliveries (status_code, created_at DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app.webhook_deliveries CASCADE")
    op.execute("DROP TABLE IF EXISTS app.webhook_subscriptions CASCADE")
