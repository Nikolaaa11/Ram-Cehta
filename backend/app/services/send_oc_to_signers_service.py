"""R152IIII · Auto-envío del PDF de OC al GG (con CC a encargados).

Después de crear una OC (auto o manual), este servicio:
  1. Genera el PDF con branding embedded (logo + firmas — R152www).
  2. Construye TO + CC desde core.empresas:
       TO = gerente_general_email (si oc_firma_colectiva=FALSE)
            o todos los firmantes_extra (si oc_firma_colectiva=TRUE, RHO)
       CC = emails_oc_cc
  3. Manda via Resend con PDF adjunto.
  4. UPDATE core.ordenes_compra con oc_sent_to/cc/at/message_id.
  5. Si falla, guarda oc_send_error y NO bloquea el flujo.

Si la empresa tiene auto_send_oc_emails=FALSE, skip silencioso (la OC
se queda sin enviar y el operador la manda manual desde la UI).
"""
from __future__ import annotations

import base64
import json
import re
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.email_service import EmailService

log = structlog.get_logger(__name__)


async def send_oc_to_signers(
    db: AsyncSession, oc_id: int
) -> dict[str, Any]:
    """Genera PDF + manda email al GG con CC a encargados.

    Returns:
      {"ok": True, "to": "...", "cc": [...], "message_id": "..."}
      {"ok": False, "error": "...", "skipped": True/False}
    """
    # 1. Datos de OC + empresa
    # R152MMMM · usar .mappings() + acceso por nombre — antes accedíamos por
    # índice posicional (row[14], row[15]) lo cual rompía silenciosamente si
    # alguien agregaba/movía columnas del SELECT. Defensive coding.
    result = await db.execute(
        text(
            """SELECT oc.numero_oc AS numero_oc,
                      oc.empresa_codigo AS empresa_codigo,
                      p.razon_social AS proveedor_nombre,
                      e.razon_social AS empresa_razon_social,
                      e.gerente_general_email AS gg_email,
                      e.gerente_general_nombre AS gg_nombre,
                      e.oc_firma_colectiva AS firma_colectiva,
                      COALESCE(e.firmantes_extra, '[]'::jsonb) AS firmantes_extra,
                      COALESCE(e.emails_oc_cc, ARRAY[]::TEXT[]) AS emails_cc,
                      e.auto_send_oc_emails AS auto_send,
                      oc.oc_sent_at AS oc_sent_at
               FROM core.ordenes_compra oc
               JOIN core.empresas e ON e.codigo = oc.empresa_codigo
               LEFT JOIN core.proveedores p ON p.proveedor_id = oc.proveedor_id
               WHERE oc.oc_id = :id"""
        ),
        {"id": oc_id},
    )
    row = result.mappings().first()

    if not row:
        return {"ok": False, "error": f"OC {oc_id} no encontrada"}

    if not row["auto_send"]:
        return {
            "ok": False,
            "skipped": True,
            "error": "auto_send_oc_emails=FALSE para esta empresa",
        }

    if row["oc_sent_at"] is not None:
        return {
            "ok": False,
            "skipped": True,
            "error": "OC ya fue enviada previamente",
        }

    numero_oc = row["numero_oc"]
    empresa_codigo = row["empresa_codigo"]
    proveedor_nombre = row["proveedor_nombre"] or "Proveedor"
    empresa_razon_social = row["empresa_razon_social"] or empresa_codigo
    gg_email = row["gg_email"]
    gg_nombre = row["gg_nombre"] or ""
    firma_colectiva = bool(row["firma_colectiva"])
    firmantes_raw = row["firmantes_extra"] or []
    emails_cc = list(row["emails_cc"] or [])

    # 2. Armar TO + CC
    to_list: list[str] = []

    if firma_colectiva:
        # RHO: TO = todos los firmantes_extra.email
        if isinstance(firmantes_raw, str):
            try:
                firmantes_raw = json.loads(firmantes_raw)
            except Exception:
                firmantes_raw = []
        for f in firmantes_raw:
            email = (f.get("email") or "").strip()
            if email and _valid_email(email):
                to_list.append(email)
    else:
        # Single GG
        if gg_email and _valid_email(gg_email):
            to_list.append(gg_email)

    # Dedupe + filtrar CC duplicados
    to_set = {e.lower() for e in to_list}
    cc_clean = [e for e in emails_cc if _valid_email(e) and e.lower() not in to_set]

    # R152UUUU — Test redirect global.
    # Si OC_EMAIL_TEST_REDIRECT_TO está set (CSV de emails), reescribe TO/CC
    # completos. Sirve para fase de prueba sin tocar la config real de las
    # empresas. Primer email = TO, demás = CC. Setear/quitar con:
    #   fly secrets set OC_EMAIL_TEST_REDIRECT_TO="benja@...,victoria@..."
    #   fly secrets unset OC_EMAIL_TEST_REDIRECT_TO
    try:
        from app.core.config import settings as _settings
        redirect_raw = getattr(_settings, "oc_email_test_redirect_to", None)
    except Exception:
        redirect_raw = None
    if redirect_raw:
        redirect_emails = [
            e.strip() for e in str(redirect_raw).split(",")
            if e.strip() and _valid_email(e.strip())
        ]
        if redirect_emails:
            log.info(
                "send_oc.test_redirect_active",
                oc_id=oc_id,
                original_to=to_list,
                original_cc=cc_clean,
                redirect_to=redirect_emails,
            )
            to_list = [redirect_emails[0]]
            cc_clean = redirect_emails[1:]
            to_set = {redirect_emails[0].lower()}

    if not to_list:
        msg = (
            f"Sin destinatarios válidos. Empresa {empresa_codigo}: "
            f"gg_email={gg_email!r}, colectiva={firma_colectiva}, "
            f"firmantes={len(firmantes_raw) if isinstance(firmantes_raw, list) else 0}. "
            f"Configurá los emails en Operaciones → Órdenes de Compra."
        )
        await _save_error(db, oc_id, msg)
        return {"ok": False, "error": msg}

    # 3. Generar PDF
    try:
        from app.services.oc_pdf_service import generate_oc_pdf_bundle

        pdf_bytes = await generate_oc_pdf_bundle(
            oc_id=oc_id,
            db=db,
            include_attachments=True,
        )
    except Exception as exc:
        msg = f"Error generando PDF: {exc}"
        await _save_error(db, oc_id, msg)
        return {"ok": False, "error": msg}

    # 4. Armar email
    subject = (
        f"Orden de Compra {numero_oc} — {empresa_razon_social}"
        f" → {proveedor_nombre}"
    )
    html = _build_oc_email_html(
        numero_oc=numero_oc,
        empresa_razon_social=empresa_razon_social,
        proveedor_nombre=proveedor_nombre,
        gg_nombre=gg_nombre,
        firma_colectiva=firma_colectiva,
    )
    attachment = {
        "filename": f"OC-{numero_oc}.pdf",
        "content": base64.b64encode(pdf_bytes).decode("ascii"),
    }

    # 5. Enviar
    email_svc = EmailService()
    if not email_svc.enabled:
        msg = "Resend no está configurado (RESEND_API_KEY missing)"
        await _save_error(db, oc_id, msg)
        return {"ok": False, "error": msg}

    result = await email_svc.send_async(
        to=to_list,
        cc=cc_clean if cc_clean else None,
        subject=subject,
        html=html,
        attachments=[attachment],
    )

    if not result or not result.get("id"):
        msg = "Resend no devolvió message_id (envío posiblemente falló)"
        await _save_error(db, oc_id, msg)
        return {"ok": False, "error": msg}

    message_id = result["id"]

    # 6. UPDATE audit
    await db.execute(
        text(
            """UPDATE core.ordenes_compra SET
                 oc_sent_to = :to_first,
                 oc_sent_cc = :cc,
                 oc_sent_at = NOW(),
                 oc_send_message_id = :mid,
                 oc_send_error = NULL,
                 updated_at = NOW()
               WHERE oc_id = :id"""
        ),
        {
            "to_first": ", ".join(to_list)[:255],
            "cc": cc_clean,
            "mid": message_id[:100],
            "id": oc_id,
        },
    )
    await db.commit()

    log.info(
        "send_oc_to_signers.success",
        oc_id=oc_id,
        numero_oc=numero_oc,
        empresa=empresa_codigo,
        to_count=len(to_list),
        cc_count=len(cc_clean),
        message_id=message_id,
    )

    return {
        "ok": True,
        "to": to_list,
        "cc": cc_clean,
        "message_id": message_id,
        "subject": subject,
    }


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────


