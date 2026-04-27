from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from jose import JWTError, jwt

from app.core.config import settings
from app.core.rbac import scopes_for


class InvalidTokenError(Exception):
    """Raised when the Supabase JWT fails verification."""


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
        claims = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
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
