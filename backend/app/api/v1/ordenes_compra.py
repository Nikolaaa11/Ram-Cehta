"""CRUD Órdenes de Compra — Session 2.5."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.orden_compra_repository import OrdenCompraRepository
from app.models.orden_compra import OrdenCompra
from app.schemas.common import Page
from app.schemas.orden_compra import (
    EstadoUpdateRequest,
    OCDetalleRead,
    OrdenCompraCreate,
    OrdenCompraListItem,
    OrdenCompraRead,
)
from app.services.authorization_service import AuthorizationService

router = APIRouter()
_authz = AuthorizationService()


def _to_list_item(user: AuthenticatedUser, oc: OrdenCompra) -> OrdenCompraListItem:
    return OrdenCompraListItem(
        oc_id=oc.oc_id,
        numero_oc=oc.numero_oc,
        empresa_codigo=oc.empresa_codigo,
        proveedor_id=oc.proveedor_id,
        fecha_emision=oc.fecha_emision,
        moneda=oc.moneda,
        neto=oc.neto,
        total=oc.total,
        estado=oc.estado,
        pdf_url=oc.pdf_url,
        allowed_actions=_authz.allowed_actions_for_oc(user, oc.estado),
    )


def _to_read(user: AuthenticatedUser, oc: OrdenCompra) -> OrdenCompraRead:
    return OrdenCompraRead(
        oc_id=oc.oc_id,
        numero_oc=oc.numero_oc,
        empresa_codigo=oc.empresa_codigo,
        proveedor_id=oc.proveedor_id,
        fecha_emision=oc.fecha_emision,
        validez_dias=oc.validez_dias,
        moneda=oc.moneda,
        neto=oc.neto,
        iva=oc.iva,
        total=oc.total,
        forma_pago=oc.forma_pago,
        plazo_pago=oc.plazo_pago,
        observaciones=oc.observaciones,
        estado=oc.estado,
        pdf_url=oc.pdf_url,
        items=[OCDetalleRead.model_validate(d) for d in (oc.items or [])],
        created_at=oc.created_at,
        updated_at=oc.updated_at,
        allowed_actions=_authz.allowed_actions_for_oc(user, oc.estado),
    )


@router.get("", response_model=Page[OrdenCompraListItem])
async def list_ocs(
    user: CurrentUser,
    db: DBSession,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    empresa_codigo: str | None = None,
    estado: str | None = None,
) -> Page[OrdenCompraListItem]:
    repo = OrdenCompraRepository(db)
    items, total = await repo.list(
        page=page, size=size, empresa_codigo=empresa_codigo, estado=estado
    )
    return Page.build(
        items=[_to_list_item(user, oc) for oc in items],
        total=total,
        page=page,
        size=size,
    )


@router.post("", response_model=OrdenCompraRead, status_code=status.HTTP_201_CREATED)
async def create_oc(
    user: Annotated[AuthenticatedUser, Depends(require_scope("oc:create"))],
    db: DBSession,
    body: OrdenCompraCreate,
) -> OrdenCompraRead:
    repo = OrdenCompraRepository(db)
    if await repo.exists_numero_oc(body.empresa_codigo, body.numero_oc):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"OC {body.numero_oc} ya existe para empresa {body.empresa_codigo}",
        )
    oc = await repo.create(body)
    await db.commit()
    oc = await repo.get(oc.oc_id)  # re-fetch para cargar items via selectin
    if not oc:
        raise HTTPException(status_code=500, detail="Error al recuperar OC creada")
    return _to_read(user, oc)


@router.get("/{oc_id}", response_model=OrdenCompraRead)
async def get_oc(user: CurrentUser, db: DBSession, oc_id: int) -> OrdenCompraRead:
    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada")
    return _to_read(user, oc)


@router.patch("/{oc_id}/estado", response_model=OrdenCompraRead)
async def update_estado(
    user: CurrentUser,
    db: DBSession,
    oc_id: int,
    body: EstadoUpdateRequest,
) -> OrdenCompraRead:
    repo = OrdenCompraRepository(db)
    oc = await repo.get(oc_id)
    if not oc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OC no encontrada")

    allowed = _authz.allowed_actions_for_oc(user, oc.estado)
    _ESTADO_ACTION = {"pagada": "mark_paid", "anulada": "cancel", "parcial": "mark_paid"}
    required = _ESTADO_ACTION.get(body.estado)
    if not required or required not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"No tienes permiso para cambiar estado a '{body.estado}'",
        )

    updated = await repo.update_estado(oc, body.estado)
    await db.commit()
    return _to_read(user, updated)
