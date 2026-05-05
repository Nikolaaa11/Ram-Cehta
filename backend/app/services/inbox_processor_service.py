"""Inbox processor — pulls emails from contactocehta@gmail.com via IMAP.

Pipeline:
  1. `poll_inbox()` → conecta IMAP, lee UNSEEN, INSERT en core.inbox_messages
  2. `classify_pending()` → para cada row con status='received', llama Claude
     para clasificar + resumen + draft de respuesta. Pasa a 'classified'.
  3. (Frontend) Nicolás revisa en /admin/inbox. Si aprueba, edita el draft
     y POST /admin/inbox/{id}/reply → manda vía Resend, status='replied'.

Soft-fail: si IMAP no está configurado, las funciones devuelven
`InboxNotConfigured` y el endpoint responde 503. Esto permite que el resto
del backend boote sin las creds (dev local sin Gmail).

Idempotencia: el INSERT usa ON CONFLICT (message_id) DO NOTHING. Reejecutar
el poll no duplica.

Seguridad:
  - Las credenciales viven sólo en env (INBOX_IMAP_PASSWORD = Gmail App
    Password, NUNCA la del usuario humano).
  - El draft NO se manda automáticamente. Siempre requiere review humano.
  - El cuerpo HTML se sanitiza antes de pasar a Claude (no inyectamos
    JavaScript ni links peligrosos en el contexto).
"""
from __future__ import annotations

import email
import imaplib
import re
from datetime import UTC, datetime
from email.message import Message
from email.utils import parseaddr, parsedate_to_datetime
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

log = structlog.get_logger(__name__)


class InboxNotConfigured(Exception):
    """IMAP creds ausentes — el endpoint debe devolver 503."""


# --------------------------------------------------------------------------
# Helpers puros (testeables sin IMAP/DB)
# --------------------------------------------------------------------------


def parse_address(raw: str | None) -> tuple[str, str | None]:
    """Devuelve (email, name) desde un header tipo 'Foo <foo@bar.com>'."""
    if not raw:
        return ("", None)
    name, addr = parseaddr(raw)
    return (addr.lower().strip(), name.strip() or None)


def parse_addresses(raw: str | None) -> list[str]:
    """Devuelve lista de emails desde un header con múltiples separados por coma."""
    if not raw:
        return []
    parts = re.split(r"[,;]", raw)
    out = []
    for part in parts:
        addr, _ = parse_address(part)
        if addr:
            out.append(addr)
    return out


def extract_body(msg: Message) -> tuple[str | None, str | None]:
    """Devuelve (text, html) del cuerpo del mensaje, manejando multipart."""
    text_body: str | None = None
    html_body: str | None = None

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            disposition = str(part.get("Content-Disposition", ""))
            if "attachment" in disposition.lower():
                continue
            try:
                payload = part.get_payload(decode=True)
                if not payload:
                    continue
                charset = part.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
            except (UnicodeDecodeError, LookupError):
                continue

            if content_type == "text/plain" and text_body is None:
                text_body = decoded
            elif content_type == "text/html" and html_body is None:
                html_body = decoded
    else:
        try:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
                if msg.get_content_type() == "text/html":
                    html_body = decoded
                else:
                    text_body = decoded
        except (UnicodeDecodeError, LookupError):
            pass

    return text_body, html_body


def extract_attachments_meta(msg: Message) -> list[dict[str, Any]]:
    """Lista metadata de adjuntos (filename, content_type, size). Sin guardar bytes."""
    out: list[dict[str, Any]] = []
    if not msg.is_multipart():
        return out
    for part in msg.walk():
        disposition = str(part.get("Content-Disposition", ""))
        if "attachment" not in disposition.lower():
            continue
        filename = part.get_filename() or "unnamed"
        content_type = part.get_content_type()
        try:
            payload = part.get_payload(decode=True)
            size = len(payload) if payload else 0
        except (TypeError, ValueError):
            size = 0
        out.append({
            "filename": filename,
            "content_type": content_type,
            "size_bytes": size,
            # dropbox_path y extracted_text se llenan después en la fase
            # de procesamiento (fuera del scope del poll).
            "dropbox_path": None,
            "extracted_text": None,
        })
    return out


