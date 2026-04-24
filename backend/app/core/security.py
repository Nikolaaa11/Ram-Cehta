from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from jose import JWTError, jwt

from app.core.config import settings


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
        # Placeholder; scopes finos se modelan en Fase 2.2.
        role_scopes = {
            "admin": {"oc:read", "oc:approve", "oc:cancel", "oc:mark_paid"},
            "finance": {"oc:read", "oc:approve", "oc:mark_paid"},
            "viewer": {"oc:read"},
        }
        return scope in role_scopes.get(self.app_role, set())


def decode_supabase_jwt(token: str) -> AuthenticatedUser:
    try:
        claims = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
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
