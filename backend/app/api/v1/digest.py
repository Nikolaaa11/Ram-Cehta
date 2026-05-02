"""CEO Weekly Digest endpoints (V3 fase 10).

3 rutas, todas admin-only (`notifications:admin`):

  - GET  /digest/ceo-weekly/preview        → JSON payload (frontend preview)
  - GET  /digest/ceo-weekly/preview.html   → HTML del email (iframe preview)
  - POST /digest/ceo-weekly/send-now       → dispara envío vía Resend

El cron (lunes 8am) lo orquesta un Vercel cron / GitHub Action externo
que pega contra `POST /digest/ceo-weekly/send-now` con bearer admin.
NO arrancamos cron desde startup de FastAPI.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import HTMLResponse

from app.api.deps import DBSession, current_admin_with_2fa, require_scope
from app.core.config import settings
from app.core.security import AuthenticatedUser
from app.schemas.digest import (
    CEODigestPayload,
    DigestSendRequest,
    DigestSendResult,
    EntregablesDigestPayload,
)
from app.services.digest_service import DigestService

router = APIRouter()


@router.get("/ceo-weekly/preview", response_model=CEODigestPayload)
async def digest_preview(
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("notifications:admin"))
    ],
    db: DBSession,
) -> CEODigestPayload:
    """Devuelve el payload JSON del digest semanal (admin-only)."""
    svc = DigestService(db)
    return await svc.build_ceo_weekly_digest()


@router.get(
    "/ceo-weekly/preview.html",
    response_class=HTMLResponse,
    responses={200: {"content": {"text/html": {}}}},
)
async def digest_preview_html(
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("notifications:admin"))
    ],
    db: DBSession,
) -> HTMLResponse:
    """Devuelve el HTML del email exactamente como va a llegar al CEO.

    Útil para iframe de preview en `/admin/digest`.
    """
    svc = DigestService(db)
    payload = await svc.build_ceo_weekly_digest()
    html = svc.build_html(payload)
    return HTMLResponse(content=html, status_code=200)


@router.post(
    "/ceo-weekly/send-now",
    response_model=DigestSendResult,
    # V4 fase 2: high-impact (envío real de email).
    dependencies=[Depends(current_admin_with_2fa)],
)
async def digest_send_now(
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("notifications:admin"))
    ],
    db: DBSession,
    body: DigestSendRequest | None = None,
) -> DigestSendResult:
    """Envía el digest a los recipients indicados o al default admin list.

    Devuelve 503 si `RESEND_API_KEY` no está configurada — soft-fail flow.
    """
    if not settings.resend_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Resend no configurado. Setear RESEND_API_KEY en el backend "
                "para habilitar el envío. Ver docs/email-setup.md"
            ),
        )

    recipients = body.recipients if body is not None else None
    svc = DigestService(db)
    return await svc.send_to_ceo(recipients=recipients)


# ─── Entregables Weekly Digest (V4 fase 7.8) ──────────────────────────


@router.get("/entregables-weekly/preview", response_model=EntregablesDigestPayload)
async def entregables_digest_preview(
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("notifications:admin"))
    ],
    db: DBSession,
) -> EntregablesDigestPayload:
    """JSON payload del digest semanal de entregables (admin-only)."""
    svc = DigestService(db)
    return await svc.build_entregables_digest()


@router.get(
    "/entregables-weekly/preview.html",
    response_class=HTMLResponse,
    responses={200: {"content": {"text/html": {}}}},
)
async def entregables_digest_preview_html(
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("notifications:admin"))
    ],
    db: DBSession,
) -> HTMLResponse:
    """Preview HTML del email de entregables (iframe-friendly)."""
    svc = DigestService(db)
    payload = await svc.build_entregables_digest()
    html = svc.build_entregables_html(payload)
    return HTMLResponse(content=html, status_code=200)


@router.post(
    "/entregables-weekly/send-now",
    response_model=DigestSendResult,
    dependencies=[Depends(current_admin_with_2fa)],
)
async def entregables_digest_send_now(
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("notifications:admin"))
    ],
    db: DBSession,
    body: DigestSendRequest | None = None,
) -> DigestSendResult:
    """Dispara el envío del digest semanal de entregables.

    Pensado para correr lunes 8am Chile vía GitHub Action cron.
    """
    if not settings.resend_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Resend no configurado. Setear RESEND_API_KEY en el backend "
                "para habilitar el envío. Ver docs/email-setup.md"
            ),
        )

    recipients = body.recipients if body is not None else None
    svc = DigestService(db)
    return await svc.send_entregables_digest(recipients=recipients)