def build_classifier_prompt(subject: str, from_email: str, body_text: str) -> str:
    """Prompt para Claude — clasifica + resume + draft response."""
    body_preview = (body_text or "")[:3000]  # cap a 3k chars
    return f"""Sos un asistente de Cehta Capital (FIP chileno). Te paso un email
recibido en contactocehta@gmail.com. Devolvé JSON con estas keys:

{{
  "category": "factura_proveedor" | "boleta_honorarios" | "pago_confirmado"
            | "consulta_lp" | "consulta_cliente" | "spam"
            | "notif_banco" | "notif_sii" | "otro",
  "confidence": 0.00–1.00,
  "summary": "1-2 oraciones — qué pide/informa el remitente, en chileno claro",
  "suggested_action": "string corto — qué debería hacer Nicolás",
  "draft_response_html": "<p>Hola...</p> respuesta cordial en HTML simple,
                         tono cálido pero profesional, máximo 4 párrafos.
                         Firma con 'Equipo Cehta Capital'."
}}

Reglas:
- Si es spam evidente (publicidad, phishing), confidence alta y
  draft_response_html = "" (sin draft, se archiva).
- Si pide información comercial sensible (montos del fondo, listado LPs),
  draft cordial diciendo que un partner se va a contactar — NO inventes
  números.
- Idioma del draft: el mismo del email original (ES por default).

EMAIL:
From: {from_email}
Subject: {subject}

Body:
{body_preview}
"""


# --------------------------------------------------------------------------
# IMAP — poll
# --------------------------------------------------------------------------


def _ensure_configured() -> None:
    if not settings.inbox_imap_user or not settings.inbox_imap_password:
        raise InboxNotConfigured(
            "INBOX_IMAP_USER / INBOX_IMAP_PASSWORD no configurados. "
            "Crear Gmail App Password en myaccount.google.com → Security → "
            "App Passwords y setear las env vars."
        )


def _imap_connect() -> imaplib.IMAP4_SSL:
    """Devuelve conexión IMAP autenticada al folder configurado."""
    _ensure_configured()
    conn = imaplib.IMAP4_SSL(settings.inbox_imap_host, settings.inbox_imap_port)
    conn.login(settings.inbox_imap_user, settings.inbox_imap_password)  # type: ignore[arg-type]
    conn.select(settings.inbox_imap_folder)
    return conn


async def poll_inbox(db: AsyncSession) -> dict[str, int]:
    """Lee mails UNSEEN, los inserta en core.inbox_messages.

    Devuelve `{seen, inserted, skipped, errors}`. Marca como `\\Seen` solo
    los que se insertaron OK — si falla el insert, queda no-leído para
    re-intentar en el próximo poll.
    """
    _ensure_configured()

    seen = inserted = skipped = errors = 0
    conn = _imap_connect()
    try:
        status_, data = conn.search(None, "UNSEEN")
        if status_ != "OK":
            log.error("inbox.search_failed", status=status_)
            return {"seen": 0, "inserted": 0, "skipped": 0, "errors": 1}

        message_ids = data[0].split() if data and data[0] else []
        cap = settings.inbox_max_messages_per_run
        message_ids = message_ids[:cap]

        for num in message_ids:
            seen += 1
            try:
                _, msg_data = conn.fetch(num, "(RFC822)")
                if not msg_data or not msg_data[0]:
                    errors += 1
                    continue
                raw_email = msg_data[0][1]  # type: ignore[index]
                if not isinstance(raw_email, bytes):
                    errors += 1
                    continue

                msg = email.message_from_bytes(raw_email)

                # Extraer headers
                msg_id = (msg.get("Message-ID") or "").strip().strip("<>")
                if not msg_id:
                    # Sin Message-ID no podemos garantizar idempotencia
                    skipped += 1
                    continue

                from_email_raw = msg.get("From")
                from_email, from_name = parse_address(from_email_raw)
                to_emails = parse_addresses(msg.get("To"))
                cc_emails = parse_addresses(msg.get("Cc"))
                subject = (msg.get("Subject") or "").strip()
                received_raw = msg.get("Date")
                received_at = (
                    parsedate_to_datetime(received_raw)
                    if received_raw
                    else datetime.now(UTC)
                )
                in_reply_to = (msg.get("In-Reply-To") or "").strip().strip("<>") or None
                thread_id = (msg.get("References") or "").split()[0].strip("<>") if msg.get("References") else None

                body_text, body_html = extract_body(msg)
                attachments = extract_attachments_meta(msg)

                # INSERT idempotente por message_id
                await db.execute(
                    text("""
                        INSERT INTO core.inbox_messages (
                            message_id, in_reply_to, thread_id,
                            from_email, from_name,
                            to_emails, cc_emails,
                            subject, received_at,
                            body_text, body_html,
                            has_attachments, attachments_meta,
                            status
                        )
                        VALUES (
                            :message_id, :in_reply_to, :thread_id,
                            :from_email, :from_name,
                            CAST(:to_emails AS TEXT[]),
                            CAST(:cc_emails AS TEXT[]),
                            :subject, :received_at,
                            :body_text, :body_html,
                            :has_attachments, CAST(:attachments_meta AS jsonb),
                            'received'
                        )
                        ON CONFLICT (message_id) DO NOTHING
                    """),
                    {
                        "message_id": msg_id,
                        "in_reply_to": in_reply_to,
                        "thread_id": thread_id,
                        "from_email": from_email,
                        "from_name": from_name,
                        "to_emails": "{" + ",".join(to_emails) + "}",
                        "cc_emails": "{" + ",".join(cc_emails) + "}",
                        "subject": subject,
                        "received_at": received_at,
                        "body_text": body_text,
                        "body_html": body_html,
                        "has_attachments": bool(attachments),
                        "attachments_meta": _json_dump(attachments),
                    },
                )
                inserted += 1
                # Marcar como leído sólo si el insert pasó
                conn.store(num, "+FLAGS", "\\Seen")
            except Exception as exc:  # noqa: BLE001
                errors += 1
                log.exception("inbox.fetch_error", error=str(exc))

        await db.commit()
    finally:
        try:
            conn.close()
        finally:
            conn.logout()

    return {"seen": seen, "inserted": inserted, "skipped": skipped, "errors": errors}


