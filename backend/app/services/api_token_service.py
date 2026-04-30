"""Service para Public API tokens.

Tokens prefix `cak_` (Cehta API Key). Formato:
    cak_<32 chars url-safe random>

Almacenamos solo SHA-256 hex del token — el plaintext nunca toca DB
después de la creación. La verificación es:
  1. Hash el token entrante.
  2. SELECT WHERE token_hash = :hash AND revoked_at IS NULL AND
     (expires_at IS NULL OR expires_at > now()).
  3. Si match: actualizar `last_used_at = now()` (best-effort, no bloqueante)
     y devolver el AuthenticatedUser correspondiente al `created_by`.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime
from uuid import uuid4

import structlog
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import AuthenticatedUser

log = structlog.get_logger(__name__)

TOKEN_PREFIX = "cak_"


def generate_token() -> str:
    """`cak_<43 chars>` — base64url de 32 bytes ≈ 43 chars."""
    return f"{TOKEN_PREFIX}{secrets.token_urlsafe(32)}"


def hash_token(token: str) -> str:
    """SHA-256 hex. Idempotente, deterministic — mismo token siempre hash."""
    return hashlib.sha256(token.encode()).hexdigest()


def token_hint(token: str) -> str:
    """Primeros 12 chars + ellipsis para identificar el token visualmente
    en la UI sin exponer el full secret."""
    return f"{token[:12]}…"


async def create_token(
    db: AsyncSession,
    *,
    name: str,
    description: str | None,
    created_by: str,
    expires_at: datetime | None = None,
) -> tuple[str, dict]:
    """Crea un token nuevo. Devuelve `(raw_token, db_row_dict)`.

    El raw_token se le muestra al user UNA sola vez — no se vuelve a
    poder recuperar.
    """
    raw = generate_token()
    h = hash_token(raw)
    token_id = uuid4()
    await db.execute(
        text(
            """
            INSERT INTO app.api_tokens
                (id, name, description, token_hash, created_by, expires_at)
            VALUES (:id, :name, :desc, :hash, :uid, :exp)
            """
        ),
        {
            "id": str(token_id),
            "name": name,
            "desc": description,
            "hash": h,
            "uid": created_by,
            "exp": expires_at,
        },
    )
    await db.commit()

    row = (
        await db.execute(
            text(
                "SELECT id, name, description, created_by, last_used_at, "
                "expires_at, revoked_at, created_at "
                "FROM app.api_tokens WHERE id = :id"
            ),
            {"id": str(token_id)},
        )
    ).mappings().one()
    return raw, dict(row)


async def verify_token(db: AsyncSession, token: str) -> AuthenticatedUser:
    """Valida un token y devuelve el `AuthenticatedUser` que representa.

    Lookup criteria:
      - hash matches
      - not revoked
      - not expired

    Side-effect: actualiza `last_used_at` para auditoría. Best-effort:
    si el UPDATE falla, no bloqueamos al user — el lookup principal ya
    autorizó.
    """
    if not token.startswith(TOKEN_PREFIX):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API token format",
            headers={"WWW-Authenticate": "Bearer"},
        )

    h = hash_token(token)
    row = (
        await db.execute(
            text(
                """
                SELECT t.id, t.created_by, t.expires_at, t.revoked_at,
                       ur.app_role
                FROM app.api_tokens t
                LEFT JOIN core.user_roles ur ON ur.user_id = t.created_by
                WHERE t.token_hash = :hash
                """
            ),
            {"hash": h},
        )
    ).first()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token_id, created_by, expires_at, revoked_at, app_role = row

    if revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API token revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if expires_at is not None and expires_at < datetime.now(UTC):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API token expired",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Best-effort update of last_used_at — no await failure blocks auth
    try:
        await db.execute(
            text("UPDATE app.api_tokens SET last_used_at = now() WHERE id = :id"),
            {"id": str(token_id)},
        )
        await db.commit()
    except Exception as exc:
        log.warning("api_token_last_used_update_failed", error=str(exc))

    # El token "actúa como" el user creador — hereda sus scopes vía role.
    # Si el user no tiene role asignado (raro), default a "viewer".
    role = app_role or "viewer"

    return AuthenticatedUser(
        sub=str(created_by),
        email=None,  # los tokens no tienen email
        app_role=role,
        raw_claims={"api_token_id": str(token_id), "api_token": True},
    )


async def revoke_token(db: AsyncSession, token_id: str) -> bool:
    """Marca el token como revocado. Devuelve True si efectivamente cambió."""
    res = await db.execute(
        text(
            "UPDATE app.api_tokens SET revoked_at = now() "
            "WHERE id = :id AND revoked_at IS NULL "
            "RETURNING id"
        ),
        {"id": token_id},
    )
    found = res.first() is not None
    if found:
        await db.commit()
    return found
