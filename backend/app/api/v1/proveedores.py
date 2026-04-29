"""CRUD Proveedores — Session 2.3."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.proveedor_repository import ProveedorRepository
from app.schemas.common import Page
from app.schemas.proveedor import ProveedorCreate, ProveedorRead, ProveedorUpdate
from app.services.audit_service import audit_log

router = APIRouter()


@router.get("", response_model=Page[ProveedorRead])
async def list_proveedores(
    user: CurrentUser,
    db: DBSession,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    search: str | None = None,
) -> Page[ProveedorRead]:
    repo = ProveedorRepository(db)
    items, total = await repo.list(page=page, size=size, search=search)
    return Page.build(
        items=[ProveedorRead.model_validate(p) for p in items],
        total=total,
        page=page,
        size=size,
    )


@router.post("", response_model=ProveedorRead, status_code=status.HTTP_201_CREATED)
async def create_proveedor(
    user: Annotated[AuthenticatedUser, Depends(require_scope("proveedor:create"))],
    db: DBSession,
    request: Request,
    body: ProveedorCreate,
) -> ProveedorRead:
    repo = ProveedorRepository(db)
    if body.rut:
        existing = await repo.get_by_rut(body.rut)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"RUT {body.rut} ya existe (proveedor_id={existing.proveedor_id})",
            )
    proveedor = await repo.create(body)
    await db.commit()
    created = ProveedorRead.model_validate(proveedor)
    await audit_log(
        db,
        request,
        user,
        action="create",
        entity_type="proveedor",
        entity_id=str(created.proveedor_id),
        entity_label=created.razon_social,
        summary=f"Proveedor '{created.razon_social}' creado",
        before=None,
        after=created.model_dump(mode="json"),
    )
    return created


@router.get("/{proveedor_id}", response_model=ProveedorRead)
async def get_proveedor(
    user: CurrentUser,
    db: DBSession,
    proveedor_id: int,
) -> ProveedorRead:
    repo = ProveedorRepository(db)
    proveedor = await repo.get(proveedor_id)
    if not proveedor or not proveedor.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")
    return ProveedorRead.model_validate(proveedor)


@router.patch("/{proveedor_id}", response_model=ProveedorRead)
async def update_proveedor(
    user: Annotated[AuthenticatedUser, Depends(require_scope("proveedor:update"))],
    db: DBSession,
    request: Request,
    proveedor_id: int,
    body: ProveedorUpdate,
) -> ProveedorRead:
    repo = ProveedorRepository(db)
    proveedor = await repo.get(proveedor_id)
    if not proveedor or not proveedor.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")
    if body.rut:
        existing = await repo.get_by_rut(body.rut)
        if existing and existing.proveedor_id != proveedor_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"RUT {body.rut} ya existe (proveedor_id={existing.proveedor_id})",
            )
    before = ProveedorRead.model_validate(proveedor).model_dump(mode="json")
    updated = await repo.update(proveedor, body)
    await db.commit()
    refreshed = ProveedorRead.model_validate(updated)
    await audit_log(
        db,
        request,
        user,
        action="update",
        entity_type="proveedor",
        entity_id=str(proveedor_id),
        entity_label=refreshed.razon_social,
        summary=f"Proveedor '{refreshed.razon_social}' editado",
        before=before,
        after=refreshed.model_dump(mode="json"),
    )
    return refreshed


@router.delete("/{proveedor_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_proveedor(
    user: Annotated[AuthenticatedUser, Depends(require_scope("proveedor:delete"))],
    db: DBSession,
    request: Request,
    proveedor_id: int,
) -> Response:
    repo = ProveedorRepository(db)
    proveedor = await repo.get(proveedor_id)
    if not proveedor or not proveedor.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")
    before = ProveedorRead.model_validate(proveedor).model_dump(mode="json")
    nombre = before.get("razon_social")
    await repo.soft_delete(proveedor)
    await db.commit()
    await audit_log(
        db,
        request,
        user,
        action="delete",
        entity_type="proveedor",
        entity_id=str(proveedor_id),
        entity_label=nombre,
        summary=f"Proveedor '{nombre}' eliminado (soft-delete)",
        before=before,
        after={"activo": False},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
