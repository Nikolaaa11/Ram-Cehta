"""Tests para EmailService (V3 fase 3+4) — soft-fail y render de templates.

Como el servicio Resend depende de un SDK externo y de la env var
`RESEND_API_KEY`, las pruebas se enfocan en:
1) Soft-fail: sin api key → `enabled=False` y `send` devuelve `None`.
2) Render de templates con sustitución `{{ key }}`.
"""
from __future__ import annotations

import pytest

from app.services.email_service import EmailService, render_template


@pytest.fixture(autouse=True)
def _no_resend(monkeypatch: pytest.MonkeyPatch) -> None:
    """Asegura que RESEND_API_KEY no esté seteada en estos tests."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "resend_api_key", None, raising=False)


class TestEmailServiceDisabled:
    def test_enabled_false_si_no_hay_api_key(self) -> None:
        svc = EmailService()
        assert svc.enabled is False

    def test_send_devuelve_none_si_disabled(self) -> None:
        svc = EmailService()
        result = svc.send(to=["a@b.cl"], subject="x", html="<p>x</p>")
        assert result is None

    def test_send_no_lanza_excepcion_si_disabled(self) -> None:
        svc = EmailService()
        # No raise, no side effect — soft fail
        svc.send(to=[], subject="x", html="<p>x</p>")


class TestRenderTemplate:
    def test_render_legal_alert(self) -> None:
        html = render_template(
            "legal_alert.html",
            {
                "empresa_codigo": "ACME",
                "nombre": "Contrato XYZ",
                "categoria": "contrato",
                "contraparte": "Banco",
                "fecha_vigencia_hasta": "2026-12-31",
                "dias_para_vencer": 12,
                "alerta_nivel": "critico",
                "link": "https://app.cehta.cl/legal/1",
            },
        )
        assert "ACME" in html
        assert "Contrato XYZ" in html
        assert "12 días" in html
        # Sin placeholders sin reemplazar
        assert "{{ empresa_codigo }}" not in html
        assert "{{ nombre }}" not in html

    def test_render_f29_reminder(self) -> None:
        html = render_template(
            "f29_reminder.html",
            {
                "empresa_codigo": "ACME",
                "periodo_tributario": "04_26",
                "fecha_vencimiento": "2026-05-12",
                "monto_a_pagar": "$1.234.567",
                "dias_para_vencer": 3,
                "link": "https://app.cehta.cl/f29",
            },
        )
        assert "ACME" in html
        assert "04_26" in html
        assert "3 días" in html

    def test_render_welcome_user(self) -> None:
        html = render_template(
            "welcome_user.html",
            {"nombre": "Nicolas", "rol": "admin", "link": "https://app.cehta.cl"},
        )
        assert "Nicolas" in html
        assert "admin" in html

    def test_render_monthly_report(self) -> None:
        html = render_template(
            "monthly_report.html",
            {
                "periodo": "Abril 2026",
                "aum_total": "$10.000.000",
                "flujo_neto": "$1.000.000",
                "resumen": "Mes positivo: AUM creció 5%.",
                "link": "https://app.cehta.cl/ceo",
            },
        )
        assert "Abril 2026" in html
        assert "creció 5%" in html
