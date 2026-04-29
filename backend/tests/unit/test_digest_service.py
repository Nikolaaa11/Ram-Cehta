"""Tests para DigestService — CEO Weekly Digest (V3 fase 10).

Cubre:
  - Helpers puros: _fmt_clp, sort_alerts (critical primero), _color_for_*
  - build_html: render no-raise sobre payload vacío y payload completo,
    placeholders inline-styled (no <link>, no <style> block)
  - build_plain_text: contiene KPIs y alertas
  - send_to_ceo: soft-fail sin api_key → sent=0
  - Endpoint scope: non-admin → 403
  - Aggregation con DB fake (in-memory rows)
"""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import current_user, db_session
from app.api.v1 import digest as digest_router
from app.core.security import AuthenticatedUser
from app.schemas.digest import (
    CEODigestPayload,
    DigestAlert,
    EmpresaDigestRow,
    MovimientoDigestRow,
)
from app.services.digest_service import (
    DigestService,
    _color_for_health,
    _color_for_severity,
    _fmt_clp,
    sort_alerts,
)


@pytest.fixture(autouse=True)
def _no_resend(monkeypatch: pytest.MonkeyPatch) -> None:
    """Asegura que RESEND_API_KEY no esté seteada en estos tests."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "resend_api_key", None, raising=False)
    monkeypatch.setattr(
        settings,
        "email_admin_recipients",
        ["ceo@cehta.cl", "nicolas@cehta.cl"],
        raising=False,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _empty_payload() -> CEODigestPayload:
    today = date(2026, 4, 29)
    return CEODigestPayload(
        generated_at=datetime(2026, 4, 29, 8, 0, tzinfo=UTC),
        period_from=today - timedelta(days=7),
        period_to=today,
        top_kpis={},
        empresas=[],
        alerts=[],
        movimientos_significativos=[],
        vs_prev_week={},
    )


def _full_payload() -> CEODigestPayload:
    today = date(2026, 4, 29)
    return CEODigestPayload(
        generated_at=datetime(2026, 4, 29, 8, 0, tzinfo=UTC),
        period_from=today - timedelta(days=7),
        period_to=today,
        top_kpis={
            "total_saldo": 250_000_000,
            "total_flujo_7d": -3_500_000,
            "total_oc_pendientes": 12,
            "total_f29_vencidas": 2,
            "n_empresas": 9,
        },
        empresas=[
            EmpresaDigestRow(
                codigo="ACME",
                razon_social="Acme SpA",
                health_score=85,
                saldo_actual=Decimal("100000000"),
                flujo_7d=Decimal("2000000"),
                oc_pendientes=3,
                f29_vencidas=0,
                delta_health=5,
            ),
            EmpresaDigestRow(
                codigo="BETA",
                razon_social="Beta Ltda",
                health_score=45,
                saldo_actual=Decimal("-500000"),
                flujo_7d=Decimal("-1000000"),
                oc_pendientes=8,
                f29_vencidas=2,
                delta_health=-15,
            ),
        ],
        alerts=[
            DigestAlert(
                tipo="f29_vencida",
                severity="critical",
                title="F29 vencida — BETA (03_26)",
                body="Vence hace 5 días",
                link="/f29",
            ),
            DigestAlert(
                tipo="oc_estancada",
                severity="warning",
                title="OC estancada 18d — ACME",
                body="OC #123",
                link="/ordenes-compra",
            ),
        ],
        movimientos_significativos=[
            MovimientoDigestRow(
                fecha=date(2026, 4, 25),
                empresa_codigo="ACME",
                descripcion="Pago proveedor X",
                monto=Decimal("8000000"),
                tipo="egreso",
            ),
        ],
        vs_prev_week={
            "flujo_now": -3_500_000,
            "flujo_prev": 1_200_000,
            "flujo_delta": -4_700_000,
            "oc_creadas_now": 4,
            "oc_creadas_prev": 7,
            "oc_creadas_delta": -3,
            "f29_pagadas_now": 1,
            "f29_pagadas_prev": 2,
            "f29_pagadas_delta": -1,
        },
    )


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestFormatClp:
    def test_zero(self) -> None:
        assert _fmt_clp(0) == "$0"

    def test_none(self) -> None:
        assert _fmt_clp(None) == "$0"

    def test_positive(self) -> None:
        assert _fmt_clp(Decimal("1234567")) == "$1.234.567"

    def test_negative(self) -> None:
        assert _fmt_clp(Decimal("-12345")) == "-$12.345"


class TestSortAlerts:
    def test_critical_before_warning_before_info(self) -> None:
        alerts = [
            DigestAlert(tipo="x", severity="info", title="i", body="b"),
            DigestAlert(tipo="x", severity="critical", title="c", body="b"),
            DigestAlert(tipo="x", severity="warning", title="w", body="b"),
        ]
        out = sort_alerts(alerts)
        assert [a.severity for a in out] == ["critical", "warning", "info"]

    def test_stable_within_severity(self) -> None:
        alerts = [
            DigestAlert(tipo="x", severity="critical", title="A", body=""),
            DigestAlert(tipo="x", severity="critical", title="B", body=""),
            DigestAlert(tipo="x", severity="warning", title="C", body=""),
        ]
        out = sort_alerts(alerts)
        assert [a.title for a in out] == ["A", "B", "C"]


class TestColorHelpers:
    def test_severity_colors_distinct(self) -> None:
        assert _color_for_severity("critical") != _color_for_severity("warning")
        assert _color_for_severity("warning") != _color_for_severity("info")

    def test_health_color_thresholds(self) -> None:
        assert _color_for_health(80) == _color_for_health(100)
        assert _color_for_health(70) == _color_for_health(60)
        assert _color_for_health(50) == _color_for_health(0)
        # Y los 3 deben ser distintos entre sí
        assert _color_for_health(90) != _color_for_health(70)
        assert _color_for_health(70) != _color_for_health(30)


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------


def _make_service() -> DigestService:
    """Crea un DigestService con DB mock que no se va a usar para render tests."""
    db = MagicMock()
    return DigestService(db)


class TestBuildHtml:
    def test_renders_empty_without_raising(self) -> None:
        svc = _make_service()
        html = svc.build_html(_empty_payload())
        assert "<html" in html
        assert "Cehta Capital" in html
        assert "2026-04-22" in html  # period_from
        assert "2026-04-29" in html  # period_to

    def test_renders_full_payload(self) -> None:
        svc = _make_service()
        html = svc.build_html(_full_payload())
        # Empresas presentes
        assert "ACME" in html
        assert "BETA" in html
        # KPIs formateados
        assert "$250.000.000" in html
        # Alerta critical
        assert "F29 vencida" in html
        # Movimiento significativo
        assert "Pago proveedor X" in html
        # vs prev week block
        assert "vs semana previa" in html

    def test_no_external_resources(self) -> None:
        """Mailbox-safe: sin <link>, <style> block, ni @import."""
        svc = _make_service()
        html = svc.build_html(_full_payload())
        assert "<link" not in html.lower()
        # Permitimos style="..." inline pero no bloque <style>
        assert "<style" not in html.lower()
        assert "@import" not in html
        assert "googleapis.com" not in html  # no Google Fonts

    def test_inline_styles_present(self) -> None:
        svc = _make_service()
        html = svc.build_html(_full_payload())
        # Cada bloque importante usa style=
        assert 'style="' in html
        # Apple-ish palette ink-900
        assert "#1f2937" in html
        # Cehta-green
        assert "#10b981" in html


class TestBuildPlainText:
    def test_contains_section_headers(self) -> None:
        svc = _make_service()
        text = svc.build_plain_text(_full_payload())
        assert "DIGEST SEMANAL CEO" in text
        assert "KPIS CONSOLIDADOS" in text
        assert "EMPRESAS" in text
        assert "TOP ALERTAS" in text
        assert "MOVIMIENTOS SIGNIFICATIVOS" in text
        assert "VS SEMANA PREVIA" in text

    def test_empty_payload_does_not_raise(self) -> None:
        svc = _make_service()
        text = svc.build_plain_text(_empty_payload())
        assert "DIGEST SEMANAL CEO" in text
        # Sin secciones de empresas/alertas/movs si vienen vacías
        assert "EMPRESAS" not in text
        assert "TOP ALERTAS" not in text

    def test_empresa_lines_present(self) -> None:
        svc = _make_service()
        text = svc.build_plain_text(_full_payload())
        assert "ACME" in text
        assert "BETA" in text
        # Format usa width=3 → "health= 85" para 2 dígitos.
        assert "health= 85" in text
        assert "health= 45" in text


# ---------------------------------------------------------------------------
# send_to_ceo soft-fail
# ---------------------------------------------------------------------------


class TestSendToCeo:
    @pytest.mark.asyncio
    async def test_soft_fail_when_email_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        svc = _make_service()
        # build_ceo_weekly_digest mock: devolvemos payload vacío sin tocar DB
        async def fake_build() -> CEODigestPayload:
            return _empty_payload()

        monkeypatch.setattr(svc, "build_ceo_weekly_digest", fake_build)
        result = await svc.send_to_ceo()
        # Sin api_key → enabled=False → sent=0, todos failed
        assert result.sent == 0
        assert len(result.failed) == 2  # los 2 admin recipients del fixture

    @pytest.mark.asyncio
    async def test_no_recipients_returns_zero(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.core.config import settings

        monkeypatch.setattr(settings, "email_admin_recipients", [], raising=False)
        svc = _make_service()
        result = await svc.send_to_ceo()
        assert result.sent == 0
        assert result.failed == []

    @pytest.mark.asyncio
    async def test_explicit_recipients_override_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        svc = _make_service()

        async def fake_build() -> CEODigestPayload:
            return _empty_payload()

        monkeypatch.setattr(svc, "build_ceo_weekly_digest", fake_build)
        result = await svc.send_to_ceo(recipients=["test@x.cl"])
        # Sin api_key → sent=0, failed = [test@x.cl]
        assert result.sent == 0
        assert result.failed == ["test@x.cl"]


# ---------------------------------------------------------------------------
# Endpoint scope check (non-admin → 403, missing token → 401)
# ---------------------------------------------------------------------------


def _build_app_with_user(role: str) -> FastAPI:
    """Builds a minimal FastAPI app with auth dependency overridden."""
    app = FastAPI()
    app.include_router(digest_router.router, prefix="/digest")

    def fake_user() -> AuthenticatedUser:
        return AuthenticatedUser(
            sub="test-user",
            email="test@x.cl",
            app_role=role,
            raw_claims={},
        )

    async def fake_db() -> Any:
        # Yield a MagicMock — endpoints sólo se llaman si pasan el scope
        yield MagicMock()

    app.dependency_overrides[current_user] = fake_user
    app.dependency_overrides[db_session] = fake_db
    return app


class TestDigestEndpointsScope:
    def test_preview_viewer_forbidden(self) -> None:
        app = _build_app_with_user("viewer")
        client = TestClient(app)
        # Auth header bypass via dependency override, but still need bearer
        # for the inner current_user call path; override hits first.
        resp = client.get(
            "/digest/ceo-weekly/preview",
            headers={"Authorization": "Bearer fake"},
        )
        assert resp.status_code == 403

    def test_preview_finance_forbidden(self) -> None:
        app = _build_app_with_user("finance")
        client = TestClient(app)
        resp = client.get(
            "/digest/ceo-weekly/preview",
            headers={"Authorization": "Bearer fake"},
        )
        assert resp.status_code == 403

    def test_send_now_503_when_resend_disabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Admin con resend_api_key=None → 503."""
        from app.core.config import settings

        monkeypatch.setattr(settings, "resend_api_key", None, raising=False)
        app = _build_app_with_user("admin")
        client = TestClient(app)
        resp = client.post(
            "/digest/ceo-weekly/send-now",
            headers={"Authorization": "Bearer fake"},
            json={"recipients": ["x@y.cl"]},
        )
        assert resp.status_code == 503
        assert "Resend" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Aggregation contract — verifica el shape del payload con DB fake
