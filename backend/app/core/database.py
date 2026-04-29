from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.config import settings

# Compatibilidad con Supabase Transaction Pooler (PgBouncer en modo `transaction`):
#
#   1. `statement_cache_size=0` — asyncpg NO cachea prepared statements.
#      Sin esto: `InvalidSQLStatementNameError: prepared statement "__asyncpg_stmt_30__" does not exist`.
#
#   2. `prepared_statement_cache_size=0` — refuerzo del anterior; algunas
#      versiones de asyncpg necesitan ambos.
#
#   3. `poolclass=NullPool` — desactivamos el connection pool de SQLAlchemy
#      y dejamos que PgBouncer haga el pooling (es lo que mejor sabe hacer).
#      Sin esto, SQLAlchemy mantiene conexiones cuyas prepared statements
#      pueden quedar invalidadas cuando PgBouncer rota el backend físico.
#
# La sobrecarga de conectarse "fresh" en cada request es ~5-10ms; aceptable
# para uso interno de baja concurrencia y resuelve el bug de fondo.
engine = create_async_engine(
    str(settings.database_url),
    echo=False,
    poolclass=NullPool,
    connect_args={
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
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
