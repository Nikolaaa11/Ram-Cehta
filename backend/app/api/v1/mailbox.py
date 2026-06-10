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
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.config import settings
from app.core.security import AuthenticatedUser
from app.services.audit_service import audit_log
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


class MailboxRunNowResponse(BaseModel):
    """R152PPPP — Respuesta del endpoint 'correr ahora' (poll + classify
    en un solo llamado desde la UI)."""

    poll: MailboxPollResponse
    classify: MailboxClassifyResponse
    duration_ms: int


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
    # R152HHHH/IIII — Auto-creación de entidad desde email
    created_entity_type: str | None = None
    created_entity_id: int | None = None
    created_entity_numero: str | None = None   # ej: numero_oc para mostrar
    auto_create_error: str | None = None


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
    "/admin/mailbox/run-now",
    response_model=MailboxRunNowResponse,
)
async def trigger_run_now(
    user: Annotated[AuthenticatedUser, Depends(require_scope("integration:write"))],
    db: DBSession,
    classify_limit: int = 200,
) -> MailboxRunNowResponse:
    """R152PPPP — Corre 1 ciclo completo (poll + classify) en el mismo
    request worker. Equivalente a disparar el cron `inbox_cron` manual.

    Útil para:
      - Probar el flujo end-to-end sin esperar al schedule horario.
      - Recovery después de marcar mails como No Leídos en Gmail.
      - Debug en producción cuando el cron no levanta.

    Timeout: el request puede tardar hasta ~30s (IMAP + Claude clasificación
    de N mails). El frontend debe usar AbortController con margen.
    """
    import time as _time
    t0 = _time.monotonic()
    try:
        poll_result = await poll_inbox(db)
    except InboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    classify_result = await classify_pending(db, limit=classify_limit)
    duration_ms = int((_time.monotonic() - t0) * 1000)

    # R152WWWWW — Compliance Ley 19.628 / GDPR: NO loggear email del user
    # en plaintext en logs (Fly + Sentry no son sistemas autorizados de
    # tratamiento). Usamos user.sub (UUID) que es identifier interno
    # NO regulado y permite correlación.
    log.info(
        "mailbox.run_now",
        seen=poll_result.get("seen", 0),
        inserted=poll_result.get("inserted", 0),
        classified=classify_result.get("classified", 0),
        duration_ms=duration_ms,
        user_id=str(user.sub),
    )

    return MailboxRunNowResponse(
        poll=MailboxPollResponse(**poll_result),
        classify=MailboxClassifyResponse(**classify_result),
        duration_ms=duration_ms,
    )


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
                SELECT im.inbox_id, im.message_id, im.from_email, im.from_name,
                       im.subject, im.received_at, im.has_attachments, im.category,
                       im.ai_confidence, im.ai_summary, im.ai_suggested_action,
                       im.status, im.classified_at, im.replied_at,
                       im.created_entity_type, im.created_entity_id,
                       im.auto_create_error,
                       CASE
                         WHEN im.created_entity_type = 'orden_compra'
                              THEN (SELECT oc.numero_oc FROM core.ordenes_compra oc
                                    WHERE oc.oc_id = im.created_entity_id)
                         WHEN im.created_entity_type = 'voucher'
                              THEN (SELECT v.codigo FROM core.vouchers v
                                    WHERE v.voucher_id = im.created_entity_id)
                         ELSE NULL
                       END AS entity_numero
                FROM core.inbox_messages im
                {where_sql.replace('status', 'im.status').replace('category', 'im.category')}
                ORDER BY im.received_at DESC
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
            created_entity_type=r[14], created_entity_id=r[15],
            auto_create_error=r[16], created_entity_numero=r[17],
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
                SELECT im.inbox_id, im.message_id, im.from_email, im.from_name,
                       im.subject, im.received_at, im.has_attachments, im.category,
                       im.ai_confidence, im.ai_summary, im.ai_suggested_action,
                       im.status, im.classified_at, im.replied_at,
                       im.body_text, im.body_html, im.attachments_meta,
                       im.draft_response_html, im.linked_voucher_id, im.linked_oc_id,
                       im.created_entity_type, im.created_entity_id,
                       im.auto_create_error,
                       CASE
                         WHEN im.created_entity_type = 'orden_compra'
                              THEN (SELECT oc.numero_oc FROM core.ordenes_compra oc
                                    WHERE oc.oc_id = im.created_entity_id)
                         WHEN im.created_entity_type = 'voucher'
                              THEN (SELECT v.codigo FROM core.vouchers v
                                    WHERE v.voucher_id = im.created_entity_id)
                         ELSE NULL
                       END AS entity_numero
                FROM core.inbox_messages im
                WHERE im.inbox_id = :id
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
        created_entity_type=row[20], created_entity_id=row[21],
        auto_create_error=row[22], created_entity_numero=row[23],
    )


