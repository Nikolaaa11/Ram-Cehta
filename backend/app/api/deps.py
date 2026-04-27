from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
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
