"""user_preferences (V4 fase 4 — onboarding tour for first-time users).

Tabla `app.user_preferences`: key-value genérico per-user. PK compuesta
`(user_id, key)`.

Decisiones:
- JSONB en `value` para aceptar cualquier shape sin migrar el schema cada
  vez que aparece una preferencia nueva.
- Sin FK a `auth.users` — la limpieza pasa por el delete del user_role en
  `core.user_roles` (cascada manual, defense-in-depth).
- Idempotente (CREATE TABLE IF NOT EXISTS).

Revision ID: 0021
Revises: 0020
Create Date: 2026-04-29
"""
from __future__ import annotations

from alembic import op

# revision identifiers
revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS app")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS app.user_preferences (
            user_id     UUID NOT NULL,
            key         VARCHAR(64) NOT NULL,
            value       JSONB NOT NULL,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (user_id, key)
        )
        """
    )

    # Index secundario por key — útil para debugging / migrations futuras
    # (e.g. "cuántos users completaron el onboarding tour").
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_preferences_key
            ON app.user_preferences (key)
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app.user_preferences CASCADE")
