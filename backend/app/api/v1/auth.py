"""Auth endpoints: /me y gestión de roles de usuario."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.rbac import scopes_for
from app.core.security import AuthenticatedUser

router = APIRouter()


class UserMeResponse(BaseModel):
    sub: str
    email: str | None
    app_role: str
    allowed_actions: list[str]


class UserRoleItem(BaseModel):
    user_id: str
    app_role: str


class SetRoleRequest(BaseModel):
    app_role: str


def _allowed_actions(user: AuthenticatedUser) -> list[str]:
    """Deriva la lista de acciones permitidas desde la matriz canónica RBAC.

    El frontend consume este array para decidir qué botones mostrar
    (Disciplina 3). Mantenemos el formato `list[str]` para compat con clientes
    existentes; el contenido viene 1:1 de `app.core.rbac.ROLE_SCOPES`.
    """
    return sorted(scopes_for(user.app_role))


@router.get("/me", response_model=UserMeResponse)
async def get_me(user: CurrentUser) -> UserMeResponse:
    return UserMeResponse(
        sub=user.sub,
        email=user.email,
        app_role=user.app_role,
        allowed_actions=_allowed_actions(user),
    )


@router.get("/users", response_model=list[UserRoleItem])
async def list_users(
    user: Annotated[AuthenticatedUser, Depends(require_scope("user:read"))],
    db: DBSession,
) -> list[UserRoleItem]:
    result = await db.execute(
        text("SELECT user_id::text, app_role FROM core.user_roles ORDER BY created_at")
    )
    return [UserRoleItem(user_id=r[0], app_role=r[1]) for r in result.fetchall()]


@router.post("/users/{user_id}/role", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def set_user_role(
    user_id: str,
    body: SetRoleRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("user:write"))],
    db: DBSession,
) -> Response:
    if body.app_role not in ("admin", "finance", "viewer"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Rol inválido. Valores permitidos: admin, finance, viewer",
        )

    await db.execute(
        text("""
            INSERT INTO core.user_roles (user_id, app_role, assigned_by)
            VALUES (:uid, :role, :by)
            ON CONFLICT (user_id) DO UPDATE
                SET app_role = EXCLUDED.app_role,
                    assigned_by = EXCLUDED.assigned_by,
                    updated_at = now()
        """),
        {"uid": user_id, "role": body.app_role, "by": user.sub},
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
