"""integrations table for OAuth tokens (Dropbox, etc.)

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-26

V3 fase 1 — habilita persistir refresh_tokens de proveedores OAuth (Dropbox
inicialmente). Single-tenant en esta fase: una única integración activa por
proveedor; multi-tenant queda para V4.

RLS: solo admin lee/escribe (matriz canónica `app.core.rbac` exige
`integration:write`). Las funciones `public.app_role()` y
`public.touch_updated_at()` ya existen (definidas en `db/rls.sql` y
`db/schema.sql`).
"""
from __future__ import annotations

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.integrations (
            integration_id   BIGSERIAL PRIMARY KEY,
            provider         TEXT NOT NULL,
            user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
            access_token     TEXT NOT NULL,
            refresh_token    TEXT,
            expires_at       TIMESTAMPTZ,
            account_info     JSONB,
            scopes           TEXT[],
            metadata         JSONB,
            connected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (provider, user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_integrations_provider
            ON core.integrations(provider);

        ALTER TABLE core.integrations ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS admin_manage_integrations ON core.integrations;
        CREATE POLICY admin_manage_integrations ON core.integrations
            FOR ALL TO authenticated
            USING (public.app_role() = 'admin')
            WITH CHECK (public.app_role() = 'admin');

        DROP TRIGGER IF EXISTS trg_touch_integrations ON core.integrations;
        CREATE TRIGGER trg_touch_integrations
            BEFORE UPDATE ON core.integrations
            FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS core.integrations CASCADE;")
