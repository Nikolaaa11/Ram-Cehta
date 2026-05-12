"""Endpoints CRUD para `core.estados_financieros` (V5).

Vault de EEFF cross-empresa portfolio: Balance, Estado de Resultados,
Flujo de Caja, Cambios de Patrimonio, Consolidados y Notas. Por empresa
portfolio + período, con metadata JSONB para KPIs extraídos.

Auth:
- read: cualquier usuario autenticado
- create / update / delete: scope `legal:write` (mismo scope que legal
  documents y policies_fondo).

Listado cross-empresa (no anidado bajo `/empresa/{cod}/...`) — el GP
necesita ver "todos los EEFF del último cierre" sin pivotar empresa por
empresa, y los filtros opcionales cubren los casos por empresa.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select

from app.api.deps import CurrentUser, DBSession, require_scope
from app.models.empresa import Empresa
from app.models.estado_financiero import EstadoFinanciero
from app.services.empresa_scope_service import (
    EmpresaScopeDep,
    assert_empresa_access,
)
from app.schemas.estado_financiero import (
    EstadoFinancieroCreate,
    EstadoFinancieroRead,
    EstadoFinancieroUpdate,
    PeriodoTipo,
    TipoEf,
)

router = APIRouter()


def _to_read(ef: EstadoFinanciero) -> EstadoFinancieroRead:
    """Convierte modelo SA → schema Pydantic.

    Necesario porque la columna `metadata` en SA está mapeada como
    `metadata_` (reservado por Base.metadata), pero el schema expone
    `metadata` plano. `model_validate(ef, from_attributes=True)` no
    encontraría el atributo `metadata`.
    """
    return EstadoFinancieroRead.model_validate(
        {
            "ef_id": ef.ef_id,
            "empresa_codigo": ef.empresa_codigo,
            "tipo_ef": ef.tipo_ef,
            "periodo_tipo": ef.periodo_tipo,
            "periodo": ef.periodo,
            "fecha_corte": ef.fecha_corte,
            "auditado": ef.auditado,
            "auditor": ef.auditor,
            "aprobado_directorio": ef.aprobado_directorio,
            "fecha_aprobacion": ef.fecha_aprobacion,
            "dropbox_path": ef.dropbox_path,
            "hash_sha256": ef.hash_sha256,
            "metadata": ef.metadata_ or {},
            "created_at": ef.created_at,
            "updated_at": ef.updated_at,
        }
    )


async def _empresa_exists(db, empresa_codigo: str) -> bool:
    stmt = select(Empresa.codigo).where(Empresa.codigo == empresa_codigo)
    result = await db.execute(stmt)
    return result.scalar_one_or_none() is not None


@router.get("", response_model=list[EstadoFinancieroRead])
async def list_estados_financieros(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    empresa_codigo: str | None = Query(default=None),
    tipo_ef: TipoEf | None = Query(default=None),
    periodo_tipo: PeriodoTipo | None = Query(default=None),
    auditado: bool | None = Query(default=None),
    fecha_desde: date | None = Query(default=None),
    fecha_hasta: date | None = Query(default=None),
) -> list[EstadoFinancieroRead]:
    """V5++ ola CB: EEFF filtrados por empresas en scope del user."""
    empresa_codes = scope.filter_codes(empresa_codigo)
    stmt = select(EstadoFinanciero)
    if empresa_codes is not None:
        stmt = stmt.where(EstadoFinanciero.empresa_codigo.in_(empresa_codes))
    elif empresa_codigo is not None:
        stmt = stmt.where(EstadoFinanciero.empresa_codigo == empresa_codigo)
    if tipo_ef is not None:
        stmt = stmt.where(EstadoFinanciero.tipo_ef == tipo_ef)
    if periodo_tipo is not None:
        stmt = stmt.where(EstadoFinanciero.periodo_tipo == periodo_tipo)
    if auditado is not None:
        stmt = stmt.where(EstadoFinanciero.auditado == auditado)
    if fecha_desde is not None:
        stmt = stmt.where(EstadoFinanciero.fecha_corte >= fecha_desde)
    if fecha_hasta is not None:
        stmt = stmt.where(EstadoFinanciero.fecha_corte <= fecha_hasta)
    stmt = stmt.order_by(EstadoFinanciero.fecha_corte.desc())
    result = await db.execute(stmt)
    return [_to_read(ef) for ef in result.scalars().all()]


@router.get("/{ef_id}", response_model=EstadoFinancieroRead)
async def get_estado_financiero(
    user: CurrentUser, db: DBSession, ef_id: int
) -> EstadoFinancieroRead:
    ef = await db.get(EstadoFinanciero, ef_id)
    if ef is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Estado financiero no encontrado",
        )
    await assert_empresa_access(user, db, ef.empresa_codigo)
    return _to_read(ef)


@router.post(
    "",
    response_model=EstadoFinancieroRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_estado_financiero(
    user: CurrentUser, db: DBSession, body: EstadoFinancieroCreate
) -> EstadoFinancieroRead:
    # V5++ ola CB: scope check
    await assert_empresa_access(user, db, body.empresa_codigo)
    if not await _empresa_exists(db, body.empresa_codigo):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Empresa '{body.empresa_codigo}' no encontrada",
        )
    ef = EstadoFinanciero(
        empresa_codigo=body.empresa_codigo,
        tipo_ef=body.tipo_ef,
        periodo_tipo=body.periodo_tipo,
        periodo=body.periodo,
        fecha_corte=body.fecha_corte,
        auditado=body.auditado,
        auditor=body.auditor,
        aprobado_directorio=body.aprobado_directorio,
        fecha_aprobacion=body.fecha_aprobacion,
        dropbox_path=body.dropbox_path,
        hash_sha256=body.hash_sha256,
        metadata_=body.metadata,
    )
    db.add(ef)
    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        # UNIQUE (empresa_codigo, tipo_ef, periodo) violation → 409.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Ya existe EEFF '{body.tipo_ef}' para periodo "
                f"'{body.periodo}' en empresa '{body.empresa_codigo}'"
            ),
        ) from exc
    await db.refresh(ef)
    return _to_read(ef)


@router.patch(
    "/{ef_id}",
    response_model=EstadoFinancieroRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def update_estado_financiero(
    user: CurrentUser,
    db: DBSession,
    ef_id: int,
    body: EstadoFinancieroUpdate,
) -> EstadoFinancieroRead:
    ef = await db.get(EstadoFinanciero, ef_id)
    if ef is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Estado financiero no encontrado",
        )
    await assert_empresa_access(user, db, ef.empresa_codigo)
    update_data = body.model_dump(exclude_unset=True)
    if "metadata" in update_data:
        update_data["metadata_"] = update_data.pop("metadata")
    for k, v in update_data.items():
        setattr(ef, k, v)
    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Conflicto de unicidad (empresa_codigo, tipo_ef, periodo) "
                "al actualizar el estado financiero"
            ),
        ) from exc
    await db.refresh(ef)
    return _to_read(ef)


@router.delete(
    "/{ef_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def delete_estado_financiero(
    user: CurrentUser, db: DBSession, ef_id: int
) -> Response:
    """Borrado físico — el GP puede limpiar EEFF cargados por error
    (ej. archivo subido al período equivocado). Para preservar historial
    regulatorio CMF, lo correcto es marcar `auditado=true` con
    `aprobado_directorio=true` antes que borrar.
    """
    ef = await db.get(EstadoFinanciero, ef_id)
    if ef is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Estado financiero no encontrado",
        )
    await assert_empresa_access(user, db, ef.empresa_codigo)
    await db.delete(ef)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
