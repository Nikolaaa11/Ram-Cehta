"""Endpoints de Avance / Gantt (V3 fase 5).

Empresa-scoped: la lectura de proyectos siempre filtra por `empresa_codigo`.
Los hitos heredan empresa via `proyecto_id`. Los riesgos pueden ser
empresa-only o proyecto-scoped.

Soft fail con Dropbox: si Dropbox no está conectado, `/sync-roadmap`
devuelve 503 con mensaje accionable.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response

from app.api.deps import CurrentUser, DBSession, require_scope
from app.infrastructure.repositories.avance_repository import (
    HitoRepository,
    ProyectoRepository,
    RiesgoRepository,
)
from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)
from app.schemas.avance import (
    HitoCreate,
    HitoRead,
    HitoUpdate,
    ProyectoCreate,
    ProyectoDetail,
    ProyectoListItem,
    ProyectoRead,
    ProyectoUpdate,
    RiesgoCreate,
    RiesgoRead,
    RiesgoUpdate,
    SyncRoadmapResponse,
)
from app.services.dropbox_service import DropboxNotConfigured, DropboxService

router = APIRouter()


async def _get_dropbox_service(db: DBSession) -> DropboxService | None:
    integration = await IntegrationRepository(db).get_by_provider("dropbox")
    if integration is None:
        return None
    try:
        return DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
    except DropboxNotConfigured:
        return None


# ---------------------------------------------------------------------------
# Proyectos
# ---------------------------------------------------------------------------


@router.get(
    "/{empresa_codigo}/proyectos",
    response_model=list[ProyectoListItem],
    dependencies=[Depends(require_scope("avance:read"))],
)
async def list_proyectos(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str,
) -> list[ProyectoListItem]:
    proyecto_repo = ProyectoRepository(db)
    hito_repo = HitoRepository(db)
    riesgo_repo = RiesgoRepository(db)

    proyectos = await proyecto_repo.list_for_empresa(empresa_codigo)
    items: list[ProyectoListItem] = []
    for p in proyectos:
        hitos = await hito_repo.list_for_proyecto(p.proyecto_id)
        riesgos_abiertos = await riesgo_repo.count_abiertos_for_proyecto(p.proyecto_id)
        item = ProyectoListItem.model_validate(
            {
                **{c.name: getattr(p, c.name) for c in p.__table__.columns},
                "hitos": [HitoRead.model_validate(h) for h in hitos],
                "riesgos_abiertos": riesgos_abiertos,
            }
        )
        items.append(item)
    return items


@router.post(
    "/proyectos",
    response_model=ProyectoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("avance:create"))],
)
async def create_proyecto(
    user: CurrentUser,
    db: DBSession,
    body: ProyectoCreate,
) -> ProyectoRead:
    repo = ProyectoRepository(db)
    proyecto = await repo.create(body)
    await db.commit()
    return ProyectoRead.model_validate(proyecto)


@router.get(
    "/proyectos/{proyecto_id}",
    response_model=ProyectoDetail,
    dependencies=[Depends(require_scope("avance:read"))],
)
async def get_proyecto(
    user: CurrentUser,
    db: DBSession,
    proyecto_id: int,
) -> ProyectoDetail:
    repo = ProyectoRepository(db)
    proyecto = await repo.get(proyecto_id)
    if proyecto is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado"
        )
    hitos = await HitoRepository(db).list_for_proyecto(proyecto_id)
    riesgos = await RiesgoRepository(db).list_for_proyecto(proyecto_id)
    return ProyectoDetail.model_validate(
        {
            **{c.name: getattr(proyecto, c.name) for c in proyecto.__table__.columns},
            "hitos": [HitoRead.model_validate(h) for h in hitos],
            "riesgos": [RiesgoRead.model_validate(r) for r in riesgos],
        }
    )


@router.patch(
    "/proyectos/{proyecto_id}",
    response_model=ProyectoRead,
    dependencies=[Depends(require_scope("avance:update"))],
)
async def update_proyecto(
    user: CurrentUser,
    db: DBSession,
    proyecto_id: int,
    body: ProyectoUpdate,
) -> ProyectoRead:
    repo = ProyectoRepository(db)
    proyecto = await repo.get(proyecto_id)
    if proyecto is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado"
        )
    updated = await repo.update(proyecto, body)
    await db.commit()
    return ProyectoRead.model_validate(updated)


@router.delete(
    "/proyectos/{proyecto_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("avance:delete"))],
)
async def delete_proyecto(
    user: CurrentUser,
    db: DBSession,
    proyecto_id: int,
) -> Response:
    repo = ProyectoRepository(db)
    proyecto = await repo.get(proyecto_id)
    if proyecto is not None:
        await repo.delete(proyecto)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Hitos
# ---------------------------------------------------------------------------


@router.post(
    "/proyectos/{proyecto_id}/hitos",
    response_model=HitoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("avance:create"))],
)
async def create_hito(
    user: CurrentUser,
    db: DBSession,
    proyecto_id: int,
    body: HitoCreate,
) -> HitoRead:
    if (await ProyectoRepository(db).get(proyecto_id)) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado"
        )
    hito = await HitoRepository(db).create(proyecto_id, body)
    await db.commit()
    return HitoRead.model_validate(hito)


@router.patch(
    "/hitos/{hito_id}",
    response_model=HitoRead,
    dependencies=[Depends(require_scope("avance:update"))],
)
async def update_hito(
    user: CurrentUser,
    db: DBSession,
    hito_id: int,
    body: HitoUpdate,
) -> HitoRead:
    repo = HitoRepository(db)
    hito = await repo.get(hito_id)
    if hito is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Hito no encontrado"
        )
    updated = await repo.update(hito, body)
    await db.commit()
    return HitoRead.model_validate(updated)


@router.delete(
    "/hitos/{hito_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("avance:delete"))],
)
async def delete_hito(
    user: CurrentUser,
    db: DBSession,
    hito_id: int,
) -> Response:
    repo = HitoRepository(db)
    hito = await repo.get(hito_id)
    if hito is not None:
        await repo.delete(hito)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Riesgos
# ---------------------------------------------------------------------------


@router.get(
    "/{empresa_codigo}/riesgos",
    response_model=list[RiesgoRead],
    dependencies=[Depends(require_scope("avance:read"))],
)
async def list_riesgos_empresa(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str,
    severidad: str | None = None,
) -> list[RiesgoRead]:
    riesgos = await RiesgoRepository(db).list_for_empresa(empresa_codigo, severidad)
    return [RiesgoRead.model_validate(r) for r in riesgos]


@router.post(
    "/proyectos/{proyecto_id}/riesgos",
    response_model=RiesgoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("avance:create"))],
)
async def create_riesgo_proyecto(
    user: CurrentUser,
    db: DBSession,
    proyecto_id: int,
    body: RiesgoCreate,
) -> RiesgoRead:
    proyecto = await ProyectoRepository(db).get(proyecto_id)
    if proyecto is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Proyecto no encontrado"
        )
    # Forzar el proyecto_id de la URL y derivar empresa_codigo del proyecto
    body_with_proyecto = body.model_copy(update={"proyecto_id": proyecto_id})
    riesgo = await RiesgoRepository(db).create(
        body_with_proyecto, empresa_codigo_default=proyecto.empresa_codigo
    )
    await db.commit()
    return RiesgoRead.model_validate(riesgo)


@router.post(
    "/riesgos",
    response_model=RiesgoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("avance:create"))],
)
async def create_riesgo_empresa(
    user: CurrentUser,
    db: DBSession,
    body: RiesgoCreate,
) -> RiesgoRead:
    """Crear riesgo cross-proyecto (sólo empresa_codigo)."""
    if not body.empresa_codigo and body.proyecto_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Falta empresa_codigo o proyecto_id",
        )
    riesgo = await RiesgoRepository(db).create(body)
    await db.commit()
    return RiesgoRead.model_validate(riesgo)


@router.patch(
    "/riesgos/{riesgo_id}",
    response_model=RiesgoRead,
    dependencies=[Depends(require_scope("avance:update"))],
)
async def update_riesgo(
    user: CurrentUser,
    db: DBSession,
    riesgo_id: int,
    body: RiesgoUpdate,
) -> RiesgoRead:
    repo = RiesgoRepository(db)
    riesgo = await repo.get(riesgo_id)
    if riesgo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Riesgo no encontrado"
        )
    updated = await repo.update(riesgo, body)
    await db.commit()
    return RiesgoRead.model_validate(updated)


@router.delete(
    "/riesgos/{riesgo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("avance:delete"))],
)
async def delete_riesgo(
    user: CurrentUser,
    db: DBSession,
    riesgo_id: int,
) -> Response:
    repo = RiesgoRepository(db)
    riesgo = await repo.get(riesgo_id)
    if riesgo is not None:
        await repo.delete(riesgo)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Sync Roadmap.xlsx desde Dropbox
# ---------------------------------------------------------------------------


@router.get(
    "/{empresa_codigo}/sync-roadmap",
    response_model=SyncRoadmapResponse,
    dependencies=[Depends(require_scope("avance:create"))],
)
async def sync_roadmap(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str,
) -> SyncRoadmapResponse:
    """Detecta `/Cehta Capital/Proyectos/{codigo}/Roadmap.xlsx` y lo registra.

    Implementación mínima V3 fase 5: marca el path en el proyecto base
    (creándolo si no existe). El parsing detallado del Excel queda
    para fase posterior — acá garantizamos al menos visibilidad del path.
    """
    dbx = await _get_dropbox_service(db)
    if dbx is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dropbox no conectado — conectar en /admin/integraciones",
        )

    candidate_path = f"/Cehta Capital/Proyectos/{empresa_codigo}/Roadmap.xlsx"
    try:
        dbx.dbx.files_get_metadata(candidate_path)
        found = True
    except Exception:
        found = False

    if not found:
        return SyncRoadmapResponse(
            empresa_codigo=empresa_codigo,
            found=False,
            dropbox_path=None,
            message=(
                "No se encontró Roadmap.xlsx en Dropbox/Cehta Capital/"
                f"Proyectos/{empresa_codigo}/. Subilo manualmente y volvé a sincronizar."
            ),
        )

    # Si hay proyectos para la empresa, fija el path en el primero;
    # si no, crea un proyecto base con el roadmap.
    repo = ProyectoRepository(db)
    proyectos = await repo.list_for_empresa(empresa_codigo)
    if proyectos:
        for p in proyectos:
            if not p.dropbox_roadmap_path:
                p.dropbox_roadmap_path = candidate_path
                await db.flush()
        await db.commit()
        return SyncRoadmapResponse(
            empresa_codigo=empresa_codigo,
            found=True,
            dropbox_path=candidate_path,
            proyectos_creados=0,
            message="Roadmap detectado y vinculado al proyecto existente.",
        )

    new = await repo.create(
        ProyectoCreate(
            empresa_codigo=empresa_codigo,
            nombre=f"Roadmap {empresa_codigo}",
            descripcion="Proyecto importado desde Roadmap.xlsx en Dropbox.",
            dropbox_roadmap_path=candidate_path,
        )
    )
    await db.commit()
    return SyncRoadmapResponse(
        empresa_codigo=empresa_codigo,
        found=True,
        dropbox_path=new.dropbox_roadmap_path,
        proyectos_creados=1,
        message="Proyecto base creado a partir del Roadmap detectado.",
    )
