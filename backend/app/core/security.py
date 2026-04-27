from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
from jose import JWTError, jwt

from app.core.config import settings
from app.core.rbac import scopes_for


class InvalidTokenError(Exception):
    """Raised when the Supabase JWT fails verification."""


# JWKS cache. Supabase's new asymmetric signing keys are exposed at
# {SUPABASE_URL}/auth/v1/.well-known/jwks.json. Cache for 1h to avoid
# hammering Supabase on every request.
_jwks_cache: dict[str, Any] | None = None
_jwks_cache_at: float = 0.0
_JWKS_TTL_SECONDS = 3600


def _fetch_jwks() -> dict[str, Any]:
    """Fetch + cache Supabase JWKS (JSON Web Key Set)."""
    global _jwks_cache, _jwks_cache_at
    now = time.time()
    if _jwks_cache is not None and (now - _jwks_cache_at) < _JWKS_TTL_SECONDS:
        return _jwks_cache
    url = f"{str(settings.supabase_url).rstrip('/')}/auth/v1/.well-known/jwks.json"
    try:
        resp = httpx.get(url, timeout=5.0)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_cache_at = now
        return _jwks_cache
    except Exception as exc:  # noqa: BLE001
        raise InvalidTokenError(f"No se pudo obtener JWKS de Supabase: {exc}") from exc


def _key_for_token(token: str) -> tuple[Any, str]:
    """Returns (key, alg) tuple. For HS256 returns the JWT secret;
    for asymmetric algs (ES256/RS256) returns the JWK matching the
    `kid` from the token header."""
    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "HS256")

    if alg == "HS256":
        return (settings.supabase_jwt_secret, "HS256")

    # Asymmetric: ES256, RS256, EdDSA, etc. Fetch JWKS and find the key.
    if alg not in {"ES256", "RS256", "ES384", "RS384", "ES512", "RS512", "EdDSA"}:
        raise InvalidTokenError(f"Algoritmo no soportado: {alg}")

    kid = header.get("kid")
    if not kid:
        raise InvalidTokenError("Token sin claim 'kid' — no se puede resolver clave")

    jwks = _fetch_jwks()
    matching = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if not matching:
        # Bust cache and retry once — clave puede haber rotado
        global _jwks_cache, _jwks_cache_at
        _jwks_cache = None
        _jwks_cache_at = 0.0
        jwks = _fetch_jwks()
        matching = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
        if not matching:
            raise InvalidTokenError(f"Clave kid={kid} no encontrada en JWKS")

    return (matching, alg)


@dataclass(frozen=True)
class AuthenticatedUser:
    sub: str
    email: str | None
    app_role: str
    raw_claims: dict[str, Any]

    @property
    def is_admin(self) -> bool:
        return self.app_role == "admin"

    def has_scope(self, scope: str) -> bool:
        """Delega en `app.core.rbac.scopes_for` — única fuente de verdad."""
        return scope in scopes_for(self.app_role)


def _expected_issuer() -> str:
    """Issuer canónico del proyecto Supabase (para validar el claim `iss`)."""
    return f"{str(settings.supabase_url).rstrip('/')}/auth/v1"


def decode_supabase_jwt(token: str) -> AuthenticatedUser:
    try:
        key, alg = _key_for_token(token)
        claims = jwt.decode(
            token,
            key,
            algorithms=[alg],
            audience="authenticated",
            issuer=_expected_issuer(),
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
    except JWTError as exc:
        raise InvalidTokenError(str(exc)) from exc

    app_role = claims.get("app_role") or claims.get("app_metadata", {}).get("app_role") or "viewer"

    return AuthenticatedUser(
        sub=claims["sub"],
        email=claims.get("email"),
        app_role=app_role,
        raw_claims=claims,
    )