# --------------------------------------------------------------------------
# Classifier — Claude
# --------------------------------------------------------------------------


async def classify_pending(db: AsyncSession, limit: int = 20) -> dict[str, int]:
    """Toma rows status='received', clasifica con Claude, pasa a 'classified'."""
    if not settings.anthropic_api_key:
        log.warning("inbox.classify.anthropic_disabled")
        return {"classified": 0, "errors": 0, "skipped": 0}

    rows = (
        await db.execute(
            text("""
                SELECT inbox_id, subject, from_email,
                       COALESCE(body_text, '') AS body_text
                FROM core.inbox_messages
                WHERE status = 'received'
                ORDER BY received_at ASC
                LIMIT :lim
            """),
            {"lim": limit},
        )
    ).fetchall()

    if not rows:
        return {"classified": 0, "errors": 0, "skipped": 0}

    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    classified = errors = skipped = 0
    for r in rows:
        inbox_id, subject, from_email, body_text = r
        try:
            prompt = build_classifier_prompt(subject, from_email, body_text)
            resp = await client.messages.create(
                model=settings.inbox_classify_model,
                max_tokens=1500,
                messages=[{"role": "user", "content": prompt}],
            )
            content = resp.content[0].text if resp.content else ""
            parsed = _extract_json(content)
            if not parsed:
                errors += 1
                continue

            await db.execute(
                text("""
                    UPDATE core.inbox_messages
                    SET status = 'classified',
                        category = :category,
                        ai_confidence = :conf,
                        ai_summary = :summary,
                        ai_suggested_action = :action,
                        draft_response_html = :draft,
                        classified_at = NOW()
                    WHERE inbox_id = :id
                """),
                {
                    "id": inbox_id,
                    "category": parsed.get("category"),
                    "conf": parsed.get("confidence"),
                    "summary": parsed.get("summary"),
                    "action": parsed.get("suggested_action"),
                    "draft": parsed.get("draft_response_html"),
                },
            )
            classified += 1
        except Exception as exc:  # noqa: BLE001
            errors += 1
            log.exception("inbox.classify_error", inbox_id=inbox_id, error=str(exc))

    await db.commit()
    return {"classified": classified, "errors": errors, "skipped": skipped}


# --------------------------------------------------------------------------
# Helpers privados
# --------------------------------------------------------------------------


def _json_dump(obj: Any) -> str:
    import json as _json

    return _json.dumps(obj, ensure_ascii=False)


def _extract_json(text_in: str) -> dict[str, Any] | None:
    """Extrae el primer objeto JSON encontrado en la respuesta de Claude.

    Claude a veces envuelve el JSON en markdown ```json ... ```. Este
    helper soporta ambos formatos.
    """
    import json as _json

    # Buscar ```json ... ``` primero
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text_in, re.DOTALL)
    if fence:
        try:
            return _json.loads(fence.group(1))
        except _json.JSONDecodeError:
            pass

    # Buscar primer { ... } balanceado
    start = text_in.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(text_in)):
        ch = text_in[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return _json.loads(text_in[start : i + 1])
                except _json.JSONDecodeError:
                    return None
    return None
