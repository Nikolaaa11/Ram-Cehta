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
    # V5++ ola BS HOTFIX FINAL: pool ultra conservador para Supabase Free tier
    # 5 + 2 = 7 max por app machine. Fits dentro del límite de 15 clients
    # del session pooler aunque haya release machine + app machine.
    engine = create_async_engine(
        _db_url,
        echo=False,
        pool_size=5,
        max_overflow=2,
        pool_pre_ping=True,
        pool_recycle=1800,
        pool_timeout=30,
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
