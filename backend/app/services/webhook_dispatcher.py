"""Webhook dispatcher con HMAC signing + retry.

Uso:
    await publish_event(db, "oc.paid", {"oc_id": "...", ...})

El dispatcher consulta `app.webhook_subscriptions` activas que listen
ese event_type, y POST al target_url con:
    Headers:
        Content-Type: application/json
        X-Cehta-Event: {event_type}
        X-Cehta-Signature: sha256={hmac_hex}
        X-Cehta-Delivery-Id: {uuid}
    Body: {"event": "...", "data": {...}, "timestamp": "..."}

Cada intento se loguea en `app.webhook_deliveries`. El job es **best-effort
async** — fallo no rompe la mutación que disparó el evento.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime
from typing import Any

import httpx
import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger(__name__)

# Cadenas separadas para no acoplar a env
HTTP_TIMEOUT_S = 10.0
MAX_ATTEMPTS = 3
BACKOFF_BASE_S = 2.0  # 2s, 4s, 8s


def generate_secret() -> str:
    """Secret URL-safe de 32 bytes — para HMAC verification del receiver."""
    return secrets.token_urlsafe(32)


def sign_payload(secret: str, body: bytes) -> str:
    """HMAC-SHA256 → hex string. Receiver hace lo mismo y compara."""
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def _persist_delivery(
    db: AsyncSession,
    subscription_id: str,
    event_type: str,
    payload: dict[str, Any],
    *,
    status_code: int | None,
    response_body: str | None,
    error: str | None,
    attempt: int,
) -> None:
    """Inserta una fila en `app.webhook_deliveries`. Soft-fail."""
    try:
        await db.execute(
            text(
                """
                INSERT INTO app.webhook_deliveries
                    (subscription_id, event_type, payload, status_code,
                     response_body, error, attempt, delivered_at)
                VALUES
                    (:sid, :evt, CAST(:payload AS JSONB), :sc,
                     :rb, :err, :att, :dat)
                """
            ),
            {
                "sid": subscription_id,
                "evt": event_type,
                "payload": json.dumps(payload),
                "sc": status_code,
                "rb": response_body[:1000] if response_body else None,
                "err": error[:500] if error else None,
                "att": attempt,
                "dat": datetime.now(UTC) if status_code else None,
            },
        )
        await db.commit()
    except Exception as exc:
        log.warning(
            "webhook_delivery_log_failed",
            sub_id=subscription_id,
            event=event_type,
            error=str(exc),
        )


async def _deliver_one(
    db: AsyncSession,
    subscription: dict[str, Any],
    event_type: str,
    payload: dict[str, Any],
) -> None:
    """Intenta entregar a un suscriptor, con retry exponencial."""
    sub_id = str(subscription["id"])
    target_url = subscription["target_url"]
    secret = subscription["secret"]

    body_dict = {
        "event": event_type,
        "data": payload,
        "timestamp": datetime.now(UTC).isoformat(),
        "delivery_id": secrets.token_hex(8),
    }
    body_bytes = json.dumps(body_dict, default=str).encode()
    signature = sign_payload(secret, body_bytes)

    headers = {
        "Content-Type": "application/json",
        "X-Cehta-Event": event_type,
        "X-Cehta-Signature": f"sha256={signature}",
        "X-Cehta-Delivery-Id": body_dict["delivery_id"],
        "User-Agent": "Cehta-Webhooks/1.0",
    }

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_S) as client:
                resp = await client.post(target_url, content=body_bytes, headers=headers)
            await _persist_delivery(
                db,
                sub_id,
                event_type,
                body_dict,
                status_code=resp.status_code,
                response_body=resp.text[:1000],
                error=None,
                attempt=attempt,
            )
            if 200 <= resp.status_code < 300:
                log.info(
                    "webhook_delivered",
                    sub_id=sub_id,
                    event=event_type,
                    status=resp.status_code,
                    attempt=attempt,
                )
                return
            # 4xx/5xx: log y reintentar (excepto 4xx que NO son 408/429 — esos
            # tampoco recuperarían).
            if 400 <= resp.status_code < 500 and resp.status_code not in (408, 429):
                log.warning(
                    "webhook_4xx_no_retry",
                    sub_id=sub_id,
                    status=resp.status_code,
                )
                return
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            await _persist_delivery(
                db,
                sub_id,
                event_type,
                body_dict,
                status_code=None,
                response_body=None,
                error=f"{type(exc).__name__}: {exc}",
                attempt=attempt,
            )
            log.warning(
                "webhook_network_error",
                sub_id=sub_id,
                event=event_type,
                attempt=attempt,
                error=str(exc),
            )
        except Exception as exc:
            log.exception(
                "webhook_unexpected_error",
                sub_id=sub_id,
                event=event_type,
                attempt=attempt,
            )
            await _persist_delivery(
                db,
                sub_id,
                event_type,
                body_dict,
                status_code=None,
                response_body=None,
                error=f"unexpected: {exc!s}",
                attempt=attempt,
            )

        if attempt < MAX_ATTEMPTS:
            await asyncio.sleep(BACKOFF_BASE_S * (2 ** (attempt - 1)))


async def publish_event(
    db: AsyncSession,
    event_type: str,
    payload: dict[str, Any],
) -> int:
    """Publica un evento a todos los suscriptores activos.

    Devuelve la cantidad de suscriptores notificados (delivery exitoso o
    no — solo cuántos triggers se dispararon). El despacho corre en
    background tasks via `asyncio.create_task` para no bloquear la
    request del caller.

    Diseño best-effort: si la query falla, retorna 0 y loguea — nunca
    levanta para no romper el endpoint que disparó el evento.
    """
    try:
        rows = (
            await db.execute(
                text(
                    """
                    SELECT id, target_url, secret, events, name
                    FROM app.webhook_subscriptions
                    WHERE active = true
                      AND :evt = ANY(events)
                    """
                ),
                {"evt": event_type},
            )
        ).mappings().all()
    except Exception as exc:
        log.warning("webhook_publish_query_failed", event=event_type, error=str(exc))
        return 0

    if not rows:
        return 0

    # Despachamos en paralelo en background — no esperamos
    for row in rows:
        sub_dict = dict(row)
        # Disparamos sin await; los errores quedan en el log + tabla.
        asyncio.create_task(_deliver_one(db, sub_dict, event_type, payload))

    return len(rows)
