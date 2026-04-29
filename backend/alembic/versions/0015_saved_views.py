"""saved views per user (V3 fase 11 — Saved filters per user)

Revision ID: 0015
Revises: 0014
Create Date: 2026-04-29

Tabla `app.saved_views`: cada usuario guarda combinaciones nombradas de
filtros para sus páginas list (OCs, F29, trabajadores, proveedores,
legal, fondos), y puede pinear las favoritas.

- `filters` JSONB: shape libre por página (el frontend tipea cada uno).
- `page` enum-by-CHECK: cerrado para que un cambio de string en frontend
  no quiebre el contrato silenciosamente.
- Idempotente: usa CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
- RLS: análogo a `notifications` (fase 8) — cada user ve / muta solo
  filas con `user_id = auth.uid()`.

Indices:
- `idx_saved_views_user_page` (user_id, page) → list rápido por página.
- `idx_saved_views_user_pinned` (user_id) WHERE is_pinned=true → partial
  para el bloque "pinned" del dropdown.
"""
from __future__ import annotations

from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE SCHEMA IF NOT EXISTS app;

        CREATE TABLE IF NOT EXISTS app.saved_views (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     UUID NOT NULL,
            page        VARCHAR(32) NOT NULL CHECK (page IN (
                'oc','f29','trabajadores','proveedores','legal','fondos'
            )),
            name        VARCHAR(80) NOT NULL,
            filters     JSONB NOT NULL DEFAULT '{}'::jsonb,
            is_pinned   BOOLEAN NOT NULL DEFAULT false,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_saved_views_user_page
            ON app.saved_views(user_id, page);
        CREATE INDEX IF NOT EXISTS idx_saved_views_user_pinned
            ON app.saved_views(user_id)
            WHERE is_pinned = true;
        CREATE INDEX IF NOT EXISTS idx_saved_views_user
            ON app.saved_views(user_id);

        ALTER TABLE app.saved_views ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS saved_views_own_read ON app.saved_views;
        CREATE POLICY saved_views_own_read ON app.saved_views
            FOR SELECT TO authenticated
            USING (user_id = auth.uid());

        DROP POLICY IF EXISTS saved_views_own_write ON app.saved_views;
        CREATE POLICY saved_views_own_write ON app.saved_views
            FOR ALL TO authenticated
            USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid());
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS app.saved_views CASCADE;
        """
    )
