"""Endpoints de Búsqueda de Fondos (V3 fase 5).

Listado paginado con filtros (tipo, estado, sector, search) + CRUD +
stats para KPIs del header. `import-from-dropbox` parsea LPs Pipeline.xlsx
si Dropbox está conectado (soft fail con 503 si no).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response

from app.api.deps import CurrentUser, DBSession, require_scope
from app.infrastructure.repositories.fondo_repository import FondoRepository
from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)
from app.schemas.common import Page
from app.schemas.fondo import (
    FondoCreate,
    FondoListItem,
    FondoRead,
    FondoStats,
    FondoUpdate,
    ImportFromDropboxResponse,
)
from app.services.dropbox_service import DropboxNotConfigured, DropboxService

router = APIRouter()

DROPBOX_LPS_PIPELINE = "/Cehta Capital/Fondos & Inversionistas/LPs Pipeline.xlsx"


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


@router.get(
    "",
    response_model=Page[FondoListItem],
    dependencies=[Depends(require_scope("fondo:read"))],
)
async def list_fondos(
    user: CurrentUser,
    db: DBSession,
    tipo: str | None = None,
    estado: str | None = None,
    sector: str | None = None,
    search: Annotated[str | None, Query(min_length=1, max_length=255)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> Page[FondoListItem]:
    repo = FondoRepository(db)
    items, total = await repo.list(tipo, estado, sector, search, page, size)
    return Page.build(
        items=[FondoListItem.model_validate(f) for f in items],
        total=total,
        page=page,
        size=size,
    )


@router.get(
    "/stats",
    response_model=FondoStats,
    dependencies=[Depends(require_scope("fondo:read"))],
)
async def fondos_stats(
    user: CurrentUser,
    db: DBSession,
) -> FondoStats:
    total, por_tipo, por_estado = await FondoRepository(db).stats()
    return FondoStats(total=total, por_tipo=por_tipo, por_estado=por_estado)


@router.post(
    "",
    response_model=FondoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("fondo:create"))],
)
async def create_fondo(
    user: CurrentUser,
    db: DBSession,
    body: FondoCreate,
) -> FondoRead:
    fondo = await FondoRepository(db).create(body)
    await db.commit()
    return FondoRead.model_validate(fondo)


@router.get(
    "/{fondo_id}",
    response_model=FondoRead,
    dependencies=[Depends(require_scope("fondo:read"))],
)
async def get_fondo(
    user: CurrentUser,
    db: DBSession,
    fondo_id: int,
) -> FondoRead:
    fondo = await FondoRepository(db).get(fondo_id)
    if fondo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Fondo no encontrado"
        )
    return FondoRead.model_validate(fondo)


@router.patch(
    "/{fondo_id}",
    response_model=FondoRead,
    dependencies=[Depends(require_scope("fondo:update"))],
)
async def update_fondo(
    user: CurrentUser,
    db: DBSession,
    fondo_id: int,
    body: FondoUpdate,
) -> FondoRead:
    repo = FondoRepository(db)
    fondo = await repo.get(fondo_id)
    if fondo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Fondo no encontrado"
        )
    updated = await repo.update(fondo, body)
    await db.commit()
    return FondoRead.model_validate(updated)


@router.delete(
    "/{fondo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("fondo:delete"))],
)
async def delete_fondo(
    user: CurrentUser,
    db: DBSession,
    fondo_id: int,
) -> Response:
    repo = FondoRepository(db)
    fondo = await repo.get(fondo_id)
    if fondo is not None:
        await repo.delete(fondo)
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/import-from-dropbox",
    response_model=ImportFromDropboxResponse,
    dependencies=[Depends(require_scope("fondo:create"))],
)
async def import_from_dropbox(
    user: CurrentUser,
    db: DBSession,
) -> ImportFromDropboxResponse:
    """Detecta `LPs Pipeline.xlsx` en Dropbox y lo deja accesible.

    En V3 fase 5 hacemos detection-only (no parseamos el Excel a fondos).
    El parsing detallado queda para fase posterior cuando exista una
    plantilla estandarizada del Excel. Acá garantizamos visibilidad del
    path para que el frontend pueda linkear al archivo.
    """
    dbx = await _get_dropbox_service(db)
    if dbx is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dropbox no conectado — conectar en /admin/integraciones",
        )

    try:
        dbx.dbx.files_get_metadata(DROPBOX_LPS_PIPELINE)
        return ImportFromDropboxResponse(
            found=True,
            dropbox_path=DROPBOX_LPS_PIPELINE,
            fondos_creados=0,
            fondos_actualizados=0,
            message=(
                "Archivo LPs Pipeline.xlsx detectado en Dropbox. El parser "
                "detallado se habilita en fase posterior; mientras tanto, "
                "podés crear fondos manualmente desde la UI."
            ),
        )
    except Exception:
        return ImportFromDropboxResponse(
            found=False,
            dropbox_path=None,
            message=(
                "No se encontró Dropbox/Cehta Capital/Fondos & Inversionistas/"
                "LPs Pipeline.xlsx — subilo y reintenta."
            ),
        )
