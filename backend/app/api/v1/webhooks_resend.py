"""R152EEEEE · Webhook receiver para eventos de Resend.

Resend manda webhooks por cada cambio de estado de los emails:
  email.sent / email.delivered / email.opened / email.clicked
  email.bounced / email.complained

Este endpoint:
  1. Verifica la firma Svix del webhook (HMAC SHA256).
  2. Deduplica por provider_event_id (UNIQUE en email_events).
  3. Loggea el evento crudo en core.email_events.
  4. Actualiza columnas de tracking en core.ordenes_compra si el
     message_id matchea con una OC enviada.

Configuración necesaria:
  - Resend dashboard → Webhooks → Add endpoint:
       URL: https://cehta-backend.fly.dev/api/v1/webhooks/resend
       Events: email.delivered, email.opened, email.clicked,
               email.bounced, email.complained
  - Copiar el Signing Secret (whsec_...) y setear en Fly:
       fly secrets set RESEND_WEBHOOK_SECRET="whsec_xxx" -a cehta-backend

Seguridad:
  - Sin firma válida → 401 (no procesamos el evento).
  - Sin secret configurado → 503 (endpoint deshabilitado en su modo
    seguro; alternativamente puede operar sin firma pero loggea warning).
  - Idempotency por provider_event_id (Resend reintenta si timeoutea).
"""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import text

from app.api.deps import DBSession
from app.core.config import settings

log = structlog.get_logger(__name__)
router = APIRouter()


# Mapeo de event type → columna en ordenes_compra.
# event.type           → column                  | also increment count
_EVENT_TO_COLUMN: dict[str, tuple[str, str | None]] = {
    "email.delivered":   ("oc_email_delivered_at", None),
    "email.opened":      ("oc_email_opened_at", "oc_email_open_count"),
    "email.clicked":     ("oc_email_clicked_at", "oc_email_click_count"),
    "email.bounced":     ("oc_email_bounced_at", None),
    "email.complained":  ("oc_email_complained_at", None),
}


def _verify_svix_signature(
    body: bytes,
    headers: dict[str, str],
    secret: str,
) -> bool:
    """Verifica la firma Svix del webhook (mismo formato que Resend).

    Header `svix-signature` viene como `v1,base64hmac v1,otrabase64hmac`.
    Calculamos HMAC-SHA256 sobre `{svix_id}.{svix_timestamp}.{body}` con
    el secret (decodificado de base64 después del prefijo `whsec_`).
    """
    import base64

    sig_header = headers.get("svix-signature") or headers.get("Svix-Signature")
    sig_id = headers.get("svix-id") or headers.get("Svix-Id")
    sig_ts = headers.get("svix-timestamp") or headers.get("Svix-Timestamp")

    if not (sig_header and sig_id and sig_ts):
        return False

    # Secret de Resend viene con prefijo "whsec_" que indica base64-encoded
    # key. Lo decodificamos.
    if secret.startswith("whsec_"):
        try:
            key = base64.b64decode(secret[len("whsec_"):])
        except Exception:
            return False
    else:
        key = secret.encode("utf-8")

    # Mensaje a firmar: id.timestamp.body
    msg = f"{sig_id}.{sig_ts}.".encode("utf-8") + body
    expected = base64.b64encode(hmac.new(key, msg, hashlib.sha256).digest()).decode()

    # El header trae múltiples firmas separadas por espacio, cada una con
    # prefijo de versión "v1,". Verificamos contra todas en constant-time.
    for sig in sig_header.split():
        if "," not in sig:
            continue
        version, value = sig.split(",", 1)
        if version != "v1":
            continue
        if hmac.compare_digest(value, expected):
            return True
    return False


