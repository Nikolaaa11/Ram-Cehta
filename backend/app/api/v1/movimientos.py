"""Movimientos — lectura paginada + creación manual (V4 fase 5)."""
from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.models.movimiento import Movimiento
from app.schemas.common import Page
from app.schemas.movimiento import MovimientoManualCreate, MovimientoRead
from app.services.audit_service import audit_log

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


@router.post(
    "",
    response_model=MovimientoRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_manual_movimiento(
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("movimiento:create"))
    ],
    db: DBSession,
    request: Request,
    body: MovimientoManualCreate,
) -> MovimientoRead:
    """Crea un movimiento manual (fuera del ETL).

    Casos típicos: ajuste contable, transferencia de inversor que el banco
    no carga al Excel madre, corrección one-off. Todo el resto entra via
    ETL del Excel (sigue siendo el canal primario).

    `natural_key` se prefijo `manual_` + 12 chars random — esto evita
    chocar con keys del ETL (que usa formato Hipervinculo + idx).
    """
    natural_key = f"manual_{secrets.token_urlsafe(8)}"
    mov = Movimiento(
        natural_key=natural_key,
        fecha=body.fecha,
        descripcion=body.descripcion,
        abono=body.abono,
        egreso=body.egreso,
        concepto_general=body.concepto_general,
        concepto_detallado=body.concepto_detallado,
        tipo_egreso=body.tipo_egreso,
        fuente=body.fuente,
        proyecto=body.proyecto,
        banco=body.banco,
        real_proyectado="real",  # los manuales siempre son reales (ya sucedieron)
        anio=body.derived_anio(),
        periodo=body.derived_periodo(),
        empresa_codigo=body.empresa_codigo,
        tipo_documento=body.tipo_documento,
        numero_documento=body.numero_documento,
    )
    db.add(mov)
    await db.commit()
    await db.refresh(mov)

    summary = (
        f"Movimiento manual: {body.empresa_codigo} {body.fecha.isoformat()} "
        f"{'+' if body.abono > 0 else '-'}"
        f"{int(body.abono if body.abono > 0 else body.egreso):,} CLP".replace(
            ",", "."
        )
    )
    await audit_log(
        db,
        request,
        user,
        action="create",
        entity_type="movimiento",
        entity_id=str(mov.movimiento_id),
        entity_label=natural_key,
        summary=summary,
        before=None,
        after=MovimientoRead.model_validate(mov).model_dump(mode="json"),
    )
    return MovimientoRead.model_validate(mov)
