"""Endpoints de Email Inbox (contactocehta@gmail.com).

Pipeline operativo:
  1. POST /admin/mailbox/poll → IMAP fetch UNSEEN, INSERT en core.inbox_messages
  2. POST /admin/mailbox/classify → Claude clasifica + draft response
  3. GET  /admin/mailbox → lista con filtros (categoría, status)
  4. GET  /admin/mailbox/{id} → detalle + draft editable
  5. POST /admin/mailbox/{id}/reply → manda respuesta vía Resend
  6. POST /admin/mailbox/{id}/archive → descarta sin respuesta
  7. POST /admin/mailbox/{id}/link-voucher → asocia con voucher creado

Soft-fail: si IMAP no está configurado, /poll devuelve 503 sin romper el resto.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.services.email_service import EmailService
from app.services.inbox_processor_service import (
    InboxNotConfigured,
    classify_pending,
    poll_inbox,
)

log = structlog.get_logger(__name__)
router = APIRouter()


# --------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------


class MailboxPollResponse(BaseModel):
    seen: int
    inserted: int
    skipped: int
    errors: int


class MailboxClassifyResponse(BaseModel):
    classified: int
    errors: int
    skipped: int


class MailboxItem(BaseModel):
    inbox_id: int
    message_id: str
    from_email: str
    from_name: str | None
    subject: str
    received_at: datetime
    has_attachments: bool
    category: str | None
    ai_confidence: float | None
    ai_summary: str | None
    ai_suggested_action: str | None
    status: str
    classified_at: datetime | None
    replied_at: datetime | None


class MailboxDetail(MailboxItem):
    body_text: str | None
    body_html: str | None
    attachments_meta: list[dict]
    draft_response_html: str | None
    linked_voucher_id: int | None
    linked_oc_id: int | None


class ReplyRequest(BaseModel):
    body_html: str = Field(..., min_length=1)
    subject_override: str | None = None


class ArchiveRequest(BaseModel):
    reason: str = Field(default="archived_manual")


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------


@router.post(
    "/admin/mailbox/poll",
    response_model=MailboxPollResponse,
)
async def trigger_poll(
    user: Annotated[AuthenticatedUser, Depends(require_scope("integration:write"))],
    db: DBSession,
) -> MailboxPollResponse:
    """Trigger manual del IMAP poll. Idempotente."""
    try:
        result = await poll_inbox(db)
    except InboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    return MailboxPollResponse(**result)


@router.post(
    "/admin/mailbox/classify",
    response_model=MailboxClassifyResponse,
)
async def trigger_classify(
    user: Annotated[AuthenticatedUser, Depends(require_scope("integration:write"))],
    db: DBSession,
    limit: int = 20,
) -> MailboxClassifyResponse:
    """Clasifica con Claude todos los mails status='received' (hasta `limit`)."""
    result = await classify_pending(db, limit=limit)
    return MailboxClassifyResponse(**result)


@router.get(
    "/admin/mailbox",
    response_model=list[MailboxItem],
)
async def list_mailbox(
    user: CurrentUser,
    db: DBSession,
    status_filter: str | None = Query(default=None, alias="status"),
    category_filter: str | None = Query(default=None, alias="category"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[MailboxItem]:
    """Lista emails procesados con filtros. Más nuevo primero."""
    where = []
    params: dict = {"lim": limit}
    if status_filter:
        where.append("status = :status_f")
        params["status_f"] = status_filter
    if category_filter:
        where.append("category = :cat_f")
        params["cat_f"] = category_filter
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    rows = (
        await db.execute(
            text(f"""
                SELECT inbox_id, message_id, from_email, from_name, subject,
                       received_at, has_attachments, category, ai_confidence,
                       ai_summary, ai_suggested_action, status,
                       classified_at, replied_at
                FROM core.inbox_messages
                {where_sql}
                ORDER BY received_at DESC
                LIMIT :lim
            """),
            params,
        )
    ).fetchall()

    return [
        MailboxItem(
            inbox_id=r[0], message_id=r[1], from_email=r[2], from_name=r[3],
            subject=r[4], received_at=r[5], has_attachments=r[6],
            category=r[7], ai_confidence=float(r[8]) if r[8] is not None else None,
            ai_summary=r[9], ai_suggested_action=r[10], status=r[11],
            classified_at=r[12], replied_at=r[13],
        )
        for r in rows
    ]


@router.get(
    "/admin/mailbox/{inbox_id}",
    response_model=MailboxDetail,
)
async def get_mailbox_item(
    inbox_id: int,
    user: CurrentUser,
    db: DBSession,
) -> MailboxDetail:
    row = (
        await db.execute(
            text("""
                SELECT inbox_id, message_id, from_email, from_name, subject,
                       received_at, has_attachments, category, ai_confidence,
                       ai_summary, ai_suggested_action, status,
                       classified_at, replied_at,
                       body_text, body_html, attachments_meta,
                       draft_response_html, linked_voucher_id, linked_oc_id
                FROM core.inbox_messages
                WHERE inbox_id = :id
            """),
            {"id": inbox_id},
        )
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Email {inbox_id} no encontrado",
        )
    import json as _json
    attachments = (
        row[16] if isinstance(row[16], list) else _json.loads(row[16] or "[]")
    )
    return MailboxDetail(
        inbox_id=row[0], message_id=row[1], from_email=row[2], from_name=row[3],
        subject=row[4], received_at=row[5], has_attachments=row[6],
        category=row[7],
        ai_confidence=float(row[8]) if row[8] is not None else None,
        ai_summary=row[9], ai_suggested_action=row[10], status=row[11],
        classified_at=row[12], replied_at=row[13],
        body_text=row[14], body_html=row[15],
        attachments_meta=attachments,
        draft_response_html=row[17],
        linked_voucher_id=row[18], linked_oc_id=row[19],
    )


@router.post(
    "/admin/mailbox/{inbox_id}/reply",
    response_model=MailboxDetail,
)
async def reply_email(
    inbox_id: int,
    body: ReplyRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("integration:write"))],
    db: DBSession,
) -> MailboxDetail:
    """Manda la respuesta editada vía Resend y marca el row como 'replied'."""
    row = (
        await db.execute(
            text("""
                SELECT from_email, subject, message_id, status
                FROM core.inbox_messages
                WHERE inbox_id = :id
            """),
            {"id": inbox_id},
        )
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Email {inbox_id} no encontrado",
        )
    from_email, subject, message_id, current_status = row
    if current_status == "replied":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este email ya tiene una respuesta enviada.",
        )

    reply_subject = body.subject_override or (
        subject if subject.lower().startswith("re:") else f"Re: {subject}"
    )

    svc = EmailService()
    if not svc.enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Resend no está configurado (RESEND_API_KEY ausente).",
        )
    svc.send(
        to=[from_email],
        subject=reply_subject,
        html=body.body_html,
    )

    await db.execute(
        text("""
            UPDATE core.inbox_messages
            SET status = 'replied',
                replied_at = NOW(),
                replied_by_user_id = :uid,
                draft_response_html = :draft
            WHERE inbox_id = :id
        """),
        {"id": inbox_id, "uid": user.sub, "draft": body.body_html},
    )
    await db.commit()

    # Devolver el detalle actualizado
    return await get_mailbox_item(inbox_id, user, db)


@router.post(
    "/admin/mailbox/{inbox_id}/archive",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def archive_email(
    inbox_id: int,
    body: ArchiveRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("integration:write"))],
    db: DBSession,
) -> None:
    """Archiva sin responder (spam, info, etc.)."""
    res = await db.execute(
        text("""
            UPDATE core.inbox_messages
            SET status = 'archived',
                archived_at = NOW(),
                archived_reason = :reason
            WHERE inbox_id = :id
              AND status NOT IN ('replied', 'archived')
        """),
        {"id": inbox_id, "reason": body.reason},
    )
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Email {inbox_id} no existe o ya está archivado/respondido",
        )
