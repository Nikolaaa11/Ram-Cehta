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
    Request,
    UploadFile,
    status,
)
from fastapi.responses import RedirectResponse, Response

from app.api.deps import (
    CurrentUser,
    DBSession,
    current_admin_with_2fa,
    require_scope,
)
from app.core.logging import get_logger
from app.infrastructure.repositories.integration_repository import (
    IntegrationRepository,
)
from app.infrastructure.repositories.legal_repository import (
    LegalRepository,
    compute_legal_folder,
)
from app.infrastructure.repositories.legal_version_repository import (
    LegalVersionRepository,
)
from app.schemas.common import Page
from app.schemas.legal import (
    LegalAlert,
    LegalDocumentCreate,
    LegalDocumentListItem,
    LegalDocumentRead,
    LegalDocumentUpdate,
)
from app.schemas.legal_version import (
    LegalDocumentVersionCompareResponse,
    LegalDocumentVersionRead,
)
from app.services.audit_service import audit_log
from app.services.dropbox_service import DropboxNotConfigured, DropboxService
from app.services.dropbox_sync_service import DropboxSyncService
from app.services.legal_version_service import (
    build_change_summary,
    compute_diff,
)

router = APIRouter()
log = get_logger(__name__)


async def _try_snapshot(
    db: DBSession,
    *,
    documento_id: int,
    snapshot: dict,
    changed_by: str | None,
    change_summary: str | None,
) -> None:
    """Best-effort snapshot. Si falla, log warning y seguir — el audit log
    igual capturó el diff, así que no perdemos data.

    El caller decide cuándo commitear; acá sólo flush dentro del repo.
    """
    try:
        await LegalVersionRepository(db).create_snapshot(
            documento_id=documento_id,
            snapshot=snapshot,
            changed_by=changed_by,
            change_summary=change_summary,
        )
    except Exception as exc:  # pragma: no cover — defensivo
        log.warning(
            "legal_version_snapshot_failed",
            error=str(exc),
            documento_id=documento_id,
        )

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
    request: Request,
    body: LegalDocumentCreate,
) -> LegalDocumentRead:
    repo = LegalRepository(db)
    doc = await repo.create(body, uploaded_by=user.sub)
    await db.flush()
    created = LegalDocumentRead.model_validate(doc)
    snapshot = created.model_dump(mode="json")
    # Versión 1: snapshot inicial. Soft-fail.
    await _try_snapshot(
        db,
        documento_id=created.documento_id,
        snapshot=snapshot,
        changed_by=user.sub,
        change_summary=build_change_summary(None, snapshot),
    )
    await db.commit()
    await audit_log(
        db,
        request,
        user,
        action="create",
        entity_type="legal_document",
        entity_id=str(created.documento_id),
        entity_label=created.nombre,
        summary=f"Documento legal '{created.nombre}' creado para {body.empresa_codigo}",
        before=None,
        after=snapshot,
    )
    return created


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
    request: Request,
    documento_id: int,
    body: LegalDocumentUpdate,
) -> LegalDocumentRead:
    repo = LegalRepository(db)
    doc = await repo.get(documento_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado"
        )
    before = LegalDocumentRead.model_validate(doc).model_dump(mode="json")
    # Snapshot del estado ANTERIOR antes del update — versionamos el old.
    # El change_summary describe qué se va a cambiar (más útil en el
    # timeline que un diff entre versiones consecutivas).
    incoming = body.model_dump(exclude_unset=True)
    after_preview = {**before, **incoming} if incoming else before
    summary = build_change_summary(before, after_preview)
    await _try_snapshot(
        db,
        documento_id=documento_id,
        snapshot=before,
        changed_by=user.sub,
        change_summary=summary,
    )
    updated = await repo.update(doc, body)
    await db.commit()
    refreshed = LegalDocumentRead.model_validate(updated)
    await audit_log(
        db,
        request,
        user,
        action="update",
        entity_type="legal_document",
        entity_id=str(documento_id),
        entity_label=refreshed.nombre,
        summary=f"Documento legal '{refreshed.nombre}' editado",
        before=before,
        after=refreshed.model_dump(mode="json"),
    )
    return refreshed


@router.delete(
    "/{documento_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_scope("legal:delete"))],
)
async def delete_legal(
    user: CurrentUser,
    db: DBSession,
    request: Request,
    documento_id: int,
) -> Response:
    """Soft delete: pasa el documento a estado=cancelado.

    No borramos físicamente para mantener trazabilidad legal.
    """
    repo = LegalRepository(db)
    doc = await repo.get(documento_id)
    if doc is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    before = LegalDocumentRead.model_validate(doc).model_dump(mode="json")
    nombre = before.get("nombre")
    await repo.soft_delete(doc)
    await db.commit()
    await audit_log(
        db,
        request,
        user,
        action="delete",
        entity_type="legal_document",
        entity_id=str(documento_id),
        entity_label=nombre,
        summary=f"Documento legal '{nombre}' cancelado (soft-delete)",
        before=before,
        after={"estado": "cancelado"},
    )
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