# V5++ ola CF — extraccion de voucher desde un email del inbox.
class MailboxToVoucherRequest(BaseModel):
    """Body para POST /admin/mailbox/{inbox_id}/to-voucher.

    `empresa_codigo` es el target del voucher (el email puede venir a
    contactocehta@gmail.com pero la factura es para una empresa portfolio
    especifica que el user elige). Si no viene, el endpoint intenta inferir
    desde el body — fallback a la primera empresa activa.
    """

    empresa_codigo: str


@router.post(
    "/admin/mailbox/{inbox_id}/to-voucher",
)
async def mailbox_to_voucher(
    inbox_id: int,
    body: MailboxToVoucherRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
) -> dict:
    """Genera la sugerencia de voucher desde un email del inbox.

    El email ya esta clasificado (Claude lo mar como factura/recibo/etc.
    durante /classify). Este endpoint:

      1. Lee el row del inbox (subject + from + body_text).
      2. Concatena los campos en un texto canonico.
      3. Pasa el texto a /vouchers/extract-from-text logic (analyze_document
         con schema 'factura').
      4. Devuelve la misma ExtractedVoucherSuggestion para que el FE muestre
         el form editable y el user confirme.

    NO crea el voucher; el FE redirige a /vouchers/desde-mensaje con los
    datos precargados, o muestra el form inline en el mailbox detail.
    """
    from app.services.empresa_scope_service import assert_empresa_access

    await assert_empresa_access(user, db, body.empresa_codigo)

    row = (
        await db.execute(
            text(
                """
                SELECT inbox_id, from_email, from_name, subject, body_text,
                       received_at, category
                FROM core.inbox_messages
                WHERE inbox_id = :id
                """
            ),
            {"id": inbox_id},
        )
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Email {inbox_id} no encontrado en el inbox",
        )

    # Armamos un texto canonico que matchee el formato esperado por el LLM:
    # un email forwarded con headers + body. Asi Claude lo extrae igual que
    # un .eml subido manualmente.
    parts: list[str] = [
        f"From: {row[2] or ''} <{row[1] or ''}>",
        f"Subject: {row[3] or ''}",
        f"Date: {row[5].isoformat() if row[5] else ''}",
        "",
        (row[4] or "").strip(),
    ]
    text_input = "\n".join(parts).strip()
    if len(text_input) < 30:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "El email no tiene contenido suficiente para extraer datos. "
                "Probá adjuntar la factura como archivo y usar /vouchers/importar."
            ),
        )

    from app.services.document_analyzer_service import (
        DocumentAnalyzerNotConfigured,
        analyze_document,
    )

    try:
        extraction = await analyze_document(
            text_input,
            tipo="factura",
            filename=f"inbox-{inbox_id}.txt",
            extraction_method="inbox_email",
        )
    except DocumentAnalyzerNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    # Reusamos el helper de vouchers_extract para mappear al shape del form.
    from app.api.v1.vouchers_extract import _build_suggestion, _maybe_match_empresa

    suggestion = _build_suggestion(extraction.fields, body.empresa_codigo)
    suggestion = await _maybe_match_empresa(suggestion, db)

    return {
        "inbox_id": inbox_id,
        "suggestion": suggestion.model_dump(),
        "raw_fields": extraction.fields,
        "warnings": extraction.warnings,
        "tipo_detectado": extraction.tipo_detectado,
        "confidence": extraction.confidence,
        "extraction_method": "inbox_email",
        "filename": f"inbox-{inbox_id}",
        "preview_text": text_input[:500],
    }


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
            # R152NNNN · asyncpg requiere list[int] nativa para BIGINT[].
            # El literal Postgres '{1,2,3}' como str solo funciona con
            # psycopg2 — asyncpg lo rechaza con DataError.
            "ids": list(body.inbox_ids),
            "reason": body.reason,
        },
    )
    archived = res.rowcount or 0
    await db.commit()
    return BulkArchiveResponse(
        archived=archived,
        skipped=len(body.inbox_ids) - archived,
    )