@router.post("/webhooks/resend", status_code=status.HTTP_200_OK)
async def resend_webhook(request: Request, db: DBSession) -> dict:
    """Recibe eventos de Resend y actualiza tracking de OCs."""
    secret = getattr(settings, "resend_webhook_secret", None)
    if not secret:
        log.warning("resend_webhook.no_secret_configured")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Webhook receiver desactivado: falta RESEND_WEBHOOK_SECRET. "
                "Configurá el secret en Fly para activar."
            ),
        )

    body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}

    # Verificar firma Svix antes de procesar.
    if not _verify_svix_signature(body, headers, secret):
        log.warning("resend_webhook.invalid_signature")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Firma del webhook inválida",
        )

    # Parsear payload.
    try:
        payload = json.loads(body)
    except Exception as exc:
        log.warning("resend_webhook.invalid_json", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Body no es JSON válido",
        )

    event_type = payload.get("type") or ""
    data = payload.get("data") or {}
    # Resend usa `id` o `email_id` según el evento. Probamos ambos.
    message_id = (
        data.get("email_id")
        or data.get("id")
        or payload.get("id")
        or ""
    )
    # Resend manda timestamp ISO 8601 en `created_at`.
    occurred_raw = payload.get("created_at") or data.get("created_at")
    # R152XXXXX — Manejar tanto string ISO como int unix timestamp.
    # Resend a veces manda timestamp como número (delivered events),
    # antes el `.replace("Z", ...)` crasheaba pero era silenced por
    # el except, perdiendo el timestamp real.
    try:
        if isinstance(occurred_raw, (int, float)):
            occurred_at = datetime.fromtimestamp(float(occurred_raw), timezone.utc)
        elif isinstance(occurred_raw, str):
            occurred_at = datetime.fromisoformat(occurred_raw.replace("Z", "+00:00"))
        else:
            occurred_at = datetime.now(timezone.utc)
    except Exception:
        occurred_at = datetime.now(timezone.utc)

    # R152XXXXX — Provider event ID con fallback más fuerte.
    # Antes: si no había svix-id, se usaba (event_type, message_id, isoformat)
    # — el ISO solo tiene resolución segundo, dos eventos del mismo type+msg
    # llegando en el mismo segundo colisionaban en UNIQUE constraint.
    # Ahora: hash SHA256 del body completo cuando falta svix-id.
    if headers.get("svix-id"):
        provider_event_id = headers["svix-id"]
    else:
        import hashlib
        import json as _json
        body_hash = hashlib.sha256(
            _json.dumps(payload, sort_keys=True, default=str).encode()
        ).hexdigest()[:32]
        provider_event_id = f"{event_type}|{message_id}|{body_hash}"

    if not message_id:
        log.warning(
            "resend_webhook.no_message_id",
            event_type=event_type,
            payload_preview=str(payload)[:200],
        )
        return {"ok": True, "skipped": "no_message_id"}

    # 1. Insertar evento crudo (idempotente por UNIQUE).
    try:
        ins = await db.execute(
            text(
                """INSERT INTO core.email_events
                       (provider_event_id, event_type, message_id,
                        oc_id, payload, occurred_at)
                   VALUES (:eid, :etype, :mid, NULL,
                           CAST(:pload AS jsonb), :occ)
                   ON CONFLICT (provider_event_id) DO NOTHING
                   RETURNING event_id"""
            ),
            {
                "eid": provider_event_id,
                "etype": event_type,
                "mid": message_id,
                "pload": json.dumps(payload),
                "occ": occurred_at,
            },
        )
        if ins.first() is None:
            # Ya estaba insertado (Resend retry). Salimos OK sin re-procesar.
            await db.commit()
            log.info(
                "resend_webhook.duplicate_event_ignored",
                event_id=provider_event_id[:32],
                event_type=event_type,
            )
            return {"ok": True, "duplicate": True}
    except Exception as exc:
        log.exception(
            "resend_webhook.event_insert_failed",
            error=str(exc),
            event_type=event_type,
        )
        await db.rollback()
        # No queremos que Resend siga reintentando si el problema es nuestro.
        return {"ok": True, "error": "internal_log_only"}

    # 2. Resolver OC por message_id y actualizar tracking si aplica.
    column_info = _EVENT_TO_COLUMN.get(event_type)
    if column_info is None:
        # Evento que no nos interesa (ej. email.sent — lo dispara antes
        # del delivered). Lo loggeamos pero no actualizamos OC.
        await db.commit()
        return {"ok": True, "ignored_event_type": event_type}

    timestamp_col, counter_col = column_info

    # Update con WHERE message_id — puede no matchear si el email fue
    # mandado por otro flujo (vouchers, notificaciones admin, etc.).
    if counter_col:
        update_sql = text(
            f"""UPDATE core.ordenes_compra
                SET {timestamp_col} = COALESCE({timestamp_col}, :occ),
                    {counter_col} = {counter_col} + 1,
                    updated_at = NOW()
                WHERE oc_send_message_id = :mid
                RETURNING oc_id, numero_oc"""
        )
    else:
        update_sql = text(
            f"""UPDATE core.ordenes_compra
                SET {timestamp_col} = COALESCE({timestamp_col}, :occ),
                    updated_at = NOW()
                WHERE oc_send_message_id = :mid
                RETURNING oc_id, numero_oc"""
        )

    # Para bounce/complaint, también guardamos la razón si viene en el
    # payload (Resend lo manda en data.reason o data.description).
    if event_type in ("email.bounced", "email.complained"):
        reason = (
            data.get("reason")
            or data.get("description")
            or data.get("message")
            or ""
        )[:500]
        bounce_sql = text(
            """UPDATE core.ordenes_compra
               SET oc_email_bounce_reason = :reason,
                   updated_at = NOW()
               WHERE oc_send_message_id = :mid"""
        )
        try:
            await db.execute(bounce_sql, {"reason": reason, "mid": message_id})
        except Exception as exc:
            log.warning(
                "resend_webhook.bounce_reason_failed",
                error=str(exc),
            )

    try:
        updated = (await db.execute(update_sql, {"mid": message_id, "occ": occurred_at})).first()
        if updated:
            oc_id, numero_oc = int(updated[0]), str(updated[1])
            # Link el evento al OC.
            await db.execute(
                text(
                    """UPDATE core.email_events SET oc_id = :oc_id
                       WHERE provider_event_id = :eid"""
                ),
                {"oc_id": oc_id, "eid": provider_event_id},
            )
            log.info(
                "resend_webhook.oc_updated",
                oc_id=oc_id,
                numero_oc=numero_oc,
                event_type=event_type,
                column=timestamp_col,
            )
        else:
            log.info(
                "resend_webhook.message_id_no_match",
                message_id=message_id[:20],
                event_type=event_type,
            )

        await db.commit()
        return {"ok": True, "processed": event_type}
    except Exception as exc:
        log.exception(
            "resend_webhook.oc_update_failed",
            error=str(exc),
            event_type=event_type,
        )
        await db.rollback()
        return {"ok": True, "error": "update_failed_logged"}
