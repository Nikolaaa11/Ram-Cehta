"""Standalone ETL runner — invocado por cron (Fly machine schedule, GHA, etc.).

Diseño:
- Abre una `AsyncSession` independiente (no comparte el pool de la app web).
- Si Dropbox no está conectado, hace early-return con exit 0 (un cron que
  falla constantemente disparía alertas innecesarias mientras el admin no
  conecta la cuenta).
- Imprime resultado a stdout en JSON-friendly para `flyctl logs` / Sentry.

Setup en Fly.io:

    [processes]
        app = "uvicorn app.main:app --host 0.0.0.0 --port 8000"
        etl_cron = "python -m scripts.etl_cron"

    Y schedule: machine independiente con `fly machine update --schedule "*/30 * * * *"`.

Alternativa low-cost: GitHub Actions cron que llama POST /etl/run con un
service-role token. Documentado en `docs/etl-setup.md`.
"""
from __future__ import annotations

import asyncio
import json
import sys

from app.core.database import SessionLocal
from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)
from app.services.dropbox_service import DropboxNotConfigured, DropboxService
from app.services.dropbox_sync_service import DropboxSyncService
from app.services.etl_service import ETLService


async def main() -> int:
    async with SessionLocal() as db:
        integration = await IntegrationRepository(db).get_by_provider("dropbox")
        if integration is None:
            print(
                json.dumps(
                    {"status": "skipped", "reason": "dropbox_not_connected"}
                )
            )
            return 0

        try:
            dbx = DropboxService(
                access_token=integration.access_token,
                refresh_token=integration.refresh_token,
            )
        except DropboxNotConfigured as exc:
            print(json.dumps({"status": "failed", "error": str(exc)}))
            return 1

        try:
            result = await ETLService().run_etl(db, dbx, triggered_by="scheduled")
        except Exception as exc:  # pragma: no cover — defensive
            print(json.dumps({"status": "failed", "error": str(exc)}))
            return 1

        print(json.dumps(result.to_dict(), default=str))

        # EEFF Dropbox sync — corre cada hora junto al ETL.
        # Se ejecuta después del Excel ETL y reusa la misma sesión + Dropbox
        # client. Errores de empresa individual no abortan el sync entero.
        try:
            sync_service = DropboxSyncService(db, dbx)
            eeff_result = (
                await sync_service.sync_estados_financieros_all_empresas()
            )
            await db.commit()
        except Exception as exc:  # pragma: no cover — defensive
            print(json.dumps({"type": "eeff_sync", "status": "failed", "error": str(exc)}))
            # No fallar el cron entero por esto — el Excel ETL ya corrió OK.
        else:
            print(
                json.dumps(
                    {"type": "eeff_sync", **eeff_result.to_dict()},
                    default=str,
                )
            )

        # exit 0 incluso en partial — hubo trabajo legitimo. Solo failed → 1.
        return 0 if result.status != "failed" else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