# R152HHHH — Endpoint manual para disparar la auto-creación de OC.
# Útil si el classify automático falló o el operador edita la categoría.
@router.post("/admin/mailbox/{inbox_id}/auto-create-oc")
async def auto_create_oc_manual(
    inbox_id: int,
    user: Annotated[AuthenticatedUser, Depends(require_scope("integration:write"))],
    db: DBSession,
) -> dict[str, Any]:
    """Re-dispara la auto-creación de OC para un email ya clasificado.

    Útil cuando:
      - El classify automático corrió antes de aplicar la migración
        R152HHHH (no creó la OC porque la columna no existía).
      - El operador cambió manualmente la categoría a 'oc'.
      - El intento anterior falló (auto_create_error != NULL) y querés
        reintentar después de corregir datos.

    Retorna el resultado del servicio: ok + oc_id + numero_oc, o
    ok=False + error si falla.
    """
    from app.services.auto_create_oc_from_inbox import auto_create_oc_from_inbox
    return await auto_create_oc_from_inbox(db, inbox_id)


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


# =====================================================================
# Round 59 — Bulk auto-create drafts desde inbox
# =====================================================================


class AutoCreateDraftsRequest(BaseModel):
    """POST /admin/mailbox/auto-create-drafts

    Itera sobre los emails clasificados como factura (status='classified',
    category='factura' u 'orden_compra', linked_voucher_id IS NULL) con
    confidence >= min_confidence y crea un voucher COMPRA en DRAFT para
    cada uno. Liga el inbox_messages.linked_voucher_id al voucher creado.
    """

    empresa_codigo: str
    min_confidence: float = Field(default=0.75, ge=0.0, le=1.0)
    max_emails: int = Field(default=50, ge=1, le=200)


class AutoCreateDraftsResponse(BaseModel):
    """Stats del bulk run."""

    candidates: int  # emails inspeccionados
    created: int  # vouchers DRAFT creados con éxito
    skipped_low_confidence: int  # confidence < min_confidence
    skipped_empty: int  # email sin contenido o sin datos extraíbles
    failed: int  # errores procesando (loggeados)
    created_voucher_ids: list[int] = []
    errors: list[dict] = []  # [{inbox_id, message}, ...]


