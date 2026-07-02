"""R152ZZZZZ · Email outbox + retry helper.

Reemplaza el patrón actual:
    email_service.send(to=..., subject=..., html=...)  # ← se pierde si Resend down

Con:
    await enqueue_email(db, to=..., subject=..., html=..., entity="oc:123")
    # Persiste a core.email_outbox + intenta send inmediato.
    # Si falla, queda en status='failed' para que el cron retry lo tome.

Flow:
    1. INSERT en outbox con status='pending' (idempotente si idempotency_key dado)
    2. Llama email_service.send() inmediato
    3. Si OK → UPDATE status='sent', resend_message_id
    4. Si FAIL → UPDATE status='failed', last_error, attempts=1
    5. Cron retry_failed_emails() corre cada 2 min y reintenta failed

NOTA: La integración con send_oc_to_signers_service y otros callers
queda como opcional (incremental migration). El email_service.send()
original sigue funcionando para callers que no necesitan retry.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.email_service import EmailService

log = structlog.get_logger(__name__)

# Backoff: minutos entre reintentos según número de attempts.
# attempts=1 (primer retry tras fail inicial): 5 min
# attempts=2: 10 min
# attempts=3: 20 min
# attempts=4: 40 min
# attempts=5: ya pasó a 'dead'
_RETRY_BACKOFF_MIN = [0, 5, 10, 20, 40]
MAX_ATTEMPTS = 5


async def enqueue_email(
    db: AsyncSession,
    *,
    to: list[str],
    subject: str,
    html: str,
    cc: list[str] | None = None,
    reply_to: str | None = None,
    attachments_meta: list[dict] | None = None,
    idempotency_key: str | None = None,
    triggered_by_user_id: str | None = None,
    triggered_by_entity: str | None = None,
    metadata: dict | None = None,
) -> dict[str, Any]:
    """Encola un email en core.email_outbox e intenta enviarlo inmediato.

    Returns:
        {"outbox_id": int, "status": "sent" | "failed" | "duplicate"}

    Si idempotency_key ya existe → no encola, devuelve "duplicate" con el
    outbox_id existente.
    """
    import json as _json

    try:
        result = await db.execute(
            text(
                """
                INSERT INTO core.email_outbox (
                    idempotency_key, to_emails, cc_emails, reply_to,
                    subject, html_body, attachments_meta,
                    status, triggered_by_user_id, triggered_by_entity, metadata
                )
                VALUES (
                    :ik, CAST(:to AS TEXT[]), CAST(:cc AS TEXT[]), :rt,
                    :subj, :html, CAST(:att AS JSONB),
                    'pending', :uid, :ent, CAST(:meta AS JSONB)
                )
                ON CONFLICT (idempotency_key)
                    WHERE idempotency_key IS NOT NULL
                    DO NOTHING
                RETURNING outbox_id
                """
            ),
            {
                "ik": idempotency_key,
                "to": to,
                "cc": cc or [],
                "rt": reply_to,
                "subj": subject,
                "html": html,
                "att": _json.dumps(attachments_meta or []),
                "uid": triggered_by_user_id,
                "ent": triggered_by_entity,
                "meta": _json.dumps(metadata or {}),
            },
        )
        row = result.first()
        await db.commit()

        if row is None:
            # Duplicate: ya existe row con este idempotency_key
            existing = (
                await db.execute(
                    text(
                        "SELECT outbox_id, status FROM core.email_outbox "
                        "WHERE idempotency_key = :ik"
                    ),
                    {"ik": idempotency_key},
                )
            ).first()
            return {
                "outbox_id": existing[0] if existing else None,
                "status": "duplicate",
            }

        outbox_id = row[0]
    except Exception as exc:
        log.error("email_outbox.enqueue_failed", error=str(exc))
        # Si no podemos siquiera persistir, intentamos send directo como
        # fallback degradado (mejor enviar y perder trail que perder el
        # email entero).
        return await _send_direct_fallback(
            to=to, subject=subject, html=html, cc=cc, reply_to=reply_to
        )

    # Intentar send inmediato (no await — fire-and-track)
    return await _try_send_outbox_row(db, outbox_id)


async def _send_direct_fallback(
    *,
    to: list[str],
    subject: str,
    html: str,
    cc: list[str] | None = None,
    reply_to: str | None = None,
) -> dict[str, Any]:
    """Fallback degradado si el INSERT al outbox falla."""
    svc = EmailService()
    if not svc.enabled:
        return {"outbox_id": None, "status": "failed", "error": "email_disabled"}
    try:
        resp = await asyncio.to_thread(
            svc.send, to=to, subject=subject, html=html, cc=cc, reply_to=reply_to
        )
        if resp:
            return {
                "outbox_id": None,
                "status": "sent_no_trail",
                "resend_id": resp.get("id") if isinstance(resp, dict) else None,
            }
    except Exception as exc:
        log.warning("email_outbox.fallback_failed", error=str(exc))
    return {"outbox_id": None, "status": "failed"}


async def _try_send_outbox_row(
    db: AsyncSession, outbox_id: int
) -> dict[str, Any]:
    """Carga la row, intenta send, persiste resultado."""
    # R152EEEEEE — SKIP LOCKED: si 2 workers del cron corren simultáneos,
    # el segundo skipea esta row sin bloquear, evitando doble envío Resend
    # + doble incremento de attempts.
    row = (
        await db.execute(
            text(
                """SELECT to_emails, cc_emails, reply_to, subject, html_body,
                          attempts, triggered_by_entity
                   FROM core.email_outbox
                   WHERE outbox_id = :id AND status IN ('pending', 'failed')
                   FOR UPDATE SKIP LOCKED"""
            ),
            {"id": outbox_id},
        )
    ).mappings().first()

    if row is None:
        return {"outbox_id": outbox_id, "status": "not_pending"}

    svc = EmailService()
    if not svc.enabled:
        # Email disabled — mantener pending para cuando re-habilites Resend.
        await db.execute(
            text(
                """UPDATE core.email_outbox
                   SET last_error = 'email_service_disabled',
                       last_attempt_at = NOW(),
                       attempts = attempts + 1
                   WHERE outbox_id = :id"""
            ),
            {"id": outbox_id},
        )
        await db.commit()
        return {"outbox_id": outbox_id, "status": "deferred"}

    # R152VVVVVV — regenerar el adjunto si el email pertenece a una OC.
    # El enqueue no guarda el PDF ("el retry lo regenera") pero el retry
    # nunca lo regeneraba: el GG recibía "Adjuntamos la OC" SIN adjunto.
    oc_id_ref: int | None = None
    ent = str(row.get("triggered_by_entity") or "")
    if ent.startswith("oc:"):
        try:
            oc_id_ref = int(ent.split(":", 1)[1])
        except ValueError:
            oc_id_ref = None
    attachments = None
    if oc_id_ref:
        try:
            import base64
            from app.services.send_oc_to_signers_service import (
                generate_oc_pdf_for_email,
            )
            pdf_bytes = await generate_oc_pdf_for_email(db, oc_id_ref)
            numero = await db.scalar(
                text("SELECT numero_oc FROM core.ordenes_compra WHERE oc_id = :id"),
                {"id": oc_id_ref},
            )
            attachments = [{
                "filename": f"OC-{numero or oc_id_ref}.pdf",
                "content": base64.b64encode(pdf_bytes).decode("ascii"),
            }]
        except Exception as exc:  # noqa: BLE001 — mejor sin adjunto que dead
            log.warning(
                "email_outbox.pdf_regen_failed",
                outbox_id=outbox_id,
                oc_id=oc_id_ref,
                error=str(exc)[:200],
            )

    try:
        resp = await asyncio.to_thread(
            svc.send,
            to=list(row["to_emails"]),
            cc=list(row["cc_emails"] or []),
            reply_to=row["reply_to"],
            subject=row["subject"],
            html=row["html_body"],
            attachments=attachments,
        )
        if resp and isinstance(resp, dict) and resp.get("id"):
            await db.execute(
                text(
                    """UPDATE core.email_outbox
                       SET status = 'sent',
                           resend_message_id = :rid,
                           sent_at = NOW(),
                           last_attempt_at = NOW(),
                           attempts = attempts + 1
                       WHERE outbox_id = :id"""
                ),
                {"id": outbox_id, "rid": resp["id"]},
            )
            # R152VVVVVV — cerrar el loop en la OC: sin esto un retry
            # exitoso dejaba oc_sent_at NULL y un reenvío manual duplicaba
            # el email al GG.
            if oc_id_ref:
                await db.execute(
                    text(
                        """UPDATE core.ordenes_compra
                           SET oc_sent_at = NOW(), oc_send_error = NULL
                           WHERE oc_id = :id AND oc_sent_at IS NULL"""
                    ),
                    {"id": oc_id_ref},
                )
            await db.commit()
            return {"outbox_id": outbox_id, "status": "sent"}
        else:
            err = "Resend devolvió respuesta sin id"
            return await _mark_failed(db, outbox_id, err, row["attempts"])
    except Exception as exc:
        return await _mark_failed(db, outbox_id, str(exc), row["attempts"])


async def _mark_failed(
    db: AsyncSession, outbox_id: int, err: str, current_attempts: int
) -> dict[str, Any]:
    """Marca como failed o dead si pasó MAX_ATTEMPTS."""
    new_attempts = current_attempts + 1
    new_status = "dead" if new_attempts >= MAX_ATTEMPTS else "failed"
    await db.execute(
        text(
            """UPDATE core.email_outbox
               SET status = :st,
                   last_error = :err,
                   last_attempt_at = NOW(),
                   attempts = :att
               WHERE outbox_id = :id"""
        ),
        {"id": outbox_id, "st": new_status, "err": err[:1000], "att": new_attempts},
    )
    await db.commit()
    if new_status == "dead":
        log.error(
            "email_outbox.dead",
            outbox_id=outbox_id,
            attempts=new_attempts,
            last_error=err[:200],
        )
    return {"outbox_id": outbox_id, "status": new_status, "error": err}


async def retry_failed_emails(db: AsyncSession, limit: int = 50) -> dict[str, int]:
    """Cron: levanta emails con status='failed' que están listos para retry.

    Backoff por attempts: 5, 10, 20, 40 min entre reintentos.
    Llamar cada 2 min desde un Fly scheduled task.
    """
    candidates = (
        await db.execute(
            text(
                """
                SELECT outbox_id, attempts
                FROM core.email_outbox
                WHERE status = 'failed'
                  AND attempts < :max_att
                  AND (last_attempt_at IS NULL OR last_attempt_at < NOW() -
                       (CASE
                          WHEN attempts >= 4 THEN INTERVAL '40 minutes'
                          WHEN attempts = 3 THEN INTERVAL '20 minutes'
                          WHEN attempts = 2 THEN INTERVAL '10 minutes'
                          WHEN attempts = 1 THEN INTERVAL '5 minutes'
                          ELSE INTERVAL '0 minutes'
                        END))
                ORDER BY last_attempt_at ASC NULLS FIRST
                LIMIT :lim
                """
            ),
            {"max_att": MAX_ATTEMPTS, "lim": limit},
        )
    ).fetchall()

    counters = {"attempted": 0, "sent": 0, "still_failing": 0, "dead": 0}
    for row in candidates:
        outbox_id = row[0]
        counters["attempted"] += 1
        result = await _try_send_outbox_row(db, outbox_id)
        if result.get("status") == "sent":
            counters["sent"] += 1
        elif result.get("status") == "dead":
            counters["dead"] += 1
        else:
            counters["still_failing"] += 1
    return counters
