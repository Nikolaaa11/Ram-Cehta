"""Email service usando Resend (V3 fase 3+4).

Diseño — **soft fail**: si `RESEND_API_KEY` no está seteada, las llamadas a
`send()` loggean `email.disabled` y devuelven `None` sin romper el caller.
Esto permite habilitar Resend después sin tocar código.

Uso típico:
    svc = EmailService()
    svc.send(
        to=["nicolas@cehta.cl"],
        subject="Alerta legal — vencimiento próximo",
        html=render_template("legal_alert.html", {...}),
    )

Templates Jinja2 viven en `app/services/email_templates/`. Render mínimo
con `string.Template` (sin Jinja2 para evitar otra dep) — los placeholders
`{{ var }}` de los .html se reemplazan en `render_template()`.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import structlog

from app.core.config import settings

log = structlog.get_logger(__name__)

_TEMPLATES_DIR = Path(__file__).parent / "email_templates"


def render_template(template_name: str, context: dict[str, Any]) -> str:
    """Renderiza un template HTML simple con sustitución `{{ key }}`.

    Mantenemos render mínimo (sin Jinja2 ni dependencias adicionales) — los
    templates son emails simples y la lógica vive en el caller.
    Sustitución case-sensitive sobre `{{ key }}` literal con padding flex.
    """
    path = _TEMPLATES_DIR / template_name
    html = path.read_text(encoding="utf-8")
    for key, value in context.items():
        # Permite {{ key }}, {{key}}, {{  key  }} — toleramos espacios.
        html = (
            html.replace(f"{{{{ {key} }}}}", str(value))
            .replace(f"{{{{{key}}}}}", str(value))
            .replace(f"{{{{  {key}  }}}}", str(value))
        )
    return html


class EmailService:
    """Wrapper sobre Resend con soft-fail si no está configurado."""

    def __init__(self) -> None:
        self._client: Any = None
        if settings.resend_api_key:
            try:
                import resend  # noqa: PLC0415 — opcional por diseño

                resend.api_key = settings.resend_api_key
                self._client = resend
            except ImportError:
                log.warning("email.resend_not_installed")

    @property
    def enabled(self) -> bool:
        return self._client is not None

    def send(
        self,
        *,
        to: list[str],
        subject: str,
        html: str,
        attachments: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any] | None:
        """Envía un email vía Resend. Soft-fail si no está configurado."""
        if not self.enabled:
            log.warning("email.disabled", to=to, subject=subject)
            return None
        if not to:
            log.warning("email.no_recipients", subject=subject)
            return None
        params: dict[str, Any] = {
            "from": settings.email_from,
            "to": to,
            "subject": subject,
            "html": html,
        }
        if attachments:
            params["attachments"] = attachments
        try:
            return self._client.Emails.send(params)
        except Exception as exc:  # noqa: BLE001 — soft fail, log y seguir
            log.warning("email.send_failed", to=to, subject=subject, error=str(exc))
            return None


def get_email_service() -> EmailService:
    """Factory simple para inyectar el service en endpoints."""
    return EmailService()
