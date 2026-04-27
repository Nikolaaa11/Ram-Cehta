"""Suscripciones de acciones FIP CEHTA ESG — V2.

CRUD básico + reporte agregado por empresa para inversionistas.
Todos los roles pueden leer (suscripcion:read). admin/finance pueden crear.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.suscripcion_repository import SuscripcionRepository
from app.schemas.common import Page
from app.schemas.suscripcion import (
    SuscripcionCreate,
    SuscripcionRead,
    SuscripcionResumen,
)

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
    body: SuscripcionCreate,
) -> SuscripcionRead:
    repo = SuscripcionRepository(db)
    obj = await repo.create(body)
    await db.commit()
    return SuscripcionRead.model_validate(obj)


@router.get("/totals", response_model=list[SuscripcionResumen])
async def totals_per_empresa(
    user: Annotated[AuthenticatedUser, Depends(require_scope("suscripcion:read"))],
    db: DBSession,
) -> list[SuscripcionResumen]:
    """Reporte agregado para inversionistas: totales por empresa emisora."""
    repo = SuscripcionRepository(db)
    return await repo.totals_by_empresa()
