"""Notifications endpoints — admin-only para configurar/probar Resend.

V3 fase 3+4: el envío real de emails (alertas legal, recordatorios F29,
welcome, reportes mensuales) lo dispara la lógica de negocio cuando aplica.
Estos endpoints son sólo para visibilidad operativa: ¿está conectado Resend?
¿podemos enviar un email de prueba?

Soft-fail: si Resend no está configurado, `/test` devuelve 503 con detalle
útil; los flows de producción que dependen de email loggean warning y siguen.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from app.api.deps import require_scope
from app.core.config import settings
from app.core.security import AuthenticatedUser
from app.services.email_service import EmailService

router = APIRouter()


class NotificationsStatus(BaseModel):
    enabled: bool
    email_from: str
    admin_recipients: list[str]


class NotificationsTestRequest(BaseModel):
    to: EmailStr | None = None  # default: admin_recipients[0]


@router.get("/status", response_model=NotificationsStatus)
async def notifications_status(
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("notifications:admin"))
    ],
) -> NotificationsStatus:
    svc = EmailService()
    return NotificationsStatus(
        enabled=svc.enabled,
        email_from=settings.email_from,
        admin_recipients=settings.email_admin_recipients,
    )


@router.post("/test", status_code=status.HTTP_202_ACCEPTED)
async def notifications_test(
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("notifications:admin"))
    ],
    body: NotificationsTestRequest | None = None,
) -> dict:
    """Envía un email de prueba al `to` indicado o al primer admin recipient."""
    svc = EmailService()
    if not svc.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Resend no configurado. Setear RESEND_API_KEY en el backend. "
                "Ver docs/email-setup.md"
            ),
        )

    target_email: str | None = None
    if body is not None and body.to is not None:
        target_email = str(body.to)
    elif settings.email_admin_recipients:
        target_email = settings.email_admin_recipients[0]
    elif user.email:
        target_email = user.email

    if not target_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "No hay destinatario disponible. Pasar `to` en el body o setear "
                "EMAIL_ADMIN_RECIPIENTS."
            ),
        )

    html = (
        "<div style=\"font-family:-apple-system,BlinkMacSystemFont,sans-serif;\">"
        "<h2 style=\"color:#0a0a0a;\">Email de prueba — Cehta Capital</h2>"
        "<p>Si lees este mensaje, Resend está configurado correctamente.</p>"
        f"<p style=\"color:#6b7280;font-size:13px;\">Solicitado por: {user.email or user.sub}</p>"
        "</div>"
    )
    result = svc.send(
        to=[target_email],
        subject="Cehta Capital — email de prueba",
        html=html,
    )
    return {
        "sent": result is not None,
        "to": target_email,
        "provider_response": result,
    }
