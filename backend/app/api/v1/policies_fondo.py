"""Endpoints CRUD para `core.policies_fondo` (V5).

Políticas del FIP CEHTA — reglamento interno, manual UAF, código ética,
políticas internas. Distinto de `legal_documents` (que es por empresa
portfolio).

Auth:
- read: cualquier usuario autenticado
- create/update/delete: scope `legal:write` (mismo que documentos legales)
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DBSession, require_scope
from app.models.policy_fondo import PolicyFondo
from app.schemas.policy_fondo import (
    PolicyEstado,
    PolicyFondoCreate,
    PolicyFondoRead,
    PolicyFondoUpdate,
    PolicyTipo,
)

router = APIRouter()


def _to_read(p: PolicyFondo) -> PolicyFondoRead:
    """Convierte modelo SA → schema Pydantic.

    Necesario porque la columna `metadata` en SA está mapeada como
    `metadata_` (reservado por Base.metadata), pero el schema expone
    `metadata` plano. `model_validate(p, from_attributes=True)` no
    encontraría el atributo `metadata`.
    """
    return PolicyFondoRead.model_validate(
        {
            "policy_id": p.policy_id,
            "tipo": p.tipo,
            "nombre": p.nombre,
            "version": p.version,
            "fecha_aprobacion": p.fecha_aprobacion,
            "fecha_vigencia_desde": p.fecha_vigencia_desde,
            "fecha_proxima_revision": p.fecha_proxima_revision,
            "aprobado_por": p.aprobado_por,
            "dropbox_path": p.dropbox_path,
            "hash_sha256": p.hash_sha256,
            "estado": p.estado,
            "metadata": p.metadata_ or {},
            "created_at": p.created_at,
            "updated_at": p.updated_at,
        }
    )


@router.get("", response_model=list[PolicyFondoRead])
async def list_policies(
    user: CurrentUser,
    db: DBSession,
    tipo: PolicyTipo | None = Query(default=None),
    estado: PolicyEstado | None = Query(default=None),
    proxima_revision_desde: date | None = Query(default=None),
    proxima_revision_hasta: date | None = Query(default=None),
) -> list[PolicyFondoRead]:
    """Lista políticas del fondo. Default: todas, ordenadas por
    `tipo` ASC y luego `fecha_aprobacion` DESC (versión más nueva
    primero dentro de cada tipo).
    """
    stmt = select(PolicyFondo)
    if tipo is not None:
        stmt = stmt.where(PolicyFondo.tipo == tipo)
    if estado is not None:
        stmt = stmt.where(PolicyFondo.estado == estado)
    if proxima_revision_desde is not None:
        stmt = stmt.where(
            PolicyFondo.fecha_proxima_revision >= proxima_revision_desde
        )
    if proxima_revision_hasta is not None:
        stmt = stmt.where(
            PolicyFondo.fecha_proxima_revision <= proxima_revision_hasta
        )
    stmt = stmt.order_by(
        PolicyFondo.tipo.asc(), PolicyFondo.fecha_aprobacion.desc()
    )
    result = await db.execute(stmt)
    return [_to_read(p) for p in result.scalars().all()]


@router.get("/{policy_id}", response_model=PolicyFondoRead)
async def get_policy(
    user: CurrentUser, db: DBSession, policy_id: int
) -> PolicyFondoRead:
    p = await db.get(PolicyFondo, policy_id)
    if p is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Política no encontrada",
        )
    return _to_read(p)


@router.post(
    "",
    response_model=PolicyFondoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_policy(
    user: CurrentUser, db: DBSession, body: PolicyFondoCreate
) -> PolicyFondoRead:
    p = PolicyFondo(
        tipo=body.tipo,
        nombre=body.nombre,
        version=body.version,
        fecha_aprobacion=body.fecha_aprobacion,
        fecha_vigencia_desde=body.fecha_vigencia_desde,
        fecha_proxima_revision=body.fecha_proxima_revision,
        aprobado_por=body.aprobado_por,
        dropbox_path=body.dropbox_path,
        hash_sha256=body.hash_sha256,
        estado=body.estado,
        metadata_=body.metadata,
    )
    db.add(p)
    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        # UNIQUE (tipo, version) violation → 409
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ya existe versión '{body.version}' para tipo '{body.tipo}'",
        ) from exc
    await db.refresh(p)
    return _to_read(p)


@router.patch(
    "/{policy_id}",
    response_model=PolicyFondoRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def update_policy(
    user: CurrentUser,
    db: DBSession,
    policy_id: int,
    body: PolicyFondoUpdate,
) -> PolicyFondoRead:
    p = await db.get(PolicyFondo, policy_id)
    if p is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Política no encontrada",
        )
    update_data = body.model_dump(exclude_unset=True)
    if "metadata" in update_data:
        update_data["metadata_"] = update_data.pop("metadata")
    for k, v in update_data.items():
        setattr(p, k, v)
    await db.commit()
    await db.refresh(p)
    return _to_read(p)


# NOTA: no hay endpoint DELETE intencionalmente. Las políticas no se borran
# — se derogan vía PATCH con `estado='derogada'`. Esto preserva historial
# regulatorio que CMF puede pedir. Si necesitás borrado físico (limpiar
# borradores duplicados), hacelo desde la DB directamente con auditoria.
