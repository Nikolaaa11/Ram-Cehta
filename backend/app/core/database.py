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
    # V5++ ola BS HOTFIX: pool reducido para fit en Supabase session pooler
    # Supabase Free tier: 15 clients en session mode
    # Supabase Pro:       60 clients en session mode
    # Conservador: 8+4=12 por app machine. Con 1 release machine durante
    # deploy → 13-14 total, fits en Free tier sin saturar.
    # Si necesitás más concurrencia, hay que subir el tier en Supabase.
    engine = create_async_engine(
        _db_url,
        echo=False,
        pool_size=8,            # 8 conexiones live (era 25)
        max_overflow=4,         # +4 burst hasta 12 totales (era 15)
        pool_pre_ping=True,     # detect dead connections
        pool_recycle=900,       # reciclar a los 15min
        pool_timeout=30,        # max espera por conexión del pool
        connect_args={
            # asyncpg cache (queries parsed AST)
            "prepared_statement_cache_size": 512,
            # asyncpg statement timeout — 30s antes de cortar query lenta
            "command_timeout": 30,
        },
        # SQLAlchemy compiled SQL cache (separado del asyncpg cache)
        query_cache_size=2048,
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
