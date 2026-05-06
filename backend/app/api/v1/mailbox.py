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
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.config import settings
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
    attachments_uploaded: int = 0


class MailboxClassifyResponse(BaseModel):
    classified: int
    errors: int
    skipped: int


class MailboxStatusResponse(BaseModel):
    """Status para mostrar en /admin/integraciones."""

    imap_configured: bool
    imap_user: str | None
    anthropic_enabled: bool
    resend_enabled: bool
    dropbox_enabled: bool
    last_received_at: datetime | None
    counts_by_status: dict[str, int]
    counts_by_category: dict[str, int]


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


class LinkVoucherRequest(BaseModel):
    voucher_id: int = Field(..., gt=0)


class LinkOcRequest(BaseModel):
    oc_id: int = Field(..., gt=0)


class BulkArchiveRequest(BaseModel):
    inbox_ids: list[int] = Field(..., min_length=1, max_length=200)
    reason: str = Field(default="archived_bulk")


class BulkArchiveResponse(BaseModel):
    archived: int
    skipped: int


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------


@router.get(
    "/admin/mailbox/status",
    response_model=MailboxStatusResponse,
)
async def get_status(
    user: CurrentUser,
    db: DBSession,
) -> MailboxStatusResponse:
    """Status agregado del inbox para /admin/integraciones.

    Soft-fail: si la tabla `core.inbox_messages` no existe (migration 0039
    pendiente), devuelve un status vacío con `imap_configured=false` en lugar
    de 500. Esto permite que el frontend muestre el card "Sin configurar"
    incluso en entornos viejos.
    """
    last_received = None
    counts_by_status: dict[str, int] = {}
    counts_by_category: dict[str, int] = {}

    try:
        last_received = await db.scalar(
            text("SELECT MAX(received_at) FROM core.inbox_messages")
        )

        status_rows = (
            await db.execute(
                text("""
                    SELECT status, COUNT(*) FROM core.inbox_messages
                    GROUP BY status
                """)
            )
        ).fetchall()
        counts_by_status = {r[0]: int(r[1]) for r in status_rows}

        cat_rows = (
            await db.execute(
                text("""
                    SELECT category, COUNT(*) FROM core.inbox_messages
                    WHERE category IS NOT NULL
                    GROUP BY category
                    ORDER BY COUNT(*) DESC
                """)
            )
        ).fetchall()
        counts_by_category = {r[0]: int(r[1]) for r in cat_rows}
    except Exception as exc:  # noqa: BLE001
        # Tabla no existe (migration 0039 no aplicada todavía) o error transitorio.
        # Loggeamos y devolvemos status vacío en lugar de 500.
        log.warning("mailbox.status.table_unavailable", error=str(exc))
        await db.rollback()

    return MailboxStatusResponse(
        imap_configured=bool(
            settings.inbox_imap_user and settings.inbox_imap_password
        ),
        imap_user=settings.inbox_imap_user,
        anthropic_enabled=bool(settings.anthropic_api_key),
        resend_enabled=bool(settings.resend_api_key),
        dropbox_enabled=bool(settings.dropbox_refresh_token),
        last_received_at=last_received,
        counts_by_status=counts_by_status,
        counts_by_category=counts_by_category,
    )


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

    safe_subject = (subject or "").strip()
    reply_subject = body.subject_override or (
        safe_subject
        if safe_subject.lower().startswith("re:")
        else f"Re: {safe_subject or '(sin asunto)'}"
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
    "/admin/mailbox/{inbox_id}/restore",
    response_model=MailboxDetail,
)
async def restore_email(
    inbox_id: int,
    user: Annotated[AuthenticatedUser, Depends(require_scope("integration:write"))],
    db: DBSession,
) -> MailboxDetail:
    """Des-archiva un email (vuelve a 'classified' o 'received').

    Útil si Nicolás archivó un email por error o cambia de opinión sobre
    spam clasificado por la AI.

    Restaura a 'classified' si tenía categoría AI, sino a 'received' para
    que pueda ser re-clasificado.
    """
    res = await db.execute(
        text("""
            UPDATE core.inbox_messages
            SET status = CASE
                    WHEN category IS NOT NULL THEN 'classified'
                    ELSE 'received'
                END,
                archived_at = NULL,
                archived_reason = NULL
            WHERE inbox_id = :id
              AND status = 'archived'
        """),
        {"id": inbox_id},
    )
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Email {inbox_id} no existe o no está archivado",
        )
    return await get_mailbox_item(inbox_id, user, db)


@router.post(
    "/admin/mailbox/{inbox_id}/archive",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def archive_email(
    inbox_id: int,
    body: ArchiveRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("integration:write"))],
    db: DBSession,
) -> Response:
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
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------
# Linking — asociar email con artefactos creados (voucher, OC, movimiento)
# --------------------------------------------------------------------------