@router.post(
    "/admin/mailbox/auto-create-drafts",
    response_model=AutoCreateDraftsResponse,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def auto_create_drafts_from_inbox(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    body: AutoCreateDraftsRequest,
    db: DBSession,
    request: Request,
) -> AutoCreateDraftsResponse:
    """Round 59 — bulk creación de vouchers DRAFT desde emails clasificados.

    Cierra el ciclo de automatización inbox → voucher:
      1. cron inbox_cron.py ya pollea IMAP + clasifica con Claude.
      2. Este endpoint toma todos los clasificados como factura con
         confidence alta y crea drafts sin intervención manual.
      3. Operador entra a /vouchers y revisa los DRAFT, ajusta cuentas
         contables, y aprueba.

    Soft-fail por email: si uno falla (Claude error, datos faltantes),
    se loggea en errors[] y seguimos con el siguiente.

    Idempotencia: los emails con linked_voucher_id no nulo se saltan
    (ya tienen voucher creado). Re-correr no duplica.
    """
    from app.api.v1.vouchers_extract import _build_suggestion
    from app.services.document_analyzer_service import (
        DocumentAnalyzerNotConfigured,
        analyze_document,
    )
    from app.services.empresa_scope_service import assert_empresa_access

    await assert_empresa_access(user, db, body.empresa_codigo)

    rows = (
        await db.execute(
            text(
                """
                SELECT inbox_id, from_email, from_name, subject, body_text,
                       received_at, ai_confidence
                FROM core.inbox_messages
                WHERE status = 'classified'
                  AND category IN ('factura', 'orden_compra')
                  AND linked_voucher_id IS NULL
                  AND COALESCE(ai_confidence, 0) >= :minconf
                ORDER BY received_at ASC
                LIMIT :lim
                """
            ),
            {"minconf": body.min_confidence, "lim": body.max_emails},
        )
    ).fetchall()

    candidates = len(rows)
    if candidates == 0:
        return AutoCreateDraftsResponse(
            candidates=0,
            created=0,
            skipped_low_confidence=0,
            skipped_empty=0,
            failed=0,
        )

    created: list[int] = []
    skipped_empty = 0
    failed: list[dict] = []

    import structlog as _structlog
    _log = _structlog.get_logger(__name__)

    for r in rows:
        inbox_id, from_email, from_name, subject, body_text, received_at, _ = r
        try:
            parts = [
                f"From: {from_name or ''} <{from_email or ''}>",
                f"Subject: {subject or ''}",
                f"Date: {received_at.isoformat() if received_at else ''}",
                "",
                (body_text or "").strip(),
            ]
            text_input = "\n".join(parts).strip()
            if len(text_input) < 30:
                skipped_empty += 1
                continue

            try:
                extraction = await analyze_document(
                    text_input,
                    tipo="factura",
                    filename=f"inbox-{inbox_id}.txt",
                    extraction_method="inbox_bulk_auto",
                )
            except DocumentAnalyzerNotConfigured:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Claude no configurado, no puedo hacer extract bulk",
                )

            sugg = _build_suggestion(extraction.fields, body.empresa_codigo)

            from app.models.voucher import Voucher
            from app.services.voucher_service import generate_voucher_code

            anio = received_at.year if received_at else 2026
            codigo = await generate_voucher_code(
                db, body.empresa_codigo, anio, "COMPRA"
            )
            glosa_str = (sugg.glosa or "").strip()
            if len(glosa_str) < 5:
                glosa_str = (
                    f"Email inbox#{inbox_id} - "
                    f"{(subject or 'sin asunto')[:80]}"
                )
            from datetime import date as _date
            fecha_doc_str = sugg.fecha_documento or ""
            fecha_doc = None
            if fecha_doc_str:
                try:
                    fecha_doc = _date.fromisoformat(fecha_doc_str)
                except ValueError:
                    fecha_doc = None
            if fecha_doc is None and received_at:
                fecha_doc = received_at.date()
            if fecha_doc is None:
                from datetime import datetime as _dt
                fecha_doc = _dt.now().date()

            voucher = Voucher(
                codigo=codigo,
                empresa_codigo=body.empresa_codigo,
                tipo="COMPRA",
                status="DRAFT",
                fecha_documento=fecha_doc,
                fecha_contable=fecha_doc,
                glosa=glosa_str[:500],
                total_debit=0,
                total_credit=0,
                moneda=(sugg.moneda or "CLP"),
                contraparte_rut=(sugg.proveedor_rut or None),
                contraparte_nombre=(sugg.proveedor_nombre or None),
                contraparte_tipo=(
                    "PROVEEDOR"
                    if (sugg.proveedor_rut or sugg.proveedor_nombre)
                    else None
                ),
                doc_tributario_tipo=(sugg.tipo_documento or None),
                doc_tributario_folio=(sugg.numero_documento or None),
                forma_pago=(sugg.forma_pago or None),
                source="inbox_bulk_auto",
                created_by=str(user.sub),
                requested_by=str(user.sub),
            )
            db.add(voucher)
            await db.flush()
            new_vid = voucher.voucher_id

            await db.execute(
                text(
                    """
                    UPDATE core.inbox_messages
                    SET linked_voucher_id = :vid,
                        updated_at = NOW()
                    WHERE inbox_id = :iid
                    """
                ),
                {"vid": new_vid, "iid": inbox_id},
            )
            await db.commit()
            created.append(new_vid)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            _log.warning(
                "mailbox.auto_create_drafts.failed_one",
                inbox_id=inbox_id,
                error=str(exc),
            )
            failed.append({"inbox_id": inbox_id, "message": str(exc)[:200]})

    try:
        await audit_log(
            db,
            request,
            user,
            action="bulk_auto_create_drafts",
            entity_type="voucher_bulk",
            entity_id=str(len(created)),
            entity_label=f"inbox->{len(created)}drafts",
            summary=(
                f"Bulk auto-drafts desde inbox: {len(created)} creados, "
                f"{skipped_empty} sin contenido, {len(failed)} fallaron - "
                f"empresa {body.empresa_codigo}, conf>={body.min_confidence}"
            ),
            before=None,
            after={
                "created": len(created),
                "created_voucher_ids": created[:20],
                "skipped_empty": skipped_empty,
                "failed": len(failed),
            },
        )
    except Exception:
        pass

    return AutoCreateDraftsResponse(
        candidates=candidates,
        created=len(created),
        skipped_low_confidence=0,
        skipped_empty=skipped_empty,
        failed=len(failed),
        created_voucher_ids=created,
        errors=failed,
    )
