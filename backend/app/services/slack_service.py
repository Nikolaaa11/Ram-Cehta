"""Slack notifications opcional — ping a canal cuando ocurre evento crítico.

Diseño soft-fail:
  - Si SLACK_WEBHOOK_URL no está, todo el módulo es no-op.
  - Si Slack está caído, log warning y seguir.
  - Nunca rompe el caller (publish_event).

Eventos que disparan Slack (V5++):
  - voucher.approved con total > slack_voucher_min_amount → "Voucher
    aprobado por $X"
  - notif_sii del inbox classifier → "Email SII recibido"
  - F29 vencido → "F29 vencido sin pago"
  - cartola_run.failed → "Sync cartolas falló"

API: post_message(text, blocks=None) async — usa httpx.AsyncClient.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)


async def post_message(
    text: str,
    *,
    blocks: list[dict] | None = None,
    timeout_s: float = 5.0,
) -> bool:
    """Envía un mensaje al webhook de Slack. Devuelve True si OK.

    Soft-fail: si la URL no está configurada, devuelve False sin
    intentar nada. Si Slack devuelve error, log warning y False.
    """
    if not settings.slack_webhook_url:
        return False

    payload: dict[str, Any] = {"text": text}
    if blocks:
        payload["blocks"] = blocks

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            response = await client.post(
                settings.slack_webhook_url, json=payload
            )
        if response.status_code != 200:
            log.warning(
                "slack.post_failed",
                status=response.status_code,
                body=response.text[:200],
            )
            return False
        return True
    except Exception as exc:  # noqa: BLE001
        log.warning("slack.post_exception", error=str(exc))
        return False


async def notify_voucher_approved(
    *,
    voucher_codigo: str,
    empresa_codigo: str,
    tipo: str,
    total_clp: int,
    approved_by: str,
) -> bool:
    """Notifica un voucher recién aprobado si supera el threshold.

    Threshold default: $5M CLP. Configurable con SLACK_VOUCHER_MIN_AMOUNT.
    """
    if total_clp < settings.slack_voucher_min_amount:
        return False

    monto_str = f"${total_clp:,}".replace(",", ".")
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"💵 Voucher aprobado · {monto_str}",
            },
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Código:* `{voucher_codigo}`"},
                {"type": "mrkdwn", "text": f"*Empresa:* {empresa_codigo}"},
                {"type": "mrkdwn", "text": f"*Tipo:* {tipo}"},
                {"type": "mrkdwn", "text": f"*Aprobado por:* `{approved_by[:8]}…`"},
            ],
        },
    ]
    return await post_message(
        f"Voucher {voucher_codigo} aprobado por {monto_str}",
        blocks=blocks,
    )


async def notify_sii_email(
    *,
    from_email: str,
    subject: str,
    summary: str | None = None,
) -> bool:
    """Notifica un email del SII recibido (categoría notif_sii)."""
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": "🚨 Email del SII recibido",
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*De:* {from_email}\n*Asunto:* {subject}\n"
                + (f"\n*Resumen AI:* {summary[:300]}" if summary else ""),
            },
        },
    ]
    return await post_message(
        f"Email SII: {subject[:100]}", blocks=blocks
    )


async def notify_f29_vencido(
    *,
    empresa_codigo: str,
    periodo: str,
    monto_clp: int | None,
    dias_vencido: int,
) -> bool:
    """Notifica F29 vencido sin pago."""
    monto_str = f"${monto_clp:,}".replace(",", ".") if monto_clp else "—"
    return await post_message(
        f"⚠️ F29 vencido · {empresa_codigo} {periodo} · {dias_vencido}d · {monto_str}"
    )
