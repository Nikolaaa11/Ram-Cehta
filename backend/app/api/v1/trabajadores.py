"""Trabajadores HR — CRUD + upload de documentos a Dropbox.

Todos los endpoints son **empresa-scoped**: se filtran por `empresa_codigo` en
query params (lista) o por `trabajador.empresa_codigo` (detalle/mutaciones).
Documentos se suben a `Cehta Capital/01-Empresas/{empresa}/02-Trabajadores/...`.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import RedirectResponse, Response

from app.api.deps import CurrentUser, DBSession, require_scope
from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)
from app.infrastructure.repositories.trabajador_repository import TrabajadorRepository
from app.schemas.common import Page
from app.schemas.trabajador import (
    MarkInactiveRequest,
    TipoDocumento,
    TrabajadorCreate,
    TrabajadorDocumentoRead,
    TrabajadorListItem,
    TrabajadorRead,
    TrabajadorUpdate,
)
from app.services.dropbox_service import DropboxNotConfigured, DropboxService
from app.services.dropbox_sync_service import DropboxSyncService
from app.services.trabajador_service import TrabajadorService

router = APIRouter()

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB


async def _build_service(
    db: DBSession,
) -> TrabajadorService:
    """Construye el service con el cliente Dropbox si está conectado."""
    repo = TrabajadorRepository(db)
    integration_repo = IntegrationRepository(db)
    integration = await integration_repo.get_by_provider("dropbox")
    dbx: DropboxService | None = None
    if integration is not None:
        try:
            dbx = DropboxService(
                access_token=integration.access_token,
                refresh_token=integration.refresh_token,
            )
        except DropboxNotConfigured:
            dbx = None
    return TrabajadorService(repo, dbx)


@router.get(
    "",
    response_model=Page[TrabajadorListItem],
    dependencies=[Depends(require_scope("trabajador:read"))],
)
async def list_trabajadores(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: Annotated[str, Query(min_length=1, max_length=64)],
    estado: Annotated[
        str | None, Query(pattern="^(activo|inactivo|licencia)$")
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> Page[TrabajadorListItem]:
    repo = TrabajadorRepository(db)
    items, total = await repo.list(empresa_codigo, estado, page, size)
    return Page.build(
        items=[TrabajadorListItem.model_validate(t) for t in items],
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "",
    response_model=TrabajadorRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("trabajador:create"))],
)
async def create_trabajador(
    user: CurrentUser,
    db: DBSession,
    body: TrabajadorCreate,
) -> TrabajadorRead:
    repo = TrabajadorRepository(db)
    existing = await repo.get_by_rut(body.empresa_codigo, body.rut)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"RUT {body.rut} ya existe en {body.empresa_codigo} (id={existing.trabajador_id})",
        )
    service = await _build_service(db)
    trabajador = await service.create_with_dropbox(body)
    await db.commit()
    return TrabajadorRead.model_validate(trabajador)


@router.get(
    "/{trabajador_id}",
    response_model=TrabajadorRead,
    dependencies=[Depends(require_scope("trabajador:read"))],
)
async def get_trabajador(
    user: CurrentUser,
    db: DBSession,
    trabajador_id: int,
) -> TrabajadorRead:
    repo = TrabajadorRepository(db)
    trabajador = await repo.get(trabajador_id)
    if trabajador is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trabajador no encontrado"
        )
    return TrabajadorRead.model_validate(trabajador)


@router.patch(
    "/{trabajador_id}",
    response_model=TrabajadorRead,
    dependencies=[Depends(require_scope("trabajador:update"))],
)
async def update_trabajador(
    user: CurrentUser,
    db: DBSession,
    trabajador_id: int,
    body: TrabajadorUpdate,
) -> TrabajadorRead:
    repo = TrabajadorRepository(db)
    trabajador = await repo.get(trabajador_id)
    if trabajador is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trabajador no encontrado"
        )
    updated = await repo.update(trabajador, body)
    await db.commit()
    return TrabajadorRead.model_validate(updated)


@router.post(
    "/{trabajador_id}/inactivar",
    response_model=TrabajadorRead,
    dependencies=[Depends(require_scope("trabajador:update"))],
)
async def mark_inactive(
    user: CurrentUser,
    db: DBSession,
    trabajador_id: int,
    body: MarkInactiveRequest,
) -> TrabajadorRead:
    repo = TrabajadorRepository(db)
    trabajador = await repo.get(trabajador_id)
    if trabajador is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trabajador no encontrado"
        )
    if trabajador.estado == "inactivo":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Trabajador ya está inactivo",
        )
    service = await _build_service(db)
    updated = await service.mark_inactive(trabajador, body.fecha_egreso)
    await db.commit()
    return TrabajadorRead.model_validate(updated)


@router.delete(
    "/{trabajador_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("trabajador:delete"))],
)
async def delete_trabajador(
    user: CurrentUser,
    db: DBSession,
    trabajador_id: int,
) -> Response:
    """Hard delete del trabajador (cascade borra documentos en DB).
    NOTA: NO borra los archivos de Dropbox — se conservan para histórico.
    """
    repo = TrabajadorRepository(db)
    trabajador = await repo.get(trabajador_id)
    if trabajador is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    await db.delete(trabajador)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Documentos
# ---------------------------------------------------------------------------


@router.post(
    "/{trabajador_id}/documentos",
    response_model=TrabajadorDocumentoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("trabajador:update"))],
)
async def upload_documento(
    user: CurrentUser,
    db: DBSession,
    trabajador_id: int,
    tipo: Annotated[TipoDocumento, Form(...)],
    file: Annotated[UploadFile, File(...)],
) -> TrabajadorDocumentoRead:
    repo = TrabajadorRepository(db)
    trabajador = await repo.get(trabajador_id)
    if trabajador is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Trabajador no encontrado"
        )

    # Leer + validar tamaño
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Archivo excede {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
        )
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archivo sin nombre",
        )

    service = await _build_service(db)
    try:
        doc = await service.upload_documento(
            trabajador,
            tipo=tipo,
            nombre_archivo=file.filename,
            content=content,
            uploaded_by=user.sub,
        )
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    await db.commit()
    return TrabajadorDocumentoRead.model_validate(doc)


@router.get(
    "/{trabajador_id}/documentos/{documento_id}/download",
    dependencies=[Depends(require_scope("trabajador:read"))],
)
async def download_documento(
    user: CurrentUser,
    db: DBSession,
    trabajador_id: int,
    documento_id: int,
) -> RedirectResponse:
    """Genera link temporal Dropbox y redirige el browser allí."""
    repo = TrabajadorRepository(db)
    doc = await repo.get_documento(trabajador_id, documento_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado"
        )
    service = await _build_service(db)
    try:
        link = await service.get_documento_temporary_link(doc)
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    return RedirectResponse(url=link, status_code=302)


@router.post(
    "/sync-dropbox/{empresa_codigo}",
    dependencies=[Depends(require_scope("trabajador:update"))],
)
async def sync_trabajadores_dropbox(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str,
) -> dict:
    """Escanea `Cehta Capital/01-Empresas/{empresa}/02-Trabajadores/Activos/`
    y reconcilia con la DB.

    Para cada subcarpeta con formato `RUT - Nombre`:
    - Si NO existe el trabajador en DB → lo crea con estado='activo'.
    - Para cada archivo dentro → si el `dropbox_path` no existe en DB,
      crea un `core.trabajador_documento` con `tipo` inferido del nombre.

    Idempotente: el match por `dropbox_path` evita duplicados al re-ejecutar.
    """
    integration_repo = IntegrationRepository(db)
    integration = await integration_repo.get_by_provider("dropbox")
    if integration is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dropbox no conectado — conectar en /admin/integraciones",
        )
    try:
        dbx = DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
    except DropboxNotConfigured as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc

    service = DropboxSyncService(db, dbx)
    result = await service.sync_trabajadores(empresa_codigo)
    await db.commit()
    return result.to_dict()


@router.delete(
    "/{trabajador_id}/documentos/{documento_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("trabajador:update"))],
)
async def delete_documento(
    user: CurrentUser,
    db: DBSession,
    trabajador_id: int,
    documento_id: int,
) -> Response:
    """Borra el registro DB. NO borra el archivo Dropbox — queda en histórico."""
    repo = TrabajadorRepository(db)
    doc = await repo.get_documento(trabajador_id, documento_id)
    if doc is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    await repo.delete_documento(doc)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