@router.post(
    "/admin/mailbox/bulk-archive",
    response_model=BulkArchiveResponse,
)
async def bulk_archive(
    body: BulkArchiveRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("integration:write"))],
    db: DBSession,
) -> BulkArchiveResponse:
    """Archiva varios emails en una operación. Útil para limpiar spam masivo.

    Ignora los que ya están en status 'replied' o 'archived' (skipped).
    Idempotente — re-llamarlo no hace nada.
    """
    res = await db.execute(
        text("""
            UPDATE core.inbox_messages
            SET status = 'archived',
                archived_at = NOW(),
                archived_reason = :reason
            WHERE inbox_id = ANY(CAST(:ids AS BIGINT[]))
              AND status NOT IN ('replied', 'archived')
        """),
        {
            "ids": "{" + ",".join(str(i) for i in body.inbox_ids) + "}",
            "reason": body.reason,
        },
    )
    archived = res.rowcount or 0
    await db.commit()
    return BulkArchiveResponse(
        archived=archived,
        skipped=len(body.inbox_ids) - archived,
    )


@router.post(
    "/admin/mailbox/{inbox_id}/link-voucher",
    response_model=MailboxDetail,
)
async def link_voucher(
    inbox_id: int,
    body: LinkVoucherRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("integration:write"))],
    db: DBSession,
) -> MailboxDetail:
    """Asocia un email con un voucher ya creado.

    Caso típico: el inbox recibe una factura proveedor, Nicolás crea el
    voucher tipo COMPRA en /vouchers/nuevo, copia el ID y vuelve acá para
    linkearlo. Después el detalle del email muestra el link al voucher.
    """
    # Validar que el voucher exista
    exists = await db.scalar(
        text("SELECT 1 FROM core.vouchers WHERE voucher_id = :id"),
        {"id": body.voucher_id},
    )
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Voucher {body.voucher_id} no existe",
        )

    # Guard contra race: solo linkea si no estaba ya linkeado a otro voucher.
    # Si rowcount=0 puede ser: 1) email no existe, 2) ya linkeado. Diferenciamos.
    res = await db.execute(
        text("""
            UPDATE core.inbox_messages
            SET linked_voucher_id = :vid,
                status = CASE
                    WHEN status IN ('received', 'classified') THEN 'reviewed'
                    ELSE status
                END
            WHERE inbox_id = :id
              AND (linked_voucher_id IS NULL OR linked_voucher_id = :vid)
        """),
        {"id": inbox_id, "vid": body.voucher_id},
    )
    if res.rowcount == 0:
        # Verificar si existe + ya tiene link
        existing = await db.scalar(
            text("SELECT linked_voucher_id FROM core.inbox_messages WHERE inbox_id = :id"),
            {"id": inbox_id},
        )
        if existing is None and not await db.scalar(
            text("SELECT 1 FROM core.inbox_messages WHERE inbox_id = :id"),
            {"id": inbox_id},
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Email {inbox_id} no encontrado",
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Email {inbox_id} ya está linkeado al voucher {existing}. "
                f"Para cambiarlo, primero desvinculá."
            ),
        )
    await db.commit()
    return await get_mailbox_item(inbox_id, user, db)


@router.post(
    "/admin/mailbox/{inbox_id}/link-oc",
    response_model=MailboxDetail,
)
async def link_oc(
    inbox_id: int,
    body: LinkOcRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("integration:write"))],
    db: DBSession,
) -> MailboxDetail:
    """Asocia un email con una orden de compra existente.

    Caso típico: el proveedor responde al pedido y Nicolás linkea el
    email con la OC para que toda la conversación quede trazada.
    """
    exists = await db.scalar(
        text("SELECT 1 FROM core.ordenes_compra WHERE oc_id = :id"),
        {"id": body.oc_id},
    )
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Orden de compra {body.oc_id} no existe",
        )

    res = await db.execute(
        text("""
            UPDATE core.inbox_messages
            SET linked_oc_id = :ocid,
                status = CASE
                    WHEN status IN ('received', 'classified') THEN 'reviewed'
                    ELSE status
                END
            WHERE inbox_id = :id
              AND (linked_oc_id IS NULL OR linked_oc_id = :ocid)
        """),
        {"id": inbox_id, "ocid": body.oc_id},
    )
    if res.rowcount == 0:
        existing = await db.scalar(
            text("SELECT linked_oc_id FROM core.inbox_messages WHERE inbox_id = :id"),
            {"id": inbox_id},
        )
        if not await db.scalar(
            text("SELECT 1 FROM core.inbox_messages WHERE inbox_id = :id"),
            {"id": inbox_id},
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Email {inbox_id} no encontrado",
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Email {inbox_id} ya está linkeado a la OC {existing}. "
                f"Para cambiarlo, primero desvinculá."
            ),
        )
    await db.commit()
    return await get_mailbox_item(inbox_id, user, db)
