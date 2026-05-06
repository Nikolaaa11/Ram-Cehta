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

import asyncio
import email
import imaplib
import re
import unicodedata
from datetime import UTC, datetime
from email.message import Message
from email.utils import parseaddr, parsedate_to_datetime
from typing import Any

# Timeout para conexiones IMAP — evita que el cron Fly se cuelgue
# indefinidamente si Gmail no responde. 30s es suficiente para fetch
# normal, agresivo para detectar problemas de red.
_IMAP_TIMEOUT_SECONDS = 30

# Cap concurrente para llamadas a Claude. Anthropic free tier ~50 RPM,
# tier 1 ~1000 RPM. Con 5 paralelas dejamos margen para otros endpoints
# que también usan Claude (chat, secretaria, document analyzer).
_CLAUDE_MAX_CONCURRENT = 5

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


def extract_attachments(msg: Message) -> list[dict[str, Any]]:
    """Devuelve metadata + bytes de cada adjunto.

    El bytes va en la key `_payload` (no se persiste en DB, solo se usa para
    subir a Dropbox dentro del mismo flujo). Después de subir, se setea
    `dropbox_path` y se borra `_payload` antes de hacer JSON dump.
    """
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
            payload = part.get_payload(decode=True) or b""
            size = len(payload)
        except (TypeError, ValueError):
            payload = b""
            size = 0
        out.append({
            "filename": filename,
            "content_type": content_type,
            "size_bytes": size,
            "dropbox_path": None,
            "extracted_text": None,
            "_payload": payload,  # NO se persiste — uso interno
        })
    return out


# Alias retro-compat
def extract_attachments_meta(msg: Message) -> list[dict[str, Any]]:
    """Backwards-compat: solo metadata, sin bytes. Usar `extract_attachments`."""
    items = extract_attachments(msg)
    for it in items:
        it.pop("_payload", None)
    return items


def safe_filename(filename: str) -> str:
    """Sanitiza un filename para que sea válido en Dropbox.

    Dropbox prohibe `/`, `\\`, `<`, `>`, `:`, `\"`, `|`, `?`, `*`. También
    cap a 200 chars para evitar problemas con el path completo.

    NFC normalize: Dropbox API rechaza algunos NFD (unicode descompuesto)
    típico en macOS — caracteres como "é" pueden venir como "e + combining
    accent". NFC los une en un solo codepoint que Dropbox acepta sin drama.
    """
    # 1. Normalizar a NFC (compositional normalization)
    cleaned = unicodedata.normalize("NFC", filename)
    # 2. Reemplazar caracteres prohibidos
    bad_chars = '/\\<>:\"|?*'
    cleaned = "".join("_" if c in bad_chars else c for c in cleaned)
    # 3. Quitar control chars (newlines, tabs en filenames son red flag)
    cleaned = "".join(c for c in cleaned if c.isprintable() or c == " ")
    # 4. Strip whitespace y dots (Windows también odia trailing dot)
    cleaned = cleaned.strip(". ")
    if not cleaned:
        cleaned = "unnamed"
    return cleaned[:200]


def inbox_dropbox_path(received_at: datetime, filename: str) -> str:
    """Construye el path Dropbox donde guardar un adjunto del inbox.

    Estructura: /Cehta Capital/00-Inbox/{año}/{mes}/{filename_sanitizado}

    El timestamp del recibido determina año/mes. Si dos archivos tienen el
    mismo nombre el `overwrite=True` del upload los pisa — para preservar
    ambos, el caller puede prefijar el filename con el inbox_id.
    """
    year = received_at.strftime("%Y")
    month = received_at.strftime("%m")
    return f"/Cehta Capital/00-Inbox/{year}/{month}/{safe_filename(filename)}"


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
    """Devuelve conexión IMAP autenticada al folder configurado.

    Maneja explícitamente:
    - Timeout en socket (evita cron Fly colgado si Gmail no responde)
    - imaplib.IMAP4.error con mensaje descriptivo si la auth falla.
      Causas comunes: app password caducada, 2FA pendiente, cuenta bloqueada.
    """
    _ensure_configured()
    try:
        conn = imaplib.IMAP4_SSL(
            settings.inbox_imap_host,
            settings.inbox_imap_port,
            timeout=_IMAP_TIMEOUT_SECONDS,
        )
    except (TimeoutError, OSError) as exc:
        log.error(
            "inbox.imap_connect_timeout",
            host=settings.inbox_imap_host,
            error=str(exc),
        )
        raise InboxNotConfigured(
            f"No se pudo conectar a {settings.inbox_imap_host}: {exc}"
        ) from exc

    try:
        conn.login(
            settings.inbox_imap_user,  # type: ignore[arg-type]
            settings.inbox_imap_password,  # type: ignore[arg-type]
        )
    except imaplib.IMAP4.error as exc:
        log.error("inbox.imap_login_failed", error=str(exc))
        raise InboxNotConfigured(
            f"Login IMAP falló: {exc}. Verificá que el App Password de "
            f"Gmail esté vigente (myaccount.google.com/apppasswords)."
        ) from exc

    conn.select(settings.inbox_imap_folder)
    return conn


