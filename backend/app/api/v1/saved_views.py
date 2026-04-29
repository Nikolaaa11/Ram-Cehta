"""Endpoints de SavedViews (V3 fase 11 — Saved filters per user).

Cada usuario solo ve / muta sus propias vistas. No requiere scope
especial: basta con estar autenticado. Privacy se enforced en el
repository via `WHERE user_id = ?`.

Prefix `/me`: namespace para endpoints user-scoped (perfil propio,
configuración personal). Por ahora solo `/me/views`, pero deja la
puerta abierta a `/me/preferences`, `/me/api-keys`, etc.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentUser, DBSession
from app.infrastructure.repositories.saved_view_repository import (
    SavedViewRepository,
)
from app.schemas.saved_view import (
    SavedViewCreate,
    SavedViewPage,
    SavedViewRead,
    SavedViewUpdate,
)

router = APIRouter()


@router.get("/views", response_model=list[SavedViewRead])
async def list_views(
    user: CurrentUser,
    db: DBSession,
    page: Annotated[SavedViewPage | None, Query()] = None,
) -> list[SavedViewRead]:
    """Lista las vistas del usuario, opcionalmente filtradas por página."""
    repo = SavedViewRepository(db)
    items = await repo.list_for_user(user.sub, page=page)
    return [SavedViewRead.model_validate(v) for v in items]


@router.post("/views", response_model=SavedViewRead, status_code=status.HTTP_201_CREATED)
async def create_view(
    user: CurrentUser,
    db: DBSession,
    payload: SavedViewCreate,
) -> SavedViewRead:
    """Crea una vista nueva con los filtros snapshot actuales."""
    repo = SavedViewRepository(db)
    view = await repo.create(
        user_id=user.sub,
        page=payload.page,
        name=payload.name,
        filters=payload.filters,
    )
    await db.commit()
    return SavedViewRead.model_validate(view)


@router.patch("/views/{view_id}", response_model=SavedViewRead)
async def update_view(
    user: CurrentUser,
    db: DBSession,
    view_id: str,
    payload: SavedViewUpdate,
) -> SavedViewRead:
    """Update parcial: rename / cambio de filtros / toggle pin."""
    repo = SavedViewRepository(db)
    view = await repo.update(
        view_id,
        user.sub,
        name=payload.name,
        filters=payload.filters,
        is_pinned=payload.is_pinned,
    )
    if view is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vista no encontrada",
        )
    await db.commit()
    return SavedViewRead.model_validate(view)


@router.delete(
    "/views/{view_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_view(
    user: CurrentUser,
    db: DBSession,
    view_id: str,
) -> Response:
    """Borra una vista del usuario. 404 si no es suya."""
    repo = SavedViewRepository(db)
    deleted = await repo.delete(view_id, user.sub)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vista no encontrada",
        )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
