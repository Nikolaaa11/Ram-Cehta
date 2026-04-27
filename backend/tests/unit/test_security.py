from __future__ import annotations

import time

import pytest
from jose import jwt

from app.core.security import AuthenticatedUser, InvalidTokenError, decode_supabase_jwt

SECRET = "test-secret"
ISSUER = "https://example.supabase.co/auth/v1"


def make_token(
    sub: str = "test-uid",
    role: str = "admin",
    secret: str = SECRET,
    expired: bool = False,
    include_role: bool = True,
    issuer: str = ISSUER,
) -> str:
    now = int(time.time())
    payload: dict = {
        "sub": sub,
        "email": f"{sub}@test.cl",
        "aud": "authenticated",
        "iss": issuer,
        "exp": now - 1 if expired else now + 3600,
    }
    if include_role:
        payload["app_role"] = role
    return jwt.encode(payload, secret, algorithm="HS256")


# ---------------------------------------------------------------------------
# decode_supabase_jwt — happy paths
# ---------------------------------------------------------------------------


def test_valid_token_returns_authenticated_user() -> None:
    token = make_token(sub="uid-abc", role="admin")
    user = decode_supabase_jwt(token)
    assert isinstance(user, AuthenticatedUser)
    assert user.sub == "uid-abc"
    assert user.email == "uid-abc@test.cl"
    assert user.app_role == "admin"


@pytest.mark.parametrize("role", ["admin", "finance", "viewer"])
def test_all_roles_decode_correctly(role: str) -> None:
    token = make_token(role=role)
    user = decode_supabase_jwt(token)
    assert user.app_role == role


def test_missing_app_role_defaults_to_viewer() -> None:
    token = make_token(include_role=False)
    user = decode_supabase_jwt(token)
    assert user.app_role == "viewer"


def test_raw_claims_present() -> None:
    token = make_token(sub="uid-x", role="finance")
    user = decode_supabase_jwt(token)
    assert user.raw_claims["sub"] == "uid-x"
    assert user.raw_claims["app_role"] == "finance"


# ---------------------------------------------------------------------------
# decode_supabase_jwt — error paths
# ---------------------------------------------------------------------------


def test_expired_token_raises_invalid_token_error() -> None:
    token = make_token(expired=True)
    with pytest.raises(InvalidTokenError):
        decode_supabase_jwt(token)


def test_wrong_secret_raises_invalid_token_error() -> None:
    token = make_token(secret="other-secret")
    with pytest.raises(InvalidTokenError):
        decode_supabase_jwt(token)


def test_malformed_token_raises_invalid_token_error() -> None:
    with pytest.raises(InvalidTokenError):
        decode_supabase_jwt("not.a.valid.token")


# ---------------------------------------------------------------------------
# AuthenticatedUser.has_scope
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("role", "scope", "expected"),
    [
        # OC scopes — preexistentes (Bloque A/B).
        ("admin", "oc:read", True),
        ("admin", "oc:approve", True),
        ("admin", "oc:cancel", True),
        ("admin", "oc:mark_paid", True),
        ("finance", "oc:read", True),
        ("finance", "oc:approve", True),
        ("finance", "oc:cancel", False),
        ("finance", "oc:mark_paid", True),
        ("viewer", "oc:read", True),
        ("viewer", "oc:approve", False),
        ("viewer", "oc:cancel", False),
        ("viewer", "oc:mark_paid", False),
        # Proveedor scopes — nuevos en Bloque C (rbac.py canónico).
        ("admin", "proveedor:create", True),
        ("admin", "proveedor:delete", True),
        ("finance", "proveedor:create", True),
        ("finance", "proveedor:delete", False),
        ("viewer", "proveedor:read", True),
        ("viewer", "proveedor:create", False),
        # F29 scopes — nuevos en Bloque C.
        ("admin", "f29:create", True),
        ("finance", "f29:update", True),
        ("viewer", "f29:create", False),
        # User admin — sólo admin escribe roles.
        ("admin", "user:write", True),
        ("finance", "user:write", False),
        ("viewer", "user:read", False),
        # Movimientos read — todos los roles.
        ("viewer", "movimiento:read", True),
        # Scope desconocido — siempre False.
        ("admin", "scope:inexistente", False),
    ],
)
def test_has_scope(role: str, scope: str, expected: bool) -> None:
    user = AuthenticatedUser(sub="u", email=None, app_role=role, raw_claims={})
    assert user.has_scope(scope) is expected


def test_has_scope_unknown_role_returns_false() -> None:
    user = AuthenticatedUser(sub="u", email=None, app_role="unknown", raw_claims={})
    assert user.has_scope("oc:read") is False


# ---------------------------------------------------------------------------
# AuthenticatedUser.is_admin
# ---------------------------------------------------------------------------


def test_is_admin_true_for_admin() -> None:
    user = AuthenticatedUser(sub="u", email=None, app_role="admin", raw_claims={})
    assert user.is_admin is True


@pytest.mark.parametrize("role", ["finance", "viewer", "unknown"])
def test_is_admin_false_for_non_admin(role: str) -> None:
    user = AuthenticatedUser(sub="u", email=None, app_role=role, raw_claims={})
    assert user.is_admin is False
