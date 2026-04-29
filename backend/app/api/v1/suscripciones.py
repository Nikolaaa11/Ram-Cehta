"""Suscripciones de acciones FIP CEHTA ESG — V2.

CRUD básico + reporte agregado por empresa para inversionistas.
Todos los roles pueden leer (suscripcion:read). admin/finance pueden crear.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response

from app.api.deps import DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.suscripcion_repository import SuscripcionRepository
from app.schemas.common import Page
from app.schemas.suscripcion import (
    SuscripcionCreate,
    SuscripcionRead,
    SuscripcionResumen,
    SuscripcionUpdate,
)
from app.services.audit_service import audit_log

router = APIRouter()


@router.get("", response_model=Page[SuscripcionRead])
async def list_suscripciones(
    user: Annotated[AuthenticatedUser, Depends(require_scope("suscripcion:read"))],
    db: DBSession,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    empresa_codigo: str | None = None,
) -> Page[SuscripcionRead]:
    repo = SuscripcionRepository(db)
    items, total = await repo.list(empresa_codigo=empresa_codigo, page=page, size=size)
    return Page.build(
        items=[SuscripcionRead.model_validate(s) for s in items],
        total=total,
        page=page,
        size=size,
    )


@router.post("", response_model=SuscripcionRead, status_code=status.HTTP_201_CREATED)
async def create_suscripcion(
    user: Annotated[AuthenticatedUser, Depends(require_scope("suscripcion:create"))],
    db: DBSession,
    request: Request,
    body: SuscripcionCreate,
) -> SuscripcionRead:
    repo = SuscripcionRepository(db)
    obj = await repo.create(body)
    await db.commit()
    created = SuscripcionRead.model_validate(obj)
    await audit_log(
        db,
        request,
        user,
        action="create",
        entity_type="suscripcion",
        entity_id=str(created.suscripcion_id),
        entity_label=str(created.suscripcion_id),
        summary=f"Suscripción {created.suscripcion_id} creada",
        before=None,
        after=created.model_dump(mode="json"),
    )
    return created


@router.patch("/{suscripcion_id}", response_model=SuscripcionRead)
async def update_suscripcion(
    user: Annotated[AuthenticatedUser, Depends(require_scope("suscripcion:update"))],
    db: DBSession,
    request: Request,
    suscripcion_id: int,
    body: SuscripcionUpdate,
) -> SuscripcionRead:
    """PATCH parcial. admin/finance pueden editar firmado, fecha_firma, etc."""
    repo = SuscripcionRepository(db)
    obj = await repo.get(suscripcion_id)
    if obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Suscripción no encontrada",
        )
    before = SuscripcionRead.model_validate(obj).model_dump(mode="json")
    updated = await repo.update(obj, body)
    await db.commit()
    refreshed = SuscripcionRead.model_validate(updated)
    await audit_log(
        db,
        request,
        user,
        action="update",
        entity_type="suscripcion",
        entity_id=str(suscripcion_id),
        entity_label=str(suscripcion_id),
        summary=f"Suscripción {suscripcion_id} editada",
        before=before,
        after=refreshed.model_dump(mode="json"),
    )
    return refreshed


@router.delete(
    "/{suscripcion_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_suscripcion(
    user: Annotated[AuthenticatedUser, Depends(require_scope("suscripcion:delete"))],
    db: DBSession,
    request: Request,
    suscripcion_id: int,
) -> Response:
    repo = SuscripcionRepository(db)
    obj = await repo.get(suscripcion_id)
    if obj is not None:
        before = SuscripcionRead.model_validate(obj).model_dump(mode="json")
        await repo.delete(obj)
        await db.commit()
        await audit_log(
            db,
            request,
            user,
            action="delete",
            entity_type="suscripcion",
            entity_id=str(suscripcion_id),
            entity_label=str(suscripcion_id),
            summary=f"Suscripción {suscripcion_id} eliminada",
            before=before,
            after=None,
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/totals", response_model=list[SuscripcionResumen])
async def totals_per_empresa(
    user: Annotated[AuthenticatedUser, Depends(require_scope("suscripcion:read"))],
    db: DBSession,
) -> list[SuscripcionResumen]:
    """Reporte agregado para inversionistas: totales por empresa emisora."""
    repo = SuscripcionRepository(db)
    return await repo.totals_by_empresa()
