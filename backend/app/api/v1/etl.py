"""ETL endpoints — manual trigger + last-run + Dropbox webhook.

Endpoints:
- POST /etl/run            → admin trigger manual del ETL
- GET  /etl/last-run       → último run (cualquier status) — para frontend
- GET  /etl/webhook/dropbox → challenge verification (Dropbox lo llama así
                              al registrar el webhook en su dashboard)
- POST /etl/webhook/dropbox → notification real (Dropbox la firma con HMAC)

Diseño del webhook:
- Dropbox no incluye qué cambió en la notification, solo "algo en tu Dropbox
  cambió". Disparamos el ETL completo en background y dejamos que la lógica
  de hash decida si vale la pena procesar.
- Validación HMAC con `dropbox_client_secret`. Constant-time compare.
- Respuesta SIEMPRE 2xx en <10s o Dropbox marca el endpoint como caído y
  pausa notificaciones — por eso usamos BackgroundTasks.
"""
from __future__ import annotations

import hashlib
import hmac
from typing import Annotated, Any

import structlog
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Request,
    status,
)
from fastapi.responses import Response

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.audit_repository import AuditRepository
from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)
from app.schemas.audit import EtlRunRead
from app.services.dropbox_service import DropboxNotConfigured, DropboxService
from app.services.etl_service import ETLService

log = structlog.get_logger(__name__)

router = APIRouter()


@router.post("/run")
async def trigger_etl(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    triggered_by: str = "manual",
) -> dict[str, Any]:
    """Trigger ETL run manual (audit:read scope = admin only).

    Devuelve el resultado completo (status + counts + sample rejected). Si
    Dropbox no está conectado → 503 con mensaje útil.
    """
    integration = await IntegrationRepository(db).get_by_provider("dropbox")
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Dropbox no conectado. Conectá la cuenta corporativa en "
                "Admin > Integraciones antes de correr el ETL."
            ),
        )

    try:
        dbx = DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    result = await ETLService().run_etl(db, dbx, triggered_by=triggered_by)
    return result.to_dict()


@router.get("/last-run", response_model=EtlRunRead | None)
async def last_run(
    user: CurrentUser,
    db: DBSession,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> EtlRunRead | None:
    """Devuelve el último run ETL (filtrable por status).

    Útil para mostrar en el dashboard `/admin/etl` un highlight del estado
    actual sin paginar.
    """
    repo = AuditRepository(db)
    items, _ = await repo.list_etl_runs(status=status_filter, page=1, size=1)
    if not items:
        return None
    return EtlRunRead.model_validate(items[0])


# ---------------------------------------------------------------------------
# Dropbox webhook (público — auth via HMAC del payload)
# ---------------------------------------------------------------------------


@router.get("/webhook/dropbox", include_in_schema=False)
async def dropbox_webhook_challenge(
    challenge: str = Query(..., description="Challenge enviado por Dropbox"),
) -> Response:
    """Verifica el endpoint en el momento del registro en el Dropbox app dashboard.
    Dropbox manda `?challenge=<random>` y espera el mismo string como text/plain.
    """
    return Response(
        content=challenge,
        media_type="text/plain",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Type": "text/plain",
        },
    )


async def _run_etl_background() -> None:
    """Background task: corre el ETL en una sesión nueva (independiente del
    request-scope). Si Dropbox no está conectado, no hace nada — el webhook
    no debería ser llamado sin integración previa.
    """
    async with SessionLocal() as db:
        try:
            integration = await IntegrationRepository(db).get_by_provider("dropbox")
            if integration is None:
                log.warning("etl.webhook.no_integration")
                return
            dbx = DropboxService(
                access_token=integration.access_token,
                refresh_token=integration.refresh_token,
            )
            result = await ETLService().run_etl(db, dbx, triggered_by="webhook")
            log.info(
                "etl.webhook.completed",
                run_id=result.run_id,
                status=result.status,
                loaded=result.rows_loaded,
                rejected=result.rows_rejected,
            )
        except Exception:  # pragma: no cover — log y se traga
            log.exception("etl.webhook.failed")


@router.post("/webhook/dropbox", include_in_schema=False)
async def dropbox_webhook_notify(
    request: Request,
    background_tasks: BackgroundTasks,
) -> dict[str, bool]:
    """Notification real de Dropbox.

    Pasos:
    1. Validar firma HMAC-SHA256 con `dropbox_client_secret`.
    2. Encolar `run_etl` como BackgroundTask (responder 200 en <10s o Dropbox
       marca el endpoint como caído).
    3. La lógica de hash dentro del ETL decide si efectivamente hay que procesar.
    """
    if not settings.dropbox_client_secret:
        # Sin secret no podemos validar firma; rechazamos por seguridad.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Webhook deshabilitado: DROPBOX_CLIENT_SECRET no configurado.",
        )

    body = await request.body()
    signature = request.headers.get("x-dropbox-signature", "")
    expected = hmac.new(
        settings.dropbox_client_secret.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Dropbox signature",
        )

    background_tasks.add_task(_run_etl_background)
    return {"ok": True}


