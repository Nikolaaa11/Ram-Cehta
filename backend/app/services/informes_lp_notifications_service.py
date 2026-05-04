"""Notification engine para Informes LP virales (V4 fase 9.2).

Cierra el loop viral 1→N: cuando un LP comparte (parent) y el destinatario
(child) abre/convierte, mandamos email POSITIVO al parent:

  - 👀 "{destinatario} abrió tu link"
  - 🎉 "{destinatario} agendó café con Camilo"

Anti-spam: una notificación de cada tipo por child_token (UNIQUE).
Soft-fail: si Resend no está, loggea pero no rompe.

Diseño:
  - Función `dispatch_pending_notifications(db)` corre por cron diario.
  - Escanea events de child tokens que tienen parent_token poblado.
  - Para cada uno, decide qué notificación mandar (si no se mandó ya).
  - Inserta row en `app.informes_lp_notifications` con UNIQUE constraint
    para garantizar idempotencia.

Resultado: un parent que comparte con 3 colegas y 2 abren + 1 convierte
recibe 3 emails total (no más, no menos).
"""
from __future__ import annotations

import structlog
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.email_service import EmailService, render_template

log = structlog.get_logger(__name__)


async def dispatch_pending_notifications(
    db: AsyncSession, dry_run: bool = False
) -> dict[str, int]:
    """Escanea eventos open/agendar_click en informes con parent_token y
    envía notificación al LP parent si aún no fue notificado.

    Args:
        db: AsyncSession activa
        dry_run: si True, NO envía emails — solo cuenta lo que mandaría.

    Returns:
        {"open_sent": N, "convert_sent": N, "skipped": N, "errors": N}
    """
    email_svc = EmailService()
    out = {"open_sent": 0, "convert_sent": 0, "skipped": 0, "errors": 0}

    # Pull todos los eventos open + agendar_click de informes con parent_token,
    # JOIN con informes_lp para tener el child_token + parent_token + LPs.
    # No filtrar por tiempo — la query es cheap (indexed) y la idempotencia
    # se maneja por la tabla informes_lp_notifications con UNIQUE.
    query = """
        SELECT DISTINCT ON (e.token, e.tipo)
            e.token AS child_token,
            e.tipo AS event_tipo,
            e.created_at AS event_at,
            child.parent_token AS parent_token,
            child.created_at AS child_created_at,
            child_lp.nombre AS child_lp_nombre,
            child_lp.apellido AS child_lp_apellido,
            child_lp.email AS child_lp_email,
            parent.lp_id AS parent_lp_id,
            parent_lp.nombre AS parent_lp_nombre,
            parent_lp.apellido AS parent_lp_apellido,
            parent_lp.email AS parent_lp_email
        FROM app.informes_lp_eventos e
        JOIN app.informes_lp child ON e.informe_id = child.informe_id
        JOIN app.informes_lp parent ON child.parent_token = parent.token
        LEFT JOIN core.lps child_lp ON child.lp_id = child_lp.lp_id
        LEFT JOIN core.lps parent_lp ON parent.lp_id = parent_lp.lp_id
        WHERE child.parent_token IS NOT NULL
          AND e.tipo IN ('open', 'agendar_click')
          AND parent_lp.email IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM app.informes_lp_notifications n
              WHERE n.child_token = e.token
                AND n.tipo = CASE
                    WHEN e.tipo = 'open' THEN 'open'
                    WHEN e.tipo = 'agendar_click' THEN 'convert'
                END
          )
        ORDER BY e.token, e.tipo, e.created_at ASC
    """
    rows = (await db.execute(text(query))).mappings().all()

    for r in rows:
        try:
            child_nombre = (
                (r["child_lp_nombre"] or "")
                + (f" {r['child_lp_apellido']}" if r["child_lp_apellido"] else "")
            ).strip() or "Tu colega"
            parent_nombre = (
                (r["parent_lp_nombre"] or "")
                + (f" {r['parent_lp_apellido']}" if r["parent_lp_apellido"] else "")
            ).strip() or "Inversionista"
            parent_email = r["parent_lp_email"]
            child_token = r["child_token"]
            parent_token = r["parent_token"]
            event_tipo = r["event_tipo"]
            child_created_at = r["child_created_at"]
            fecha_share = (
                child_created_at.strftime("%-d de %B")
                if child_created_at and hasattr(child_created_at, "strftime")
                else "—"
            )

            if event_tipo == "open":
                noti_tipo = "open"
                template = "informe_lp_advocate_open.html"
                subject = f"👀 {child_nombre} abrió tu link"
            elif event_tipo == "agendar_click":
                noti_tipo = "convert"
                template = "informe_lp_advocate_convert.html"
                subject = f"🎉 {child_nombre} agendó con Camilo"
            else:
                continue

            if dry_run:
                out[f"{noti_tipo}_sent"] += 1
                continue

            html = render_template(
                template,
                {
                    "destinatario_nombre": child_nombre,
                    "remitente_nombre": parent_nombre,
                    "fecha_share": fecha_share,
                },
            )

            send_result = email_svc.send(
                to=[parent_email], subject=subject, html=html
            )
            resend_id: str | None = None
            error_msg: str | None = None
            if send_result is None:
                # Soft-fail: Resend no configurado o sin recipients válidos.
                error_msg = "email_disabled"
            elif isinstance(send_result, dict):
                resend_id = send_result.get("id")

            # Insert idempotente: si ya existe la fila, ON CONFLICT DO NOTHING
            await db.execute(
                text(
                    """
                    INSERT INTO app.informes_lp_notifications
                        (child_token, parent_token, tipo, email_destinatario,
                         email_to, sent_at, resend_id, error)
                    VALUES (:child_token, :parent_token, :tipo, :email_destinatario,
                            :email_to, now(), :resend_id, :error)
                    ON CONFLICT (child_token, tipo) DO NOTHING
                    """
                ),
                {
                    "child_token": child_token,
                    "parent_token": parent_token,
                    "tipo": noti_tipo,
                    "email_destinatario": r["child_lp_email"] or "",
                    "email_to": parent_email,
                    "resend_id": resend_id,
                    "error": error_msg,
                },
            )

            if error_msg:
                out["skipped"] += 1
            else:
                out[f"{noti_tipo}_sent"] += 1

        except Exception as e:  # noqa: BLE001
            out["errors"] += 1
            log.warning(
                "informes_lp.notification.error",
                error=str(e),
                child_token=r.get("child_token"),
            )

    if not dry_run:
        await db.commit()
    return out


