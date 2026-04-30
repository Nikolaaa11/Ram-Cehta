"""V4 fase3 — public API tokens.

Tabla `app.api_tokens`. Cada token actúa como su `created_by` user
(hereda sus scopes via ROLE_SCOPES). El plaintext nunca se guarda;
sólo el SHA-256 hash.

Uso 0020 para no chocar con 0019 que un agente paralelo está
creando para document version history.

Revision ID: 0020_api_tokens
Revises: 0019_legal_versions
Create Date: 2026-04-29
"""
from __future__ import annotations

from alembic import op

# revision identifiers
revision = "0020_api_tokens"
down_revision = "0019_legal_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS app")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS app.api_tokens (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            description TEXT,
            token_hash TEXT NOT NULL UNIQUE,
            created_by UUID NOT NULL,
            last_used_at TIMESTAMPTZ,
            expires_at TIMESTAMPTZ,
            revoked_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    # Index used by `verify_token`: lookup por hash es la query más caliente
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash
            ON app.api_tokens (token_hash)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_api_tokens_created_by
            ON app.api_tokens (created_by, created_at DESC)
        """
    )
    # Partial index para listar tokens activos rápido
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_api_tokens_active
            ON app.api_tokens (created_at DESC)
            WHERE revoked_at IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS app.api_tokens CASCADE")
