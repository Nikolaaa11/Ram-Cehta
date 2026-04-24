from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Alembic usa el driver síncrono (psycopg/psycopg2). Convertimos el asyncpg URL si hace falta.
alembic_url = (
    os.getenv("ALEMBIC_DATABASE_URL")
    or str(settings.database_url).replace("+asyncpg", "")
)
config.set_main_option("sqlalchemy.url", alembic_url)

# target_metadata: por ahora None (migraciones escritas a mano o vía SQL plano).
# Cuando introduzcamos modelos SQLAlchemy, apuntamos a Base.metadata.
target_metadata = None


def run_migrations_offline() -> None:
    """Emit migrations as SQL without connecting to the DB."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_schemas=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
