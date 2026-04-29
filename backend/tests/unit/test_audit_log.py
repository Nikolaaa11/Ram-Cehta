"""Unit tests para `app.services.audit_service` (V3 fase 8).

Cubre el algoritmo de diff, la redacción de secretos y la garantía de
que `audit_log()` NO raisea cuando la inserción falla (mutaciones nunca
deben romperse por fallas del audit).
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.audit_service import (
    _REDACT_KEYS,
    _REDACTED,
    _client_ip,
    _compute_diff,
    _redact,
    _user_agent,
    audit_log,
)

# ---------------------------------------------------------------------------
# _compute_diff
# ---------------------------------------------------------------------------


def test_compute_diff_only_changed_keys_are_kept() -> None:
    before = {"a": 1, "b": 2, "c": 3}
    after = {"a": 1, "b": 99, "c": 3}
    diff_before, diff_after = _compute_diff(before, after)
    assert diff_before == {"b": 2}
    assert diff_after == {"b": 99}


def test_compute_diff_only_added_keys() -> None:
    before = {"a": 1}
    after = {"a": 1, "b": 2}
    diff_before, diff_after = _compute_diff(before, after)
    assert diff_before == {}
    assert diff_after == {"b": 2}


def test_compute_diff_only_removed_keys() -> None:
    before = {"a": 1, "b": 2}
    after = {"a": 1}
    diff_before, diff_after = _compute_diff(before, after)
    assert diff_before == {"b": 2}
    assert diff_after == {}


def test_compute_diff_mixed_added_removed_changed() -> None:
    before = {"a": 1, "b": 2, "c": 3}
    after = {"a": 1, "b": 22, "d": 4}
    diff_before, diff_after = _compute_diff(before, after)
    # 'a' equal — excluded
    assert "a" not in diff_before and "a" not in diff_after
    # 'b' changed
    assert diff_before["b"] == 2
    assert diff_after["b"] == 22
    # 'c' removed
    assert diff_before["c"] == 3
    assert "c" not in diff_after
    # 'd' added
    assert "d" not in diff_before
    assert diff_after["d"] == 4


def test_compute_diff_no_change_returns_empty() -> None:
    before = {"a": 1, "b": 2}
    after = {"a": 1, "b": 2}
    diff_before, diff_after = _compute_diff(before, after)
    assert diff_before == {}
    assert diff_after == {}


def test_compute_diff_with_nested_dict_treats_as_value() -> None:
    """Nested dicts se comparan con `==`. Si difieren, ambos lados se guardan
    completos en sus respectivos diffs (no hacemos diff recursivo en niveles
    profundos — lo simple es suficiente para mostrar en UI)."""
    before = {"meta": {"x": 1, "y": 2}, "name": "a"}
    after = {"meta": {"x": 1, "y": 99}, "name": "a"}
    diff_before, diff_after = _compute_diff(before, after)
    assert "name" not in diff_before
    assert diff_before["meta"] == {"x": 1, "y": 2}
    assert diff_after["meta"] == {"x": 1, "y": 99}


def test_compute_diff_handles_none_inputs() -> None:
    diff_before, diff_after = _compute_diff(None, {"a": 1})
    assert diff_before == {}
    assert diff_after == {"a": 1}

    diff_before, diff_after = _compute_diff({"a": 1}, None)
    assert diff_before == {"a": 1}
    assert diff_after == {}

    diff_before, diff_after = _compute_diff(None, None)
    assert diff_before == {}
    assert diff_after == {}


# ---------------------------------------------------------------------------
# Redaction
# ---------------------------------------------------------------------------


def test_redact_replaces_sensitive_keys() -> None:
    src = {"email": "x@y.cl", "password": "supersecret", "name": "ok"}
    out = _redact(src)
    assert out["email"] == "x@y.cl"
    assert out["password"] == _REDACTED
    assert out["name"] == "ok"


def test_redact_handles_all_secret_keys() -> None:
    src = {key: "value" for key in _REDACT_KEYS}
    out = _redact(src)
    for key in _REDACT_KEYS:
        assert out[key] == _REDACTED, f"Clave {key} no fue redactada"


def test_redact_recurses_into_nested_dicts() -> None:
    src = {
        "config": {
            "api_key": "abc123",
            "host": "example.com",
        },
    }
    out = _redact(src)
    assert out["config"]["api_key"] == _REDACTED
    assert out["config"]["host"] == "example.com"


def test_redact_in_compute_diff_applies_to_changed_secrets() -> None:
    before = {"name": "a", "password": "old-pw"}
    after = {"name": "b", "password": "new-pw"}
    diff_before, diff_after = _compute_diff(before, after)
    assert diff_before["password"] == _REDACTED
    assert diff_after["password"] == _REDACTED
    assert diff_before["name"] == "a"
    assert diff_after["name"] == "b"


def test_redact_dropbox_tokens() -> None:
    src = {
        "dropbox_access_token": "sl.xyz",
        "dropbox_refresh_token": "rfr.abc",
        "other": "ok",
    }
    out = _redact(src)
    assert out["dropbox_access_token"] == _REDACTED
    assert out["dropbox_refresh_token"] == _REDACTED
    assert out["other"] == "ok"


# ---------------------------------------------------------------------------
# Request helpers
# ---------------------------------------------------------------------------


def test_client_ip_handles_none_request() -> None:
    assert _client_ip(None) is None


def test_client_ip_extracts_host() -> None:
    request = MagicMock()
    request.client.host = "1.2.3.4"
    assert _client_ip(request) == "1.2.3.4"


def test_user_agent_truncates_to_512() -> None:
    request = MagicMock()
    long_ua = "x" * 1000
    request.headers.get.return_value = long_ua
    out = _user_agent(request)
    assert out is not None
    assert len(out) == 512


def test_user_agent_handles_empty_header() -> None:
    request = MagicMock()
    request.headers.get.return_value = ""
    assert _user_agent(request) is None


def test_user_agent_handles_none_request() -> None:
    assert _user_agent(None) is None


# ---------------------------------------------------------------------------
# audit_log() — never raises
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_audit_log_swallows_db_errors() -> None:
    """Si `db.execute` rompe, audit_log NO debe propagar el error."""
    db = MagicMock()
    db.execute = AsyncMock(side_effect=RuntimeError("DB down"))
    db.commit = AsyncMock()
    db.rollback = AsyncMock()

    request = MagicMock()
    request.client.host = "127.0.0.1"
    request.headers.get.return_value = "pytest"

    user = MagicMock()
    user.sub = "user-uuid"
    user.email = "x@y.cl"

    # Si esto raisea, el test falla automáticamente
    result = await audit_log(
        db,
        request,
        user,
        action="update",
        entity_type="oc",
        entity_id="123",
        summary="test",
        before={"a": 1},
        after={"a": 2},
    )
    assert result is None
    # rollback debería ser intentado para no dejar la sesión tóxica
    db.rollback.assert_awaited()


@pytest.mark.asyncio
async def test_audit_log_swallows_serialization_errors() -> None:
    """Datos no serializables tampoco deben romper. El service serializa con
    `default=str`, pero si por algún motivo falla el insert (p. ej. tabla
    no existe en un test ambiente raro) debe loguear y seguir."""
    db = MagicMock()
    db.execute = AsyncMock(side_effect=Exception("relation does not exist"))
    db.commit = AsyncMock()
    db.rollback = AsyncMock()

    user = MagicMock()
    user.sub = "uid"
    user.email = "u@x.cl"

    out = await audit_log(
        db,
        None,  # sin request
        user,
        action="create",
        entity_type="x",
        entity_id="1",
        summary="ok",
    )
    assert out is None


@pytest.mark.asyncio
async def test_audit_log_no_diff_when_inputs_equal() -> None:
    """Si before == after, el insert se hace con diff_before/diff_after NULL.
    Verificamos que se llamó a execute exactamente 1 vez con esos None."""
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()

    user = MagicMock()
    user.sub = "uid"
    user.email = "u@x.cl"

    await audit_log(
        db,
        None,
        user,
        action="update",
        entity_type="x",
        entity_id="1",
        summary="no-op",
        before={"a": 1},
        after={"a": 1},
    )
    assert db.execute.await_count == 1
    # extraer kwargs del call: el segundo arg posicional es el dict de params
    call_args = db.execute.await_args
    params = call_args.args[1]
    assert params["diff_before"] is None
    assert params["diff_after"] is None


@pytest.mark.asyncio
async def test_audit_log_includes_ip_and_ua_when_request_provided() -> None:
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()

    user = MagicMock()
    user.sub = "uid"
    user.email = "u@x.cl"

    request = MagicMock()
    request.client.host = "10.0.0.5"
    request.headers.get.return_value = "Mozilla/5.0 test"

    await audit_log(
        db,
        request,
        user,
        action="create",
        entity_type="oc",
        entity_id="42",
        summary="OC creada",
        after={"x": 1},
    )
    call_args = db.execute.await_args
    params = call_args.args[1]
    assert params["ip"] == "10.0.0.5"
    assert params["user_agent"] == "Mozilla/5.0 test"
    assert params["user_id"] == "uid"
    assert params["user_email"] == "u@x.cl"


@pytest.mark.asyncio
async def test_audit_log_handles_no_user() -> None:
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()

    await audit_log(
        db,
        None,
        None,  # sin user (sistema)
        action="sync",
        entity_type="f29_batch",
        entity_id="TRONGKAI",
        summary="sync system",
    )
    call_args = db.execute.await_args
    params = call_args.args[1]
    assert params["user_id"] is None
    assert params["user_email"] is None
