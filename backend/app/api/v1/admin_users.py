"""Administración de usuarios — admin only.

Endpoints:
- GET    /admin/users              listar (con email vía JOIN auth.users)
- POST   /admin/users               asignar rol por email (404 si no existe)
- PATCH  /admin/users/{user_id}/role  actualizar rol
- DELETE /admin/users/{user_id}     remover acceso (no permite auto-borrarse)

Diseño: usamos `core.user_roles` como tabla de mapeo rol-aplicación. La
identidad vive en `auth.users` (Supabase). Si un email no existe ahí,
respondemos 404 indicando que primero hay que crear la cuenta en el
Dashboard de Supabase (no creamos usuarios desde acá: política).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response

from app.api.deps import DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.user_role_repository import UserRoleRepository
from app.schemas.admin_user import (
    UserRoleAssignRequest,
    UserRoleRead,
    UserRoleUpdateRequest,
)

router = APIRouter()


@router.get("/users", response_model=list[UserRoleRead])
async def list_users(
    user: Annotated[AuthenticatedUser, Depends(require_scope("user:read"))],
    db: DBSession,
) -> list[UserRoleRead]:
    repo = UserRoleRepository(db)
    return await repo.list_with_emails()


@router.post("/users", response_model=UserRoleRead, status_code=status.HTTP_201_CREATED)
async def assign_user(
    body: UserRoleAssignRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("user:write"))],
    db: DBSession,
) -> UserRoleRead:
    repo = UserRoleRepository(db)
    user_id = await repo.get_user_id_by_email(body.email)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No existe usuario con email {body.email} en auth.users. "
                "Crear la cuenta primero en Supabase Dashboard."
            ),
        )
    result = await repo.upsert(user_id, body.app_role, assigned_by=user.sub)
    await db.commit()
    return result


@router.patch("/users/{user_id}/role", response_model=UserRoleRead)
async def update_role(
    user_id: str,
    body: UserRoleUpdateRequest,
    user: Annotated[AuthenticatedUser, Depends(require_scope("user:write"))],
    db: DBSession,
) -> UserRoleRead:
    repo = UserRoleRepository(db)
    existing = await repo.get_role(user_id)
    if existing is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Usuario {user_id} no tiene rol asignado",
        )
    result = await repo.upsert(user_id, body.app_role, assigned_by=user.sub)
    await db.commit()
    return result


@router.delete(
    "/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response
)
async def remove_user(
    user_id: str,
    user: Annotated[AuthenticatedUser, Depends(require_scope("user:delete"))],
    db: DBSession,
) -> Response:
    if user_id == user.sub:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No podés removerte a vos mismo (otro admin debe hacerlo)",
        )
    repo = UserRoleRepository(db)
    deleted = await repo.delete(user_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Usuario {user_id} no encontrado",
        )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