_EMAIL_RE = re.compile(r"^[\w\.\-\+]+@[\w\.\-]+\.[A-Za-z]{2,}$")


def _valid_email(s: str) -> bool:
    return bool(s and _EMAIL_RE.match(s.strip()))


async def _save_error(db: AsyncSession, oc_id: int, msg: str) -> None:
    try:
        await db.execute(
            text(
                """UPDATE core.ordenes_compra
                   SET oc_send_error = :err, updated_at = NOW()
                   WHERE oc_id = :id"""
            ),
            {"err": msg[:500], "id": oc_id},
        )
        await db.commit()
    except Exception as exc:
        log.warning("send_oc.save_error_failed", err=str(exc))


def _build_oc_email_html(
    *,
    numero_oc: str,
    empresa_razon_social: str,
    proveedor_nombre: str,
    gg_nombre: str,
    firma_colectiva: bool,
) -> str:
    """Template HTML conservador (compatible Gmail/Outlook)."""
    saludo = (
        f"Estimados firmantes," if firma_colectiva
        else f"Estimado {gg_nombre or 'Gerente General'},"
    )
    accion = (
        "tu firma colectiva (RHO requiere todas las firmas)"
        if firma_colectiva
        else "tu firma como representante legal"
    )

    return f"""<!doctype html>
<html lang="es">
<head><meta charset="utf-8"/></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color:#111827; max-width:640px; margin:0 auto; padding:24px;">
  <div style="border-bottom:2px solid #236C4F; padding-bottom:16px; margin-bottom:24px;">
    <h1 style="margin:0; font-size:20px; color:#236C4F;">Orden de Compra {numero_oc}</h1>
    <p style="margin:8px 0 0; color:#6b7280; font-size:13px;">{empresa_razon_social}</p>
  </div>

  <p style="font-size:15px;">{saludo}</p>

  <p style="font-size:14px; line-height:1.6;">
    Adjuntamos la <strong>Orden de Compra Nº {numero_oc}</strong>
    para <strong>{proveedor_nombre}</strong>.
  </p>

  <p style="font-size:14px; line-height:1.6;">
    Esta OC fue generada automáticamente desde la plataforma. Por favor
    revisar los datos, descargar el PDF adjunto y enviar firmado al
    proveedor. Para esta operación se requiere {accion}.
  </p>

  <div style="background:#f9fafb; border-left:3px solid #236C4F; padding:12px 16px; margin:20px 0; font-size:13px; color:#374151;">
    <strong>📎 Adjunto:</strong> OC-{numero_oc}.pdf<br>
    Incluye logo de {empresa_razon_social}, datos del proveedor, ítems,
    totales con IVA, validez y bloque de firma.
  </div>

  <p style="font-size:13px; color:#6b7280; margin-top:32px;">
    Cualquier consulta o ajuste, responder a este mismo email.<br>
    <em>Generada automáticamente por Ram-Cehta · Cehta Capital</em>
  </p>
</body>
</html>"""
