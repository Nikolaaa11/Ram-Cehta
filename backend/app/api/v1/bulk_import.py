"""Bulk CSV Import endpoints — V3 fase 11.

Two-step flow:
  POST /bulk-import/{entity}/dry-run   (multipart) → ValidationReport
  POST /bulk-import/{entity}/execute   (json)      → ImportResult

Constraints:
  * 5 MB tope.
  * MIME `text/csv` (también `application/vnd.ms-excel` → 415 si nada match
    aceptable; ver `_assert_csv`). El cliente DEBE setear el content-type
    correcto al subir.
  * Scope `{entity}:create` (per-entity).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import (
    APIRouter,
    File,
    HTTPException,
    Path,
    Request,
    UploadFile,
    status,
)

from app.api.deps import CurrentUser, DBSession
from app.schemas.bulk_import import (
    EntityType,
    ExecuteImportRequest,
    ImportResult,
    ValidationReport,
)
from app.services.audit_service import audit_log
from app.services.bulk_import_service import ENTITY_TYPES, BulkImportService

router = APIRouter()

MAX_BULK_BYTES = 5 * 1024 * 1024  # 5 MB

#: MIME aceptados. Excel guarda CSV como `text/csv` o sin tipo; algunos
#: browsers mandan `application/vnd.ms-excel` para .csv. Permitimos los
#: comunes y rechazamos el resto con 415.
_ACCEPTED_MIMES: frozenset[str] = frozenset(
    {
        "text/csv",
        "application/csv",
        "application/vnd.ms-excel",  # Edge / IE legacy
        "text/plain",  # algunos browsers Linux
    }
)

_ENTITY_SCOPE: dict[str, str] = {
    "trabajadores": "trabajador:create",
    "fondos": "fondo:create",
    "proveedores": "proveedor:create",
}


def _assert_csv(file: UploadFile) -> None:
    """Valida MIME — rechaza con 415 si no es CSV."""
    ct = (file.content_type or "").lower().split(";")[0].strip()
    if ct and ct not in _ACCEPTED_MIMES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Tipo no soportado: {ct}. Subí un .csv (text/csv).",
        )


def _validate_entity(entity_type: str) -> None:
    if entity_type not in ENTITY_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"entity_type inválido: {entity_type}. Soportados: {ENTITY_TYPES}",
        )


@router.post(
    "/{entity_type}/dry-run",
    response_model=ValidationReport,
)
async def dry_run(
    user: CurrentUser,
    db: DBSession,
    entity_type: Annotated[EntityType, Path(...)],
    file: Annotated[UploadFile, File(...)],
) -> ValidationReport:
    """Sube un CSV, valida y devuelve el report sin tocar DB.

    Scope check es per-entity (`{entity}:create`) — el dep estático no funciona
    porque el scope depende del path param.
    """
    _validate_entity(entity_type)
    scope = _ENTITY_SCOPE[entity_type]
    if not user.has_scope(scope):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Falta permiso: {scope}",
        )
    _assert_csv(file)

    content = await file.read()
    if len(content) > MAX_BULK_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Archivo excede {MAX_BULK_BYTES // (1024 * 1024)} MB",
        )

    service = BulkImportService(db)
    rows = service.parse_csv(content, entity_type)
    report = await service.validate_rows(rows, entity_type)
    return report


@router.post(
    "/{entity_type}/execute",
    response_model=ImportResult,
)
async def execute(
    user: CurrentUser,
    db: DBSession,
    request: Request,
    entity_type: Annotated[EntityType, Path(...)],
    body: ExecuteImportRequest,
) -> ImportResult:
    """Ejecuta el import — inserta filas validadas."""
    _validate_entity(entity_type)
    scope = _ENTITY_SCOPE[entity_type]
    if not user.has_scope(scope):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Falta permiso: {scope}",
        )

    service = BulkImportService(db)
    result = await service.execute_import(body.rows, entity_type, user.sub)
    await db.commit()

    audit_entity = (
        f"{entity_type[:-1]}_bulk"
        if entity_type.endswith("s")
        else f"{entity_type}_bulk"
    )
    await audit_log(
        db,
        request,
        user,
        action="bulk_import",
        entity_type=audit_entity,
        entity_id=entity_type,
        entity_label=entity_type,
        summary=(
            f"{result.created} created, {result.skipped} skipped, "
            f"{len(result.errors)} errors"
        ),
        before=None,
        after=result.model_dump(mode="json"),
    )
    return result
