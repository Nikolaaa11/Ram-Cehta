"""CRUD Proveedores — Session 2.3."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response

from app.api.deps import CurrentUser, DBSession
from app.infrastructure.repositories.proveedor_repository import ProveedorRepository
from app.schemas.common import Page
from app.schemas.proveedor import ProveedorCreate, ProveedorRead, ProveedorUpdate

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
    user: CurrentUser,
    db: DBSession,
    body: ProveedorCreate,
) -> ProveedorRead:
    if user.app_role not in ("admin", "finance"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Permisos insuficientes"
        )
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
    return ProveedorRead.model_validate(proveedor)


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
    user: CurrentUser,
    db: DBSession,
    proveedor_id: int,
    body: ProveedorUpdate,
) -> ProveedorRead:
    if user.app_role not in ("admin", "finance"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Permisos insuficientes"
        )
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
    updated = await repo.update(proveedor, body)
    await db.commit()
    return ProveedorRead.model_validate(updated)


@router.delete("/{proveedor_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def delete_proveedor(
    user: CurrentUser,
    db: DBSession,
    proveedor_id: int,
) -> Response:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Solo admins"
        )
    repo = ProveedorRepository(db)
    proveedor = await repo.get(proveedor_id)
    if not proveedor or not proveedor.activo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encontrado")
    await repo.soft_delete(proveedor)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
