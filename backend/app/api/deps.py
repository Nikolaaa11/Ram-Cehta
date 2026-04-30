from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.security import AuthenticatedUser, InvalidTokenError, decode_supabase_jwt


async def db_session() -> AsyncIterator[AsyncSession]:
    async for session in get_session():
        yield session


def current_user(authorization: Annotated[str | None, Header()] = None) -> AuthenticatedUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.split(" ", 1)[1].strip()
    try:
        return decode_supabase_jwt(token)
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


CurrentUser = Annotated[AuthenticatedUser, Depends(current_user)]
DBSession = Annotated[AsyncSession, Depends(db_session)]


def require_scope(scope: str):
    """Factory de dependency que exige un scope concreto.

    Uso típico en endpoints:

        @router.post("")
        async def create_x(
            user: Annotated[AuthenticatedUser, Depends(require_scope("x:create"))],
            ...
        ):
            ...

    El scope se resuelve contra `app.core.rbac.ROLE_SCOPES` — única fuente de
    verdad. Devuelve el `AuthenticatedUser` para mantener la firma uniforme con
    `CurrentUser` (los handlers pueden seguir leyendo `user.sub`, etc.).
    """

    def _dep(user: CurrentUser) -> AuthenticatedUser:
        if not user.has_scope(scope):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Falta permiso: {scope}",
            )
        return user

    return _dep


async def current_admin_with_2fa(
    user: CurrentUser,
    db: DBSession,
) -> AuthenticatedUser:
    """Gate `2FA enabled` para admins en endpoints high-impact (V4 fase 2).

    Soft-rollout: solo se aplica a 4 endpoints específicos (crear user,
    enviar digest, crear webhook, eliminar webhook). El resto de la
    plataforma sigue accesible sin 2FA — los admins reciben un banner
    pidiéndoles que activen 2FA pero no quedan locked-out de inmediato.

    Reglas:
    - No-admin → pasa (auth normal).
    - Admin con `amr_2fa=true` en JWT → pasa (futuro: cuando Supabase
      empiece a emitir el claim después de challenge-response).
    - Admin con fila `app.user_2fa.enabled=true` → pasa.
    - Admin sin 2FA activo → 403 con `code='2fa_required'` para que el
      frontend redirija a `/2fa/setup`.
    """
    if user.app_role != "admin":
        return user

    # Future-proof: si Supabase agrega un claim "amr_2fa" en el JWT después
    # de un challenge MFA, lo respetamos sin tocar la tabla local.
    if user.raw_claims.get("amr_2fa") is True:
        return user

    enabled = await db.scalar(
        text(
            "SELECT enabled FROM app.user_2fa WHERE user_id = :uid"
        ),
        {"uid": user.sub},
    )
    if enabled is True:
        return user

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"detail": "2FA required for admin role", "code": "2fa_required"},
    )


CurrentAdminWith2FA = Annotated[AuthenticatedUser, Depends(current_admin_with_2fa)]