@router.post(
    "/sync-dropbox/{empresa_codigo}",
    dependencies=[Depends(require_scope("legal:create"))],
)
async def sync_legal_dropbox(
    user: CurrentUser,
    db: DBSession,
    request: Request,
    empresa_codigo: str,
) -> dict:
    """Escanea `Cehta Capital/01-Empresas/{empresa}/03-Legal/` recursivamente
    y crea legal_documents para los archivos que aún no estén en DB.

    Categoría/subcategoría se inferen del path:
      Contratos/Cliente   → contrato/cliente
      Contratos/Proveedor → contrato/proveedor
      Contratos/Bancario  → contrato/bancario
      Actas               → acta
      Declaraciones SII/F29 → declaracion_sii/f29
      Pólizas             → poliza

    Idempotente: match por `dropbox_path`.
    """
    dbx = await _get_dropbox_service(db)
    if dbx is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dropbox no conectado — conectar en /admin/integraciones",
        )
    service = DropboxSyncService(db, dbx)
    result = await service.sync_legal(empresa_codigo)
    await db.commit()
    payload = result.to_dict()
    await audit_log(
        db,
        request,
        user,
        action="sync",
        entity_type="legal_batch",
        entity_id=empresa_codigo,
        entity_label=empresa_codigo,
        summary=f"Sync legal desde Dropbox para {empresa_codigo}",
        before=None,
        after=payload,
    )
    return payload


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


# ---------------------------------------------------------------------------
# Version history (V4 fase 3)
# ---------------------------------------------------------------------------


@router.get(
    "/{documento_id}/versions",
    response_model=list[LegalDocumentVersionRead],
    dependencies=[Depends(require_scope("legal:read"))],
)
async def list_legal_versions(
    user: CurrentUser,
    db: DBSession,
    documento_id: int,
) -> list[LegalDocumentVersionRead]:
    """Versiones del documento, más nueva primero."""
    doc = await LegalRepository(db).get(documento_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado"
        )
    versions = await LegalVersionRepository(db).list_for_document(documento_id)
    return [LegalDocumentVersionRead.model_validate(v) for v in versions]


@router.get(
    "/{documento_id}/versions/{version_number}",
    response_model=LegalDocumentVersionRead,
    dependencies=[Depends(require_scope("legal:read"))],
)
async def get_legal_version(
    user: CurrentUser,
    db: DBSession,
    documento_id: int,
    version_number: int,
) -> LegalDocumentVersionRead:
    version = await LegalVersionRepository(db).get_version(
        documento_id, version_number
    )
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Versión no encontrada"
        )
    return LegalDocumentVersionRead.model_validate(version)


@router.get(
    "/{documento_id}/versions/{version_number}/compare",
    response_model=LegalDocumentVersionCompareResponse,
    dependencies=[Depends(require_scope("legal:read"))],
)
async def compare_legal_version(
    user: CurrentUser,
    db: DBSession,
    documento_id: int,
    version_number: int,
) -> LegalDocumentVersionCompareResponse:
    """Compara una versión histórica contra el estado actual del documento."""
    doc = await LegalRepository(db).get(documento_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado"
        )
    version = await LegalVersionRepository(db).get_version(
        documento_id, version_number
    )
    if version is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Versión no encontrada"
        )
    current = LegalDocumentRead.model_validate(doc).model_dump(mode="json")
    return LegalDocumentVersionCompareResponse(
        version_a=version.snapshot,
        version_b=current,
        diff=compute_diff(version.snapshot, current),
    )


@router.post(
    "/{documento_id}/versions/{version_number}/restore",
    response_model=LegalDocumentRead,
    dependencies=[
        Depends(require_scope("audit:read")),
        Depends(current_admin_with_2fa),
    ],
)
async def restore_legal_version(
    user: CurrentUser,
    db: DBSession,
    request: Request,
    documento_id: int,
    version_number: int,
) -> LegalDocumentRead:
    """Restaura una versión histórica como estado actual.

    Forward-only: NO pisamos historia. El flujo es:
      1. Snapshot del estado actual → nueva versión.
      2. Aplicar valores del snapshot histórico al row actual.
      3. Snapshot del estado restaurado → otra nueva versión
         (para tener trazabilidad clara: "restauré a v5").

    Sólo admin con 2FA habilitado (high-impact, destructivo).
    """
    legal_repo = LegalRepository(db)
    version_repo = LegalVersionRepository(db)

    doc = await legal_repo.get(documento_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Documento no encontrado"
        )
    target = await version_repo.get_version(documento_id, version_number)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Versión no encontrada"
        )

    current = LegalDocumentRead.model_validate(doc).model_dump(mode="json")

    # Paso 1: snapshot del estado actual (antes del restore).
    await _try_snapshot(
        db,
        documento_id=documento_id,
        snapshot=current,
        changed_by=user.sub,
        change_summary=f"Pre-restore (volverá a v{version_number})",
    )

    # Paso 2: aplicar campos editables del snapshot histórico al doc actual.
    # NO restauramos timestamps ni IDs — sólo los campos que el usuario
    # puede editar via PATCH.
    editable_fields = {
        "categoria",
        "subcategoria",
        "nombre",
        "descripcion",
        "contraparte",
        "fecha_emision",
        "fecha_vigencia_desde",
        "fecha_vigencia_hasta",
        "monto",
        "moneda",
        "estado",
    }
    snap = target.snapshot or {}
    for field in editable_fields:
        if field in snap:
            setattr(doc, field, snap[field])
    await db.flush()
    await db.refresh(doc)

    refreshed = LegalDocumentRead.model_validate(doc)
    after = refreshed.model_dump(mode="json")

    # Paso 3: snapshot del estado restaurado para trazabilidad.
    await _try_snapshot(
        db,
        documento_id=documento_id,
        snapshot=after,
        changed_by=user.sub,
        change_summary=f"Restaurado desde v{version_number}",
    )

    await db.commit()

    await audit_log(
        db,
        request,
        user,
        action="update",
        entity_type="legal_document",
        entity_id=str(documento_id),
        entity_label=refreshed.nombre,
        summary=f"Documento legal '{refreshed.nombre}' restaurado a v{version_number}",
        before=current,
        after=after,
    )
    return refreshed