async def send_share_invitation(
    db: AsyncSession,
    *,
    child_token: str,
    parent_token: str,
    email_destinatario: str,
    nombre_destinatario: str,
    nombre_remitente: str,
    mensaje_personal: str | None,
    informe_url: str,
) -> dict[str, Any]:
    """Envía el email de invitación al destinatario cuando un LP comparte.

    Soft-fail: si Resend no está, loggea + persiste row con `error` para
    que el operador pueda reenviar luego.
    """
    email_svc = EmailService()
    subject = f"{nombre_remitente} te recomendó Cehta Capital"

    # Default mensaje si no vino
    mensaje_html = (
        mensaje_personal
        or "Te dejo este reporte privado del fondo. Cuando puedas, échale un vistazo."
    )

    html = render_template(
        "informe_lp_share.html",
        {
            "destinatario_nombre": nombre_destinatario.split(" ")[0]
            if nombre_destinatario
            else "ahí",
            "remitente_nombre": nombre_remitente,
            "mensaje_personal": mensaje_html,
            "informe_url": informe_url,
        },
    )

    send_result = email_svc.send(to=[email_destinatario], subject=subject, html=html)
    resend_id: str | None = None
    error_msg: str | None = None
    if send_result is None:
        error_msg = "email_disabled_or_no_recipients"
    elif isinstance(send_result, dict):
        resend_id = send_result.get("id")

    # Persistir registro
    await db.execute(
        text(
            """
            INSERT INTO app.informes_lp_notifications
                (child_token, parent_token, tipo, email_destinatario,
                 email_to, sent_at, resend_id, error)
            VALUES (:child_token, :parent_token, 'share_sent', :email_destinatario,
                    :email_to, now(), :resend_id, :error)
            ON CONFLICT (child_token, tipo) DO NOTHING
            """
        ),
        {
            "child_token": child_token,
            "parent_token": parent_token,
            "email_destinatario": email_destinatario,
            "email_to": email_destinatario,
            "resend_id": resend_id,
            "error": error_msg,
        },
    )
    return {"resend_id": resend_id, "error": error_msg}
