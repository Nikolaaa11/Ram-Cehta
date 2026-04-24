"""user_roles table and custom_access_token_hook

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-24
"""
from __future__ import annotations

from pathlib import Path

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001_initial_schema"
branch_labels = None
depends_on = None

_DB_DIR = Path(__file__).parent.parent.parent.parent / "db"


def _read(name: str) -> str:
    return (_DB_DIR / name).read_text(encoding="utf-8")


def upgrade() -> None:
    op.execute(_read("0002_user_roles.sql"))


def downgrade() -> None:
    op.execute("""
        DROP TRIGGER IF EXISTS trg_touch_user_roles ON core.user_roles;
        DROP POLICY IF EXISTS "self_read_role" ON core.user_roles;
        DROP POLICY IF EXISTS "admin_manage_roles" ON core.user_roles;
        DROP TABLE IF EXISTS core.user_roles CASCADE;
        DROP FUNCTION IF EXISTS public.custom_access_token_hook CASCADE;
    """)