async def poll_inbox(db: AsyncSession) -> dict[str, int]:
    """Lee mails UNSEEN, los inserta en core.inbox_messages.

    Adicional: si el mail tiene adjuntos y Dropbox está configurado, sube
    cada adjunto a `/Cehta Capital/00-Inbox/{año}/{mes}/{filename}` y
    persiste el path en `attachments_meta.dropbox_path`.

    Devuelve `{seen, inserted, skipped, errors, attachments_uploaded}`.
    Marca como `\\Seen` solo los que se insertaron OK — si falla el insert,
    queda no-leído para re-intentar en el próximo poll.
    """
    _ensure_configured()

    # Intentar inicializar Dropbox — soft-fail si no está configurado.
    dbx_service = None
    try:
        from app.services.dropbox_service import (
            DropboxNotConfigured,
            DropboxService,
        )
        dbx_service = DropboxService()
    except DropboxNotConfigured:
        log.info("inbox.dropbox_disabled")
    except Exception as exc:  # noqa: BLE001
        log.warning("inbox.dropbox_init_failed", error=str(exc))

    seen = inserted = skipped = errors = attachments_uploaded = 0
    # Lista de UIDs IMAP que se insertaron OK — los marcamos como `\Seen`
    # DESPUÉS del db.commit(). Si crashea antes del commit, no se marcan
    # leídos y el próximo poll los reintenta.
    pending_seen: list[bytes] = []
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
                attachments = extract_attachments(msg)  # incluye _payload bytes

                # Subir adjuntos a Dropbox /Cehta Capital/00-Inbox/{año}/{mes}/
                # Si Dropbox no está configurado o falla, persistimos los meta
                # sin dropbox_path y registramos error individual.
                if dbx_service is not None and attachments:
                    for att in attachments:
                        payload = att.pop("_payload", b"")
                        if not payload:
                            continue
                        # Prefijar filename con timestamp para evitar colisiones
                        ts_prefix = received_at.strftime("%Y%m%d-%H%M%S")
                        prefixed_name = f"{ts_prefix}_{safe_filename(att['filename'])}"
                        dropbox_path = inbox_dropbox_path(received_at, prefixed_name)
                        try:
                            # Crear carpeta padre si no existe (idempotente)
                            parent = "/".join(dropbox_path.split("/")[:-1])
                            dbx_service.ensure_folder_path(parent)
                            dbx_service.upload_file(
                                dropbox_path, payload, overwrite=False
                            )
                            att["dropbox_path"] = dropbox_path
                            attachments_uploaded += 1
                        except Exception as exc:  # noqa: BLE001
                            log.warning(
                                "inbox.dropbox_upload_failed",
                                filename=att["filename"],
                                error=str(exc),
                            )
                else:
                    # Limpiar _payload si no se subió (no persistir bytes en DB)
                    for att in attachments:
                        att.pop("_payload", None)

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
                # Acumular para marcar Seen DESPUÉS del commit
                pending_seen.append(num)
            except Exception as exc:  # noqa: BLE001
                errors += 1
                log.exception("inbox.fetch_error", error=str(exc))

        # Commit primero — si falla, los emails quedan no-leídos para reintento
        await db.commit()

        # Solo después del commit OK, marcar como leídos vía IMAP
        for num in pending_seen:
            try:
                conn.store(num, "+FLAGS", "\\Seen")
            except Exception as exc:  # noqa: BLE001
                # No-op fatal: el mail está en DB, solo no se marcó leído.
                # Próximo poll lo va a re-fetchear (UNSEEN), pero el INSERT
                # tiene ON CONFLICT DO NOTHING — no duplica.
                log.warning(
                    "inbox.imap_store_failed",
                    num=num,
                    error=str(exc),
                )
    finally:
        try:
            conn.close()
        finally:
            conn.logout()

    return {
        "seen": seen,
        "inserted": inserted,
        "skipped": skipped,
        "errors": errors,
        "attachments_uploaded": attachments_uploaded,
    }


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

    # Semáforo: evita rate limit de Anthropic si llegan 50+ emails de golpe.
    # _CLAUDE_MAX_CONCURRENT=5 deja headroom para chat AI + secretaria + analyzer.
    sem = asyncio.Semaphore(_CLAUDE_MAX_CONCURRENT)

    classified = errors = skipped = 0
    db_lock = asyncio.Lock()  # Serializar UPDATEs (asyncpg no soporta concurrent writes)

    async def classify_one(row: tuple) -> str:
        """Devuelve 'classified', 'error' o 'skipped'."""
        inbox_id, subject, from_email, body_text = row
        async with sem:
            try:
                prompt = build_classifier_prompt(
                    subject or "", from_email, body_text or ""
                )
                resp = await client.messages.create(
                    model=settings.inbox_classify_model,
                    max_tokens=1500,
                    messages=[{"role": "user", "content": prompt}],
                )
                content = resp.content[0].text if resp.content else ""
                parsed = _extract_json(content)
                if not parsed:
                    return "error"

                category = parsed.get("category")
                summary = parsed.get("summary") or ""

                async with db_lock:
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
                            WHERE inbox_id = :id AND status = 'received'
                        """),
                        {
                            "id": inbox_id,
                            "category": category,
                            "conf": parsed.get("confidence"),
                            "summary": summary,
                            "action": parsed.get("suggested_action"),
                            "draft": parsed.get("draft_response_html"),
                        },
                    )

                    # Notificación in-app si el email es CRÍTICO.
                    # Categorías que ameritan ping inmediato a Nicolás:
                    #   - notif_sii (multas, citaciones, alertas tributarias)
                    #   - pago_confirmado (cierre del loop OC → marcar pagado)
                    #   - notif_banco (cobranza, sobregiros, alertas crédito)
                    if category in ("notif_sii", "pago_confirmado", "notif_banco"):
                        await _create_inbox_alert_notification(
                            db,
                            inbox_id=inbox_id,
                            category=category,
                            summary=summary,
                            from_email=from_email or "",
                        )
                return "classified"
            except Exception as exc:  # noqa: BLE001
                log.exception(
                    "inbox.classify_error", inbox_id=inbox_id, error=str(exc)
                )
                return "error"

    # Ejecutar en paralelo (limitado por semáforo)
    results = await asyncio.gather(
        *(classify_one(tuple(r)) for r in rows), return_exceptions=False
    )
    classified = sum(1 for r in results if r == "classified")
    errors = sum(1 for r in results if r == "error")

    await db.commit()
    return {"classified": classified, "errors": errors, "skipped": skipped}


# --------------------------------------------------------------------------
# Helpers privados
# --------------------------------------------------------------------------


def _json_dump(obj: Any) -> str:
    import json as _json

    return _json.dumps(obj, ensure_ascii=False)


async def _create_inbox_alert_notification(
    db: AsyncSession,
    *,
    inbox_id: int,
    category: str,
    summary: str,
    from_email: str,
) -> None:
    """Crea notificaciones in-app para emails críticos.

    Una notificación por cada admin/finance user activo. La idea: cuando
    llega un email del SII o una confirmación de pago, Nicolás (y quien
    corresponda) lo ve en su bell instantáneamente sin tener que abrir
    /admin/mailbox manual.

    Soft-fail: si la tabla de notificaciones tiene schema distinto o no
    está disponible, log warning y continúa — no rompe el classify.
    """
    category_labels = {
        "notif_sii": "Notificación SII",
        "pago_confirmado": "Pago confirmado",
        "notif_banco": "Notificación banco",
    }
    label = category_labels.get(category, category)
    title = f"[{label}] {from_email}"
    body = (summary or "")[:500]

    try:
        # Targetear admin + finance — usuarios que pueden actuar sobre el email.
        # Tabla canónica: core.user_roles con columna app_role.
        users_rows = (
            await db.execute(
                text(
                    """
                    SELECT user_id
                    FROM core.user_roles
                    WHERE app_role IN ('admin', 'finance')
                    """
                )
            )
        ).fetchall()
        target_user_ids = [str(r[0]) for r in users_rows]
        if not target_user_ids:
            log.info("inbox.alert.no_targets", category=category)
            return

        # Map a tipos válidos según CHECK constraint de app.notifications.
        # CHECK permite: f29_due, contrato_due, oc_pending, legal_due, system, mention.
        # Para inbox críticos usamos 'system' (no hay tipo dedicado).
        # Severity 'critical' lo marca visualmente en el bell.
        for uid in target_user_ids:
            await db.execute(
                text(
                    """
                    INSERT INTO app.notifications (
                        user_id, tipo, severity, title, body, link,
                        entity_type, entity_id, created_at
                    )
                    VALUES (
                        CAST(:uid AS UUID), 'system', :severity,
                        :title, :body, :link,
                        :entity_type, :entity_id, NOW()
                    )
                    """
                ),
                {
                    "uid": uid,
                    "severity": "critical" if category == "notif_sii" else "warning",
                    "title": title[:200],
                    "body": body,
                    "link": f"/admin/mailbox?focus={inbox_id}",
                    "entity_type": "inbox_message",
                    "entity_id": str(inbox_id),
                },
            )
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "inbox.alert.create_failed",
            inbox_id=inbox_id,
            error=str(exc),
        )


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
