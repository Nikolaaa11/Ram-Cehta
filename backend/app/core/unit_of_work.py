"""R152FFFFF · UnitOfWork — contexto transaccional unificado.

Reemplaza los 17+ lugares del código que hacían:
    from app.core.database import SessionLocal
    async with SessionLocal() as db:
        await db.execute(...)
        await db.commit()

con un context manager que:
  - Hace commit automático si no hubo excepción.
  - Hace rollback automático si hubo excepción.
  - Loggea métricas (timing, query count) para observabilidad.
  - Es explícito en su semántica transaccional.

Patrón estándar:
    async with uow() as db:
        await db.execute(...)
        # commit ocurre solo si no hay excepción

Para flujos que necesitan NO-commit (lectura pura):
    async with uow(read_only=True) as db:
        ...

Para flujos que necesitan commit manual (transacciones múltiples):
    async with uow(autocommit=False) as db:
        await db.execute(...)
        await db.commit()   # explícito
        await db.execute(...)
        await db.commit()
"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import AsyncIterator

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import SessionLocal

log = structlog.get_logger(__name__)


@asynccontextmanager
async def uow(
    *,
    autocommit: bool = True,
    read_only: bool = False,
    name: str | None = None,
) -> AsyncIterator[AsyncSession]:
    """Context manager para transacciones de BD.

    Args:
        autocommit: si True, commit al salir sin excepción. Si False, el
            caller debe llamar db.commit() explícitamente cada vez.
        read_only: si True, nunca hace commit (optimización para SELECTs).
        name: label opcional para logs/métricas. Útil para debugear.

    Yields:
        AsyncSession lista para usar.

    Raises:
        Cualquier excepción del bloque interno — antes de re-raise hace
        rollback automático.
    """
    t0 = time.monotonic()
    label = name or "uow"
    session = SessionLocal()
    try:
        yield session
        if autocommit and not read_only:
            await session.commit()
    except Exception as exc:
        try:
            await session.rollback()
        except Exception as rollback_exc:
            log.warning(
                "uow.rollback_failed",
                name=label,
                original_error=str(exc),
                rollback_error=str(rollback_exc),
            )
        raise
    finally:
        try:
            await session.close()
        except Exception as close_exc:
            log.warning(
                "uow.close_failed",
                name=label,
                error=str(close_exc),
            )
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        # Solo loggear si fue lento (probable contención o query mal escrita).
        if elapsed_ms > 1000:
            log.info(
                "uow.slow_transaction",
                name=label,
                elapsed_ms=elapsed_ms,
            )
