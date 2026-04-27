from __future__ import annotations

from typing import Any

import pytest

from app.core import observability
from app.core.observability import _redact_pii, _scrub, init_sentry


def test_init_sentry_without_dsn_returns_false(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sin SENTRY_DSN no debe iniciar nada ni romper. Retorna False."""
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert init_sentry() is False


def test_init_sentry_with_dsn_returns_true(monkeypatch: pytest.MonkeyPatch) -> None:
    """Con DSN dummy debe inicializar y retornar True. No debe hacer requests reales."""
    monkeypatch.setenv("SENTRY_DSN", "https://public@o0.ingest.sentry.io/0")

    captured: dict[str, Any] = {}

    def fake_init(**kwargs: Any) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(observability.sentry_sdk, "init", fake_init)

    assert init_sentry() is True
    assert captured["dsn"] == "https://public@o0.ingest.sentry.io/0"
    assert captured["send_default_pii"] is False
    assert captured["profiles_sample_rate"] == 0.0
    assert callable(captured["before_send"])


def test_scrub_redacts_sensitive_keys() -> None:
    payload = {
        "rut": "11.111.111-1",
        "numero_cuenta": "0123456789",
        "password": "hunter2",
        "Authorization": "Bearer secret-token",
        "cookie": "session=abc",
        "user_id": 42,
        "nested": {"token": "t", "name": "ok"},
        "list_of_dicts": [{"api_key": "x", "ok": 1}],
    }
    scrubbed = _scrub(payload)
    assert scrubbed["rut"] == "[REDACTED]"
    assert scrubbed["numero_cuenta"] == "[REDACTED]"
    assert scrubbed["password"] == "[REDACTED]"
    assert scrubbed["Authorization"] == "[REDACTED]"
    assert scrubbed["cookie"] == "[REDACTED]"
    assert scrubbed["user_id"] == 42
    assert scrubbed["nested"]["token"] == "[REDACTED]"
    assert scrubbed["nested"]["name"] == "ok"
    assert scrubbed["list_of_dicts"][0]["api_key"] == "[REDACTED]"
    assert scrubbed["list_of_dicts"][0]["ok"] == 1


def test_scrub_passthrough_non_container_values() -> None:
    assert _scrub("hello") == "hello"
    assert _scrub(42) == 42
    assert _scrub(None) is None


def test_redact_pii_redacts_request_headers_and_extra() -> None:
    event = {
        "request": {
            "headers": {
                "Authorization": "Bearer token",
                "X-Api-Key": "key",
                "User-Agent": "pytest",
            },
            "cookies": {"session": "abc"},
            "data": {"rut": "11.111.111-1", "amount": 1000},
            "query_string": {"token": "x", "page": "1"},
        },
        "extra": {"password": "p", "context": "ok"},
    }
    out = _redact_pii(event, {})
    assert out is not None
    assert out["request"]["headers"]["Authorization"] == "[REDACTED]"
    assert out["request"]["headers"]["X-Api-Key"] == "[REDACTED]"
    assert out["request"]["headers"]["User-Agent"] == "pytest"
    assert out["request"]["cookies"]["session"] == "[REDACTED]"
    assert out["request"]["data"]["rut"] == "[REDACTED]"
    assert out["request"]["data"]["amount"] == 1000
    assert out["request"]["query_string"]["token"] == "[REDACTED]"
    assert out["request"]["query_string"]["page"] == "1"
    assert out["extra"]["password"] == "[REDACTED]"
    assert out["extra"]["context"] == "ok"


def test_redact_pii_handles_missing_keys() -> None:
    """No debe romper con eventos vacíos o sin request/extra."""
    assert _redact_pii({}, {}) == {}
    assert _redact_pii({"message": "x"}, {}) == {"message": "x"}
