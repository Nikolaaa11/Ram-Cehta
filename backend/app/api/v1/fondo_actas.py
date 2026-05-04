"""Endpoints CRUD para `core.fondo_actas` (V5).

Actas formales del FIP CEHTA — Directorio AFIS, Comité de Inversión,
Asamblea de LPs, Comités de Vigilancia y Riesgo. Distinto de
`legal_documents` con `categoria='acta'` (que es por empresa portfolio).

Auth:
- read: cualquier usuario autenticado
- create/update/delete: scope `legal:write` (mismo que documentos legales)

A diferencia de policies_fondo, las actas SI permiten DELETE: si una
acta se levantó por error (correlativo errado, duplicado de prueba), el
operador puede limpiarla. Las actas firmadas reales se preservan vía
`estado='archivada'`.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DBSession, require_scope
from app.models.fondo_acta import FondoActa
from app.schemas.fondo_acta import (
    FondoActaCreate,
    FondoActaEstado,
    FondoActaRead,
    FondoActaTipo,
    FondoActaUpdate,
)

router = APIRouter()


def _to_read(a: FondoActa) -> FondoActaRead:
    """Convierte modelo SA → schema Pydantic.

    Necesario porque la columna `metadata` en SA está mapeada como
    `metadata_` (reservado por Base.metadata), pero el schema expone
    `metadata` plano. `model_validate(a, from_attributes=True)` no
    encontraría el atributo `metadata`.
    """
    return FondoActaRead.model_validate(
        {
            "acta_id": a.acta_id,
            "tipo_organo": a.tipo_organo,
            "numero_acta": a.numero_acta,
            "fecha_reunion": a.fecha_reunion,
            "lugar": a.lugar,
            "quorum": a.quorum,
            "quorum_total": a.quorum_total,
            "presidente": a.presidente,
            "secretario": a.secretario,
            "asistentes": a.asistentes or [],
            "temario": a.temario,
            "acuerdos": a.acuerdos or [],
            "dropbox_path": a.dropbox_path,
            "hash_sha256": a.hash_sha256,
            "estado": a.estado,
            "metadata": a.metadata_ or {},
            "created_at": a.created_at,
            "updated_at": a.updated_at,
        }
    )


@router.get("", response_model=list[FondoActaRead])
async def list_fondo_actas(
    user: CurrentUser,
    db: DBSession,
    tipo_organo: FondoActaTipo | None = Query(default=None),
    estado: FondoActaEstado | None = Query(default=None),
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
) -> list[FondoActaRead]:
    """Lista actas del fondo. Default: todas, ordenadas por
    `fecha_reunion` DESC (más reciente primero).
    """
    stmt = select(FondoActa)
    if tipo_organo is not None:
        stmt = stmt.where(FondoActa.tipo_organo == tipo_organo)
    if estado is not None:
        stmt = stmt.where(FondoActa.estado == estado)
    if fecha_desde is not None:
        stmt = stmt.where(FondoActa.fecha_reunion >= fecha_desde)
    if fecha_hasta is not None:
        stmt = stmt.where(FondoActa.fecha_reunion <= fecha_hasta)
    stmt = stmt.order_by(FondoActa.fecha_reunion.desc())
    result = await db.execute(stmt)
    return [_to_read(a) for a in result.scalars().all()]


@router.get("/{acta_id}", response_model=FondoActaRead)
async def get_fondo_acta(
    user: CurrentUser, db: DBSession, acta_id: int
) -> FondoActaRead:
    a = await db.get(FondoActa, acta_id)
    if a is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Acta no encontrada",
        )
    return _to_read(a)


@router.post(
    "",
    response_model=FondoActaRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_fondo_acta(
    user: CurrentUser, db: DBSession, body: FondoActaCreate
) -> FondoActaRead:
    a = FondoActa(
        tipo_organo=body.tipo_organo,
        numero_acta=body.numero_acta,
        fecha_reunion=body.fecha_reunion,
        lugar=body.lugar,
        quorum=body.quorum,
        quorum_total=body.quorum_total,
        presidente=body.presidente,
        secretario=body.secretario,
        asistentes=list(body.asistentes),
        temario=body.temario,
        acuerdos=[ac.model_dump() for ac in body.acuerdos],
        dropbox_path=body.dropbox_path,
        hash_sha256=body.hash_sha256,
        estado=body.estado,
        metadata_=body.metadata,
    )
    db.add(a)
    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        # UNIQUE (tipo_organo, numero_acta) violation → 409
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Ya existe acta N°{body.numero_acta} para "
                f"'{body.tipo_organo}'"
            ),
        ) from exc
    await db.refresh(a)
    return _to_read(a)


@router.patch(
    "/{acta_id}",
    response_model=FondoActaRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def update_fondo_acta(
    user: CurrentUser,
    db: DBSession,
    acta_id: int,
    body: FondoActaUpdate,
) -> FondoActaRead:
    a = await db.get(FondoActa, acta_id)
    if a is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Acta no encontrada",
        )
    update_data = body.model_dump(exclude_unset=True)
    if "metadata" in update_data:
        update_data["metadata_"] = update_data.pop("metadata")
    if "acuerdos" in update_data and update_data["acuerdos"] is not None:
        # body.acuerdos ya viene como list[Acuerdo]; model_dump() los
        # serializa a dicts planos — dejamos pasar tal cual a JSONB.
        pass
    for k, v in update_data.items():
        setattr(a, k, v)
    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Conflicto al actualizar acta (correlativo duplicado?)",
        ) from exc
    await db.refresh(a)
    return _to_read(a)


@router.delete(
    "/{acta_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def delete_fondo_acta(
    user: CurrentUser, db: DBSession, acta_id: int
) -> None:
    a = await db.get(FondoActa, acta_id)
    if a is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Acta no encontrada",
        )
    await db.delete(a)
    await db.commit()
    return None
