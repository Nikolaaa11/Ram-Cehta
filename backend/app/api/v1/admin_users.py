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

from sqlalchemy import text

from app.api.deps import DBSession, current_admin_with_2fa, require_scope
from app.core.logging import get_logger
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.user_role_repository import UserRoleRepository
from app.schemas.admin_user import (
    UserRoleAssignRequest,
    UserRoleRead,
    UserRoleUpdateRequest,
)

log = get_logger(__name__)


async def _revoke_user_api_tokens(db, user_id: str, reason: str) -> int:
    """R152AAAAAA — Revoca todos los API tokens activos creados por un user.

    Llamar cuando el role del user cambia (downgrade) o se elimina su
    user_role. Sin esto, un ex-admin con un token `cak_xxx` puede seguir
    haciendo llamadas mientras la persona ya no es admin.

    Soft-fail: si la tabla `app.api_tokens` no existe (migración pendiente),
    loggea warning y sigue. Devuelve cantidad de tokens revocados.
    """
    try:
        result = await db.execute(
            text(
                """UPDATE app.api_tokens
                   SET revoked_at = NOW()
                   WHERE created_by = :uid AND revoked_at IS NULL
                   RETURNING id"""
            ),
            {"uid": user_id},
        )
        revoked = result.fetchall()
        count = len(revoked)
        if count > 0:
            log.info(
                "api_tokens.revoked_on_role_change",
                user_id=user_id,
                count=count,
                reason=reason,
            )
        return count
    except Exception as exc:
        log.warning(
            "api_tokens.revoke_failed",
            user_id=user_id,
            reason=reason,
            error=str(exc),
        )
        return 0

router = APIRouter()


@router.get("/users", response_model=list[UserRoleRead])
async def list_users(
    user: Annotated[AuthenticatedUser, Depends(require_scope("user:read"))],
    db: DBSession,
) -> list[UserRoleRead]:
    repo = UserRoleRepository(db)
    return await repo.list_with_emails()


@router.post(
    "/users",
    response_model=UserRoleRead,
    status_code=status.HTTP_201_CREATED,
    # V4 fase 2: high-impact endpoint — si es admin, exige 2FA activo
    # (gate soft-rollout, ignorado para non-admin).
    dependencies=[Depends(current_admin_with_2fa)],
)
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


@router.patch(
    "/users/{user_id}/role",
    response_model=UserRoleRead,
    # V4 fase 2: high-impact endpoint — si es admin, exige 2FA activo.
    dependencies=[Depends(current_admin_with_2fa)],
)
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

    # R152AAAAAA — Si el role cambia (especialmente downgrade desde admin),
    # revocar todos los API tokens activos creados por este user. Sin esto,
    # un ex-admin con cak_xxx token podía seguir operando como admin
    # incluso después del downgrade.
    role_changed = existing.app_role != body.app_role
    # R152YYYYYY — proteccion del ultimo admin: degradar al unico admin
    # (incluido uno mismo) dejaba la plataforma sin administradores, con
    # recuperacion solo por SQL directo en Supabase Studio.
    if role_changed and existing.app_role == "admin":
        _admins = await db.scalar(
            text(
                "SELECT COUNT(*) FROM core.user_roles WHERE app_role = 'admin'"
            )
        )
        if int(_admins or 0) <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "No se puede cambiar el rol del ultimo admin de la "
                    "plataforma. Nombra otro admin primero."
                ),
            )
    if role_changed:
        await _revoke_user_api_tokens(
            db,
            user_id,
            reason=f"role_change:{existing.app_role}->{body.app_role}",
        )

    result = await repo.upsert(user_id, body.app_role, assigned_by=user.sub)
    await db.commit()
    return result


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    # V4 fase 2: high-impact endpoint — si es admin, exige 2FA activo.
    dependencies=[Depends(current_admin_with_2fa)],
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
    # R152AAAAAA — Revocar tokens ANTES del delete del user_role. Si el
    # delete falla, queremos que los tokens igual queden revocados
    # (el role downgrade implícito de DELETE = downgrade a viewer default).
    await _revoke_user_api_tokens(db, user_id, reason="user_deleted")

    deleted = await repo.delete(user_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Usuario {user_id} no encontrado",
        )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
