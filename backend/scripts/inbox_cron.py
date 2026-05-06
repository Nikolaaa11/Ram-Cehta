"""Standalone runner del IMAP poll + clasificación AI — invocado por cron.

Diseño igual a `alerts_cron.py`:
- Abre una `AsyncSession` independiente.
- Corre `inbox_processor_service.poll_inbox()` (IMAP fetch UNSEEN +
  upload adjuntos a Dropbox).
- Corre `inbox_processor_service.classify_pending()` (Claude clasifica
  los nuevos + genera draft de respuesta).
- Idempotente:
    * IMAP poll usa `ON CONFLICT (message_id) DO NOTHING` → no duplica.
    * Classify solo procesa rows con `status='received'`.
- Soft-fail: si IMAP no está configurado, log warning y exit 0 (no
  rompe el cron loop de Fly).
- Imprime resultado en JSON para `flyctl logs`.

Setup en Fly.io (ya hecho en fly.toml):

    [processes]
        inbox_cron = "python -m scripts.inbox_cron"

    Y schedule en la machine:
        `fly machine update <id> --schedule "*/15 * * * *"` (cada 15 min)

Frecuencia recomendada: cada 15 minutos. Razón:
- Gmail IMAP soporta 250 conexiones/día gratis. 15min = 96 conexiones/día.
- Latencia razonable para que un email entrante esté procesado en
  máximo 15min sin spam de poll.
- Costo Claude bajo: ~50 emails/día × $0.003 = $0.15/día.

Variables de entorno requeridas (Fly secrets):
    INBOX_IMAP_USER       (ej: contactocehta@gmail.com)
    INBOX_IMAP_PASSWORD   (Gmail App Password — NO la del usuario)
    ANTHROPIC_API_KEY     (para clasificación; soft-fail si falta)
    DROPBOX_REFRESH_TOKEN (para subir adjuntos; soft-fail si falta)
"""
from __future__ import annotations

import asyncio
import json
import sys

import structlog

from app.core.database import SessionLocal
from app.services.inbox_processor_service import (
    InboxNotConfigured,
    classify_pending,
    poll_inbox,
)

log = structlog.get_logger(__name__)


async def main() -> int:
    poll_result: dict = {"status": "skipped", "reason": "imap_not_configured"}
    classify_result: dict = {"classified": 0, "errors": 0, "skipped": 0}

    async with SessionLocal() as db:
        # 1) Poll IMAP
        try:
            poll_result = await poll_inbox(db)
            poll_result["status"] = "ok"
        except InboxNotConfigured as exc:
            poll_result = {"status": "skipped", "reason": str(exc)}
            print(json.dumps({"poll": poll_result}, default=str))
            return 0
        except Exception as exc:  # pragma: no cover — defensive
            print(json.dumps({"status": "poll_failed", "error": str(exc)}))
            return 1

        # 2) Classify pendientes (incluye los recién insertados)
        try:
            classify_result = await classify_pending(db)
        except Exception as exc:  # pragma: no cover — defensive
            log.exception("inbox_cron.classify_failed", error=str(exc))
            classify_result = {"error": str(exc)}

    print(
        json.dumps(
            {
                "status": "ok",
                "poll": poll_result,
                "classify": classify_result,
            },
            default=str,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