# ---------------------------------------------------------------------------


class _FakeRow:
    def __init__(self, d: dict[str, Any]) -> None:
        self._d = d

    def __getitem__(self, k: str) -> Any:
        return self._d[k]

    def get(self, k: str, default: Any = None) -> Any:
        return self._d.get(k, default)


class _FakeMappingResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def all(self) -> list[_FakeRow]:
        return [_FakeRow(r) for r in self._rows]


class _FakeResult:
    def __init__(self, rows: list[dict[str, Any]] | None = None,
                 scalar: Any = None) -> None:
        self._rows = rows or []
        self._scalar = scalar

    def mappings(self) -> _FakeMappingResult:
        return _FakeMappingResult(self._rows)

    def fetchone(self) -> tuple[Any, ...] | None:
        if self._scalar is not None:
            return self._scalar
        return None


class TestAggregationContract:
    @pytest.mark.asyncio
    async def test_kpi_aggregation_sums_across_empresas(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """build_ceo_weekly_digest suma saldos/flujos/oc/f29 de las empresas."""
        empresas_kpis = [
            {
                "codigo": "ACME",
                "razon_social": "Acme",
                "saldo_actual": Decimal("100000000"),
                "flujo_7d": Decimal("2000000"),
                "oc_pendientes": 3,
                "f29_vencidas": 0,
                "f29_proximas_week": 0,
            },
            {
                "codigo": "BETA",
                "razon_social": "Beta",
                "saldo_actual": Decimal("50000000"),
                "flujo_7d": Decimal("-1000000"),
                "oc_pendientes": 5,
                "f29_vencidas": 2,
                "f29_proximas_week": 1,
            },
        ]

        db = MagicMock()
        svc = DigestService(db)

        async def fake_empresas(period_from: date) -> list[dict[str, Any]]:
            return empresas_kpis

        async def fake_prev(period_from_prev: date) -> dict[str, int]:
            return {"ACME": 80, "BETA": 60}

        async def fake_alerts(today: date) -> list[DigestAlert]:
            return []

        async def fake_movs(p1: date, p2: date) -> list[MovimientoDigestRow]:
            return []

        async def fake_vs_prev(p1: date, p2: date) -> dict[str, Any]:
            return {"flujo_delta": 100}

        monkeypatch.setattr(svc, "_fetch_empresas_kpis", fake_empresas)
        monkeypatch.setattr(svc, "_fetch_empresas_health_prev", fake_prev)
        monkeypatch.setattr(svc, "_build_alerts", fake_alerts)
        monkeypatch.setattr(svc, "_fetch_movimientos_significativos", fake_movs)
        monkeypatch.setattr(svc, "_fetch_vs_prev_week", fake_vs_prev)

        payload = await svc.build_ceo_weekly_digest()

        assert payload.top_kpis["n_empresas"] == 2
        assert payload.top_kpis["total_saldo"] == 150_000_000.0
        assert payload.top_kpis["total_flujo_7d"] == 1_000_000.0
        assert payload.top_kpis["total_oc_pendientes"] == 8
        assert payload.top_kpis["total_f29_vencidas"] == 2
        assert len(payload.empresas) == 2
        assert payload.empresas[0].codigo == "ACME"
        assert payload.vs_prev_week == {"flujo_delta": 100}

    @pytest.mark.asyncio
    async def test_alerts_are_sorted_critical_first(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db = MagicMock()
        svc = DigestService(db)

        async def fake_empresas(period_from: date) -> list[dict[str, Any]]:
            return []

        async def fake_prev(period_from_prev: date) -> dict[str, int]:
            return {}

        async def fake_alerts(today: date) -> list[DigestAlert]:
            return [
                DigestAlert(
                    tipo="oc_estancada",
                    severity="warning",
                    title="W",
                    body="b",
                ),
                DigestAlert(
                    tipo="f29_vencida",
                    severity="critical",
                    title="C",
                    body="b",
                ),
            ]

        async def fake_movs(p1: date, p2: date) -> list[MovimientoDigestRow]:
            return []

        async def fake_vs_prev(p1: date, p2: date) -> dict[str, Any]:
            return {}

        monkeypatch.setattr(svc, "_fetch_empresas_kpis", fake_empresas)
        monkeypatch.setattr(svc, "_fetch_empresas_health_prev", fake_prev)
        monkeypatch.setattr(svc, "_build_alerts", fake_alerts)
        monkeypatch.setattr(svc, "_fetch_movimientos_significativos", fake_movs)
        monkeypatch.setattr(svc, "_fetch_vs_prev_week", fake_vs_prev)

        payload = await svc.build_ceo_weekly_digest()
        assert payload.alerts[0].severity == "critical"
        assert payload.alerts[1].severity == "warning"
