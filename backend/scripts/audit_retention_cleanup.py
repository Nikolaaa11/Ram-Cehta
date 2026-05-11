"""V5++ ola AJ — Retention cleanup de audit.http_mutations.

Borra rows con timestamp > 90 días. Pensado para correr semanalmente
como Fly cron. Sin esto la tabla crece sin tope.

Estrategia: DELETE en lotes de 10k rows para no bloquear writes en
producción. Postgres marca rows como dead pero no recupera espacio
hasta VACUUM — corremos VACUUM ANALYZE al final.

Uso:
    fly ssh console -a cehta-backend
    python -m scripts.audit_retention_cleanup

    O agendado:
    fly machines create --schedule weekly \\
        --command "python -m scripts.audit_retention_cleanup" \\
        -a cehta-backend

Si querés cambiar la retención (default 90d), seteá env var:
    AUDIT_RETENTION_DAYS=30
"""
from __future__ import annotations

import asyncio
import os
import sys

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession

from app.core.config import settings

log = structlog.get_logger(__name__)


RETENTION_DAYS = int(os.environ.get("AUDIT_RETENTION_DAYS", "90"))
BATCH_SIZE = 10000


async def main() -> int:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    total_deleted = 0

    async with AsyncSession(engine) as session:
        while True:
            result = await session.execute(
                text(
                    """
                    WITH deleted AS (
                        DELETE FROM audit.http_mutations
                        WHERE id IN (
                            SELECT id
                            FROM audit.http_mutations
                            WHERE timestamp < now() - (:days || ' days')::INTERVAL
                            LIMIT :batch
                        )
                        RETURNING id
                    )
                    SELECT COUNT(*) FROM deleted
                    """
                ),
                {"days": str(RETENTION_DAYS), "batch": BATCH_SIZE},
            )
            deleted = result.scalar() or 0
            await session.commit()

            total_deleted += deleted
            log.info("retention_batch_deleted", count=deleted, total=total_deleted)

            if deleted < BATCH_SIZE:
                break

        # VACUUM no se puede correr dentro de transacción, usar autocommit
        # Cerramos session async normal y usamos sync para VACUUM
        try:
            await session.execute(text("VACUUM ANALYZE audit.http_mutations;"))
            await session.commit()
        except Exception as exc:  # noqa: BLE001
            log.warning("vacuum_failed", error=str(exc))

    log.info(
        "audit_retention_done",
        deleted=total_deleted,
        retention_days=RETENTION_DAYS,
    )
    print(
        f"\n✅ Audit retention completo:\n"
        f"   - {total_deleted} rows borradas (>{RETENTION_DAYS} días)\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
