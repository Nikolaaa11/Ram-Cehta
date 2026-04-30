"""user 2FA TOTP (V4 fase 2 — 2FA TOTP for admin role)

Revision ID: 0018
Revises: 0017
Create Date: 2026-04-29

Tabla `app.user_2fa`: cada usuario puede activar 2FA TOTP. Pensado
inicialmente para ser obligatorio en rol `admin` sobre 4 endpoints
high-impact (soft-rollout).

Diseño:
- `user_id` UUID PK (no FK — Supabase users live en `auth` schema, fuera
  de nuestro control de migración). El cleanup queda implícito al borrar
  el rol del usuario en `core.user_roles`.
- `secret` base32 (string, 32 chars típicos). Solo viaja al frontend en
  la respuesta de `enroll`.
- `backup_codes` ARRAY(TEXT) con 10 hashes sha256 hex. Cuando el user
  consume uno, el slot pasa a `''` y queda inservible (no se reutiliza).
- `enabled` empieza en `false` y solo pasa a `true` después del primer
  verify OK — proof-of-possession del autenticador.
- `enabled_at` se llena en el verify exitoso (auditoría).

Idempotente: CREATE TABLE IF NOT EXISTS.
RLS análogo a `saved_views` y `notifications` — cada user solo lee/muta
su propia fila.
"""
from __future__ import annotations

from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE SCHEMA IF NOT EXISTS app;

        CREATE TABLE IF NOT EXISTS app.user_2fa (
            user_id       UUID PRIMARY KEY,
            secret        VARCHAR(64) NOT NULL,
            enabled       BOOLEAN NOT NULL DEFAULT false,
            backup_codes  TEXT[] NOT NULL DEFAULT '{}',
            enabled_at    TIMESTAMPTZ NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        ALTER TABLE app.user_2fa ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS user_2fa_own_read ON app.user_2fa;
        CREATE POLICY user_2fa_own_read ON app.user_2fa
            FOR SELECT TO authenticated
            USING (user_id = auth.uid());

        DROP POLICY IF EXISTS user_2fa_own_write ON app.user_2fa;
        CREATE POLICY user_2fa_own_write ON app.user_2fa
            FOR ALL TO authenticated
            USING (user_id = auth.uid())
            WITH CHECK (user_id = auth.uid());
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS app.user_2fa CASCADE;
        """
    )
