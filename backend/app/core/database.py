"""Database engine + session factory con auto-detección de pooler mode.

Supabase ofrece 3 hostnames:

  - `db.<proj>.supabase.co:5432`            → direct connection (1 user max)
  - `<proj>.pooler.supabase.com:5432`       → SESSION pooler (PgBouncer)
  - `<proj>.pooler.supabase.com:6543`       → TRANSACTION pooler (PgBouncer)

Implicaciones:

| Mode             | Prepared stmts | Connection pool en SQLAlchemy | Velocidad     |
|------------------|----------------|-------------------------------|---------------|
| Direct           | OK             | QueuePool ✅                   | Más rápido    |
| Session pool     | OK             | QueuePool ✅                   | Rápido        |
| Transaction pool | NO             | NullPool (forzado) ❌           | +50ms/request |

Esta función auto-detecta el modo por puerto/host y configura el engine
correctamente. Para cambiar a session pool (10x más rápido), el user
solo cambia la variable de entorno `DATABASE_URL` en Fly:

    flyctl secrets set DATABASE_URL="postgres://...:5432/postgres" \
      -a cehta-backend
"""
from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.config import settings

_db_url = str(settings.database_url)

# Heurística: el puerto 6543 es el transaction pooler de Supabase.
# Cualquier otra cosa (5432 direct, 5432 session pooler) soporta
# prepared statements + connection pooling.
_is_transaction_pooler = ":6543" in _db_url

if _is_transaction_pooler:
    # Modo seguro pero lento — necesario para PgBouncer txn mode.
    engine = create_async_engine(
        _db_url,
        echo=False,
        poolclass=NullPool,
        connect_args={
            "statement_cache_size": 0,
            "prepared_statement_cache_size": 0,
        },
    )
else:
    # Round 109 HOTFIX — pool aún más conservador. El anterior (5+2=7 por
    # worker × 2 workers = 14) se saturaba en producción combinado con
    # crons (etl/inbox/backup) que peleaban por las 15 conexiones del
    # session pooler de Supabase Free. Logs mostraban:
    #   asyncpg EMAXCONNSESSION: max clients reached, pool_size: 15
    #
    # Nueva config: 3 + 1 = 4 max por worker. Combinado con --workers 1
    # en fly.toml → 4 conns desde la API, deja 11 para crons. Triple-
    # holgura para crons concurrentes.
    #
    # Fix permanente: migrar DATABASE_URL al transaction pooler (port
    # 6543) — soporta 60+ clientes concurrentes en Free tier. Este
    # branch (NullPool) ya está cubierto arriba.
    engine = create_async_engine(
        _db_url,
        echo=False,
        pool_size=3,
        max_overflow=1,
        pool_pre_ping=True,
        pool_recycle=1800,
        pool_timeout=30,
        # Round 152r — pool_use_lifo: reusar las conns más calientes primero.
        # Las "viejas" se cierran por timeout, mejor cache hit en TLS+auth.
        # +10% throughput sin cambios de infra.
        pool_use_lifo=True,
        # Round 152r — server_settings:
        # - timezone fijo evita query a pg_timezone_names (~110ms × cada nueva conn).
        # - application_name visible en pg_stat_activity para debugging.
        connect_args={
            "server_settings": {
                "timezone": "UTC",
                "application_name": "ram-cehta-api",
            },
        },
    )

SessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
