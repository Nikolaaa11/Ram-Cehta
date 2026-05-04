"""Standalone runner del generador de alertas in-app — invocado por cron.

Diseño igual a `etl_cron.py`:
- Abre una `AsyncSession` independiente.
- Corre `NotificationGeneratorService.run_all()` que crea/refresca alertas:
    F29 due (próximos 7 días), contratos due (próximos 30 días),
    OCs estancadas (>7 días emitida sin pagar).
- Idempotente: el servicio mismo deduplica por `(user_id, entity, tipo)`
  en ventana de 24h, asi que correr cada hora no spamea.
- Imprime resultado en JSON para `flyctl logs`.

Setup en Fly.io:

    [processes]
        app          = "uvicorn app.main:app --host 0.0.0.0 --port 8000"
        etl_cron     = "python -m scripts.etl_cron"
        alerts_cron  = "python -m scripts.alerts_cron"

    Y schedule en la machine: `fly machine update <id> --schedule hourly`.

Antes este generador solo corria al startup del web app — si Fly auto-pausaba
la machine y nadie la usaba por horas, las alertas se congelaban. Esto las
mantiene frescas sin depender del trafico HTTP.
"""
from __future__ import annotations

import asyncio
import json
import sys

from app.core.database import SessionLocal
from app.services.notification_generator_service import (
    NotificationGeneratorService,
)


async def main() -> int:
    async with SessionLocal() as db:
        try:
            svc = NotificationGeneratorService(db)
            report = await svc.run_all()
            await db.commit()
        except Exception as exc:  # pragma: no cover — defensive
            print(json.dumps({"status": "failed", "error": str(exc)}))
            return 1

        print(
            json.dumps(
                {
                    "status": "ok",
                    "f29_due": report.f29_due,
                    "contrato_due": report.contrato_due,
                    "oc_pending": report.oc_pending,
                    "total": report.total,
                },
                default=str,
            )
        )
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
