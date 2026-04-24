"""Movimientos — lectura paginada y filtrable (ETL-only write)."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DBSession
from app.models.movimiento import Movimiento
from app.schemas.common import Page
from app.schemas.movimiento import MovimientoRead

router = APIRouter()


@router.get("", response_model=Page[MovimientoRead])
async def list_movimientos(
    user: CurrentUser,
    db: DBSession,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=200)] = 50,
    empresa_codigo: str | None = None,
    anio: int | None = None,
    periodo: str | None = None,
    real_proyectado: str | None = None,
    proyecto: str | None = None,
) -> Page[MovimientoRead]:
    q = select(Movimiento)
    if empresa_codigo:
        q = q.where(Movimiento.empresa_codigo == empresa_codigo)
    if anio:
        q = q.where(Movimiento.anio == anio)
    if periodo:
        q = q.where(Movimiento.periodo == periodo)
    if real_proyectado:
        q = q.where(Movimiento.real_proyectado == real_proyectado)
    if proyecto:
        q = q.where(Movimiento.proyecto == proyecto)
    q = q.order_by(Movimiento.fecha.desc(), Movimiento.movimiento_id.desc())

    total = await db.scalar(select(func.count()).select_from(q.subquery())) or 0
    items = list((await db.scalars(q.offset((page - 1) * size).limit(size))).all())

    return Page.build(
        items=[MovimientoRead.model_validate(m) for m in items],
        total=total,
        page=page,
        size=size,
    )
