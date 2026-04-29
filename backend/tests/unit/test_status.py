"""Tests para los helpers de `app.api.v1.status`.

Foco en lógica pura: agregación de overall_state y checks pasivos por
presencia de secret. Los checks que tocan DB se prueban en integración.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.api.v1.status import (
    _check_secret_present,
    _overall_state,
)
from app.schemas.status import IntegrationCheck


def _check(name: str, state) -> IntegrationCheck:
    return IntegrationCheck(
        name=name,
        state=state,
        last_checked_at=datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------
# _overall_state
# ---------------------------------------------------------------------
class TestOverallState:
    def test_todos_ok_es_ok(self) -> None:
        checks = [_check("a", "ok"), _check("b", "ok")]
        assert _overall_state(checks) == "ok"

    def test_uno_degraded_baja_a_degraded(self) -> None:
        checks = [_check("a", "ok"), _check("b", "degraded")]
        assert _overall_state(checks) == "degraded"

    def test_uno_down_es_down_aunque_otros_ok(self) -> None:
        checks = [_check("a", "ok"), _check("b", "down"), _check("c", "ok")]
        assert _overall_state(checks) == "down"

    def test_disabled_no_afecta(self) -> None:
        # Disabled = api_key no configurada; eso no es un problema, es
        # configuración intencional. Si todo lo demás está ok → overall=ok.
        checks = [_check("a", "ok"), _check("b", "disabled")]
        assert _overall_state(checks) == "ok"

    def test_solo_disabled_es_ok(self) -> None:
        # Edge: si TODO está disabled, no hay nada que esté "mal" — ok.
        checks = [_check("a", "disabled"), _check("b", "disabled")]
        assert _overall_state(checks) == "ok"

    def test_unknown_es_peor_que_ok_pero_mejor_que_degraded(self) -> None:
        checks = [_check("a", "unknown")]
        assert _overall_state(checks) == "unknown"
        checks2 = [_check("a", "unknown"), _check("b", "degraded")]
        assert _overall_state(checks2) == "degraded"

    def test_lista_vacia_es_ok(self) -> None:
        assert _overall_state([]) == "ok"


# ---------------------------------------------------------------------
# _check_secret_present
# ---------------------------------------------------------------------
class TestCheckSecretPresent:
    def test_none_devuelve_disabled(self) -> None:
        c = _check_secret_present("Test", None)
        assert c.state == "disabled"
        assert c.name == "Test"

    def test_empty_string_devuelve_disabled(self) -> None:
        c = _check_secret_present("Test", "")
        assert c.state == "disabled"

    def test_valor_presente_devuelve_ok(self) -> None:
        c = _check_secret_present("Test", "sk-secret-1234")
        assert c.state == "ok"
        assert c.detail == "Configurada"

    def test_when_off_message_se_usa_si_disabled(self) -> None:
        c = _check_secret_present("X", None, when_off="Custom off message")
        assert c.detail == "Custom off message"

    def test_last_checked_at_es_reciente(self) -> None:
        c = _check_secret_present("X", "sk-key")
        # Debe estar a < 5 segundos de "ahora"
        delta = (datetime.now(timezone.utc) - c.last_checked_at).total_seconds()
        assert -1 < delta < 5
