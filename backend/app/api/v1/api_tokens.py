"""Public API tokens — admin CRUD.

Cada token "actúa como" el user que lo crea (hereda sus scopes via role).
El plaintext se devuelve UNA SOLA VEZ al crear. Después solo el hint.

Endpoints:
  GET    /api-tokens         — listar
  POST   /api-tokens         — crear (gate 2FA admin)
  POST   /api-tokens/{id}/revoke — revocar (gate 2FA admin)
  DELETE /api-tokens/{id}    — borrar permanentemente (gate 2FA admin)
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import text

from app.api.deps import DBSession, current_admin_with_2fa, require_scope
from app.core.security import AuthenticatedUser
from app.schemas.api_token import (
    ApiTokenCreate,
    ApiTokenRead,
    ApiTokenWithSecret,
)
from app.services.api_token_service import (
    create_token,
    revoke_token,
    token_hint,
)

router = APIRouter()


def _row_to_read(row: dict, *, hint: str | None = None) -> ApiTokenRead:
    return ApiTokenRead(
        id=str(row["id"]),
        name=row["name"],
        description=row.get("description"),
        token_hint=hint or "cak_…",
        created_by=str(row["created_by"]) if row.get("created_by") else None,
        last_used_at=row.get("last_used_at"),
        expires_at=row.get("expires_at"),
        revoked_at=row.get("revoked_at"),
        created_at=row["created_at"],
    )


@router.get("", response_model=list[ApiTokenRead])
async def list_tokens(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
) -> list[ApiTokenRead]:
    """Lista todos los tokens — solo admins. No expone el hash, solo el hint."""
    rows = (
        await db.execute(
            text(
                "SELECT id, name, description, created_by, last_used_at, "
                "expires_at, revoked_at, created_at "
                "FROM app.api_tokens "
                "ORDER BY created_at DESC"
            )
        )
    ).mappings().all()
    # Hint genérico — no tenemos el plaintext, solo el hash. Mostrar
    # 'cak_…' es suficiente identificación en la UI por nombre.
    return [_row_to_read(dict(r)) for r in rows]


@router.post(
    "",
    response_model=ApiTokenWithSecret,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(current_admin_with_2fa)],
)
async def create_api_token(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    body: ApiTokenCreate,
) -> ApiTokenWithSecret:
    """Crea un token nuevo. Devuelve el plaintext UNA sola vez.

    Gate 2FA: emitir credenciales que potencialmente actúan como un admin
    es operación critical. Requiere 2FA activo.
    """
    raw, row = await create_token(
        db,
        name=body.name,
        description=body.description,
        created_by=user.sub,
        expires_at=body.expires_at,
    )
    base = _row_to_read(row, hint=token_hint(raw))
    return ApiTokenWithSecret(**base.model_dump(), token=raw)


@router.post(
    "/{token_id}/revoke",
    response_model=ApiTokenRead,
    dependencies=[Depends(current_admin_with_2fa)],
)
async def revoke_api_token(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    token_id: str,
) -> ApiTokenRead:
    """Marca el token como revocado. El próximo intento de uso devuelve 401."""
    found = await revoke_token(db, token_id)
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Token no encontrado o ya revocado",
        )
    row = (
        await db.execute(
            text(
                "SELECT id, name, description, created_by, last_used_at, "
                "expires_at, revoked_at, created_at "
                "FROM app.api_tokens WHERE id = :id"
            ),
            {"id": token_id},
        )
    ).mappings().one()
    return _row_to_read(dict(row))


@router.delete(
    "/{token_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(current_admin_with_2fa)],
)
async def delete_api_token(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    token_id: str,
) -> Response:
    """Borra el registro completamente. Equivalente a revoke pero sin
    historial. Útil para limpiar tokens que nunca se usaron."""
    res = await db.execute(
        text("DELETE FROM app.api_tokens WHERE id = :id RETURNING id"),
        {"id": token_id},
    )
    if res.first() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Token no encontrado"
        )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
