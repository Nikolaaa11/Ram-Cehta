"""Endpoints de Notifications Inbox (V3 fase 8 — In-app notifications).

Cada usuario ve únicamente SUS notificaciones. No requiere scope especial:
basta con estar autenticado. El endpoint admin `/generate-alerts` exige
`notifications:admin` (mismo scope que ya usa el módulo `notifications.py`
para configurar Resend).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.notification_repository import (
    NotificationRepository,
)
from app.schemas.common import Page
from app.schemas.notification import (
    GenerateAlertsReport,
    NotificationRead,
    UnreadCount,
)
from app.services.notification_generator_service import (
    NotificationGeneratorService,
)

router = APIRouter()


@router.get("", response_model=Page[NotificationRead])
async def list_inbox(
    user: CurrentUser,
    db: DBSession,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    unread: bool = False,
) -> Page[NotificationRead]:
    """Lista paginada de notificaciones del usuario actual."""
    repo = NotificationRepository(db)
    items, total = await repo.list_for_user(
        user.sub, only_unread=unread, page=page, size=size
    )
    return Page.build(
        items=[NotificationRead.model_validate(i) for i in items],
        total=total,
        page=page,
        size=size,
    )


@router.get("/unread-count", response_model=UnreadCount)
async def unread_count(
    user: CurrentUser,
    db: DBSession,
) -> UnreadCount:
    """Cantidad de notificaciones sin leer (para el bell badge)."""
    repo = NotificationRepository(db)
    return UnreadCount(unread=await repo.unread_count(user.sub))


@router.post(
    "/{notification_id}/read",
    response_model=NotificationRead,
)
async def mark_read(
    user: CurrentUser,
    db: DBSession,
    notification_id: str,
) -> NotificationRead:
    """Marca una notificación como leída (solo si pertenece al usuario)."""
    repo = NotificationRepository(db)
    notif = await repo.mark_read(notification_id, user.sub)
    if notif is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notificación no encontrada",
        )
    await db.commit()
    return NotificationRead.model_validate(notif)


@router.post("/mark-all-read")
async def mark_all_read(
    user: CurrentUser,
    db: DBSession,
) -> dict[str, int]:
    """Marca todas las notificaciones del usuario como leídas."""
    repo = NotificationRepository(db)
    updated = await repo.mark_all_read(user.sub)
    await db.commit()
    return {"updated": updated}


@router.post(
    "/generate-alerts",
    response_model=GenerateAlertsReport,
    dependencies=[Depends(require_scope("notifications:admin"))],
)
async def generate_alerts(
    _user: Annotated[
        AuthenticatedUser, Depends(require_scope("notifications:admin"))
    ],
    db: DBSession,
) -> GenerateAlertsReport:
    """Trigger manual del generador de alertas (admin-only).

    En producción se invoca via cron / scheduled job. Idempotente.
    """
    svc = NotificationGeneratorService(db)
    report = await svc.run_all()
    await db.commit()
    return report
