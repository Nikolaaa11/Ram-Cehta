"""Legal Vault endpoints (V3 fase 3+4) — bóveda documental por empresa.

Todos los endpoints son empresa-scoped: lecturas filtran por `empresa_codigo`
y mutaciones operan sobre `documento.empresa_codigo`. Documentos se suben a
Dropbox bajo `Cehta Capital/01-Empresas/{codigo}/03-Legal/{categoria}/`.
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
from app.infrastructure.repositories.legal_repository import (
    LegalRepository,
    compute_legal_folder,
)
from app.schemas.common import Page
from app.schemas.legal import (
    LegalAlert,
    LegalDocumentCreate,
    LegalDocumentListItem,
    LegalDocumentRead,
    LegalDocumentUpdate,
)
from app.services.dropbox_service import DropboxNotConfigured, DropboxService

router = APIRouter()

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB


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
# CRUD
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=Page[LegalDocumentListItem],
    dependencies=[Depends(require_scope("legal:read"))],
)
async def list_legal(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: Annotated[str | None, Query(min_length=1, max_length=64)] = None,
    categoria: str | None = None,
    estado: str | None = None,
    search: Annotated[str | None, Query(min_length=1, max_length=255)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> Page[LegalDocumentListItem]:
    repo = LegalRepository(db)
    items, total = await repo.list_with_alerts(
        empresa_codigo, categoria, estado, search, page, size
    )
    return Page.build(
        items=[LegalDocumentListItem.model_validate(i) for i in items],
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "",
    response_model=LegalDocumentRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:create"))],
)
async def create_legal(
    user: CurrentUser,
    db: DBSession,
    body: LegalDocumentCreate,
) -> LegalDocumentRead:
    repo = LegalRepository(db)
    doc = await repo.create(body, uploaded_by=user.sub)
    await db.commit()
    return LegalDocumentRead.model_validate(doc)


@router.get(
    "/alerts",
    response_model=list[LegalAlert],
    dependencies=[Depends(require_scope("legal:read"))],
)
async def alerts_legal(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str | None = None,
    dias: Annotated[int, Query(ge=0, le=365)] = 90,
) -> list[LegalAlert]:
    repo = LegalRepository(db)
    rows = await repo.alerts(empresa_codigo, dias)
    return [LegalAlert(**r) for r in rows]


@router.get(
    "/{documento_id}",
    response_model=LegalDocumentRead,
    dependencies=[Depends(require_scope("legal:read"))],
)
async def get_legal(
    user: CurrentUser,
    db: DBSession,
    documento_id: int,
) -> LegalDocumentRead:
    doc = await LegalRepository(db).get(documento_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado"
        )
    return LegalDocumentRead.model_validate(doc)


@router.patch(
    "/{documento_id}",
    response_model=LegalDocumentRead,
    dependencies=[Depends(require_scope("legal:update"))],
)
async def update_legal(
    user: CurrentUser,
    db: DBSession,
    documento_id: int,
    body: LegalDocumentUpdate,
) -> LegalDocumentRead:
    repo = LegalRepository(db)
    doc = await repo.get(documento_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado"
        )
    updated = await repo.update(doc, body)
    await db.commit()
    return LegalDocumentRead.model_validate(updated)


@router.delete(
    "/{documento_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("legal:delete"))],
)
async def delete_legal(
    user: CurrentUser,
    db: DBSession,
    documento_id: int,
) -> Response:
    """Soft delete: pasa el documento a estado=cancelado.

    No borramos físicamente para mantener trazabilidad legal.
    """
    repo = LegalRepository(db)
    doc = await repo.get(documento_id)
    if doc is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    await repo.soft_delete(doc)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Upload + download
# ---------------------------------------------------------------------------


@router.post(
    "/{documento_id}/upload",
    response_model=LegalDocumentRead,
    dependencies=[Depends(require_scope("legal:update"))],
)
async def upload_legal(
    user: CurrentUser,
    db: DBSession,
    documento_id: int,
    file: Annotated[UploadFile, File(...)],
    nombre_archivo: Annotated[str | None, Form()] = None,
) -> LegalDocumentRead:
    repo = LegalRepository(db)
    doc = await repo.get(documento_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado"
        )

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Archivo excede {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
        )
    fname = nombre_archivo or file.filename
    if not fname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archivo sin nombre",
        )

    dbx = await _get_dropbox_service(db)
    if dbx is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dropbox no conectado — conectar en /admin/integraciones",
        )

    folder = compute_legal_folder(doc.empresa_codigo, doc.categoria)
    dbx.ensure_folder_path(folder)
    dropbox_path = f"{folder}/{fname}"
    upload_result = dbx.upload_file(dropbox_path, content)

    updated = await repo.set_dropbox_path(doc, upload_result["path"])
    await db.commit()
    return LegalDocumentRead.model_validate(updated)


@router.get(
    "/{documento_id}/download",
    dependencies=[Depends(require_scope("legal:read"))],
)
async def download_legal(
    user: CurrentUser,
    db: DBSession,
    documento_id: int,
) -> RedirectResponse:
    doc = await LegalRepository(db).get(documento_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado"
        )
    if not doc.dropbox_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Documento sin archivo asociado",
        )
    dbx = await _get_dropbox_service(db)
    if dbx is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dropbox no conectado",
        )
    link = dbx.get_temporary_link(doc.dropbox_path)
    return RedirectResponse(url=link, status_code=302)
