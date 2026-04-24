"""initial schema — aplica db/schema.sql, db/views.sql, db/rls.sql

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-04-24

Estrategia: la fuente de verdad del schema es el SQL plano en db/*.sql
(viene del ETL y es versionable como DDL puro). Esta migración simplemente
los ejecuta. A partir de aquí, las migraciones incrementales se hacen con
Alembic + `op.execute(...)` o modelos SQLAlchemy reflejados.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0001_initial_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DB_DIR = Path(__file__).resolve().parents[3] / "db"


def _read(name: str) -> str:
    return (_DB_DIR / name).read_text(encoding="utf-8")


def upgrade() -> None:
    op.execute(_read("schema.sql"))
    op.execute(_read("views.sql"))
    op.execute(_read("rls.sql"))


def downgrade() -> None:
    # Drop cascade en schemas. Agresivo pero reversible — el ETL puede
    # recargar desde cero y las views se recrean desde el SQL plano.
    op.execute("DROP SCHEMA IF EXISTS core  CASCADE;")
    op.execute("DROP SCHEMA IF EXISTS raw   CASCADE;")
    op.execute("DROP SCHEMA IF EXISTS stg   CASCADE;")
    op.execute("DROP SCHEMA IF EXISTS audit CASCADE;")
