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

import httpx

from app.api.deps import DBSession, current_admin_with_2fa, require_scope
from app.core.config import get_settings
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

NRIETTA_EMAIL = "nrietta@cehtacapital.com"


async def _ban_supabase_user(user_id: str, *, banned: bool) -> bool:
    """MEGAPROMPT F1a — Banea (o des-banea) la cuenta en Supabase Auth.

    Un ban_duration largo impide el login SIN borrar la cuenta ni el historial
    (reversible). Sin esto, "revocar acceso" solo quitaba el rol pero la
    persona seguía logueándose con su cuenta de Supabase. Soft-fail: si la
    llamada falla, loggea y devuelve False (el caller decide si abortar).
    """
    s = get_settings()
    base = str(s.supabase_url).rstrip("/")
    key = s.supabase_service_role_key
    ban_value = "876000h" if banned else "none"  # ~100 años / sin ban
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.put(
                f"{base}/auth/v1/admin/users/{user_id}",
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json={"ban_duration": ban_value},
            )
        if resp.status_code == 200:
            log.info("supabase.user_ban", user_id=user_id, banned=banned)
            return True
        log.warning(
            "supabase.user_ban_failed",
            user_id=user_id,
            status=resp.status_code,
            body=resp.text[:200],
        )
        return False
    except Exception as exc:  # noqa: BLE001
        log.warning("supabase.user_ban_error", user_id=user_id, error=str(exc))
        return False


async def _deactivate_company_roles(db, user_id: str) -> int:
    """MEGAPROMPT F1a — Desactiva TODOS los roles por empresa del user.

    active=FALSE en lugar de DELETE → preserva la trazabilidad de quién tuvo
    qué rol. get_allowed_empresa_codes solo cuenta active=TRUE, así que el
    usuario deja de ver cualquier empresa. Devuelve cuántas filas desactivó.
    """
    result = await db.execute(
        text(
            """UPDATE core.user_company_roles
               SET active = FALSE
               WHERE user_id = :uid AND active = TRUE
               RETURNING empresa_codigo"""
        ),
        {"uid": user_id},
    )
    return len(result.fetchall())


async def _email_for(db, user_id: str) -> str | None:
    row = (
        await db.execute(
            text("SELECT email FROM auth.users WHERE id = :uid"),
            {"uid": user_id},
        )
    ).first()
    return row[0] if row else None


async def _count_other_admins(db, exclude_user_id: str) -> int:
    row = (
        await db.execute(
            text(
                """SELECT count(*) FROM core.user_roles
                   WHERE app_role = 'admin' AND user_id <> :uid"""
            ),
            {"uid": exclude_user_id},
        )
    ).first()
    return int(row[0]) if row else 0


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
    """MEGAPROMPT F1a — Revocación de acceso REAL (soft-delete + ban).

    Antes esto solo hacía `DELETE FROM core.user_roles`, dejando la cuenta de
    Supabase activa (seguía logueándose) y los roles por empresa intactos
    (seguía viendo/operando). Ahora corta el acceso de verdad:
      1. Banea la cuenta en Supabase Auth (no puede loguearse; reversible).
      2. Desactiva todos sus roles por empresa (deja de ver cualquier empresa).
      3. Revoca sus API tokens.
      4. Baja su rol global (DELETE de user_roles).
    Preserva el historial (vouchers/OC creados, firmas) — son evidencia
    contable/legal y no se borran. Protegido: uno mismo, nrietta, último admin.
    """
    if user_id == user.sub:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No podés removerte a vos mismo (otro admin debe hacerlo)",
        )

    email = await _email_for(db, user_id)
    if email is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Usuario {user_id} no encontrado",
        )
    if email.strip().lower() == NRIETTA_EMAIL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Esta cuenta está protegida y no puede revocarse.",
        )

    # Protección del último admin: no dejar la plataforma sin administradores.
    current = await UserRoleRepository(db).get_role(user_id)
    if current and current.app_role == "admin":
        if await _count_other_admins(db, exclude_user_id=user_id) == 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No podés revocar al último admin. Asigná otro admin primero.",
            )

    # 1) Cortar login en Supabase Auth (soft-fail: no abortamos si la API falla,
    #    pero lo dejamos registrado — igual quitamos roles/tokens).
    await _ban_supabase_user(user_id, banned=True)
    # 2) Sacar acceso a todas las empresas.
    n_emp = await _deactivate_company_roles(db, user_id)
    # 3) Revocar API tokens.
    await _revoke_user_api_tokens(db, user_id, reason="user_deleted")
    # 4) Bajar rol global.
    deleted = await UserRoleRepository(db).delete(user_id)

    await db.commit()
    log.info(
        "admin.user_access_revoked",
        user_id=user_id,
        email=email,
        empresa_roles_deactivated=n_emp,
        role_row_deleted=deleted,
        by=user.sub,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
