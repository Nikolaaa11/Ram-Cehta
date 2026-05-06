"""Cartolas Bancarias API — OCR + sync de PDFs Dropbox a core.movimientos.

Endpoints:
  POST /cartolas/sync/{empresa_codigo}     — manual trigger
  GET  /cartolas/runs                      — lista runs con filtros
  GET  /cartolas/runs/{run_id}             — detalle del run

Scope: integration:write (admin) para sync, audit:read para ver runs.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.services.cartolas_sync_service import sync_cartolas_for_empresa

router = APIRouter()


class CartolasSyncResponse(BaseModel):
    files_seen: int
    files_skipped: int
    files_imported: int
    files_failed_parse: int
    files_failed_ocr_required: int
    movimientos_inserted: int
    movimientos_skipped: int
    errors: list[str] = []


class CartolaRunRead(BaseModel):
    run_id: int
    empresa_codigo: str
    dropbox_path: str
    file_hash: str
    file_size_bytes: int | None
    banco_detectado: str | None
    periodo_desde: str | None
    periodo_hasta: str | None
    status: str
    rows_extracted: int
    rows_inserted: int
    rows_skipped: int
    error_message: str | None
    triggered_by: str | None
    triggered_at: datetime
    finished_at: datetime | None


@router.post(
    "/cartolas/sync/{empresa_codigo}",
    response_model=CartolasSyncResponse,
)
async def sync_cartolas(
    empresa_codigo: str,
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("integration:write"))
    ],
    db: DBSession,
) -> CartolasSyncResponse:
    """Procesa todos los PDFs de cartolas en Dropbox para la empresa.

    Idempotente: PDFs ya procesados (file_hash conocido) se skipean.
    Soft-fail por archivo: errores individuales no abortan el run.

    El servicio inserta filas en core.movimientos con `fuente='cartola_pdf'`
    para distinguirlas del ETL de Excel madre.
    """
    result = await sync_cartolas_for_empresa(
        db, empresa_codigo, triggered_by=str(user.sub)
    )
    return CartolasSyncResponse(**result)


@router.get(
    "/cartolas/runs",
    response_model=list[CartolaRunRead],
)
async def list_cartolas_runs(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[CartolaRunRead]:
    """Lista los runs de cartolas. Útil para auditar qué PDFs se procesaron
    y cuáles fallaron (PDF escaneado, banco desconocido, etc.).
    """
    where: list[str] = []
    params: dict = {"lim": limit}
    if empresa_codigo:
        where.append("empresa_codigo = :emp")
        params["emp"] = empresa_codigo
    if status_filter:
        where.append("status = :st")
        params["st"] = status_filter
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    rows = (
        await db.execute(
            text(
                f"""
                SELECT
                    run_id, empresa_codigo, dropbox_path, file_hash,
                    file_size_bytes, banco_detectado,
                    periodo_desde::text, periodo_hasta::text,
                    status, rows_extracted, rows_inserted, rows_skipped,
                    error_message, triggered_by, triggered_at, finished_at
                FROM core.cartolas_runs
                {where_sql}
                ORDER BY triggered_at DESC
                LIMIT :lim
                """
            ),
            params,
        )
    ).mappings().all()

    return [CartolaRunRead.model_validate(dict(r)) for r in rows]


@router.get(
    "/cartolas/runs/{run_id}",
    response_model=CartolaRunRead,
)
async def get_cartola_run(
    run_id: int,
    user: CurrentUser,
    db: DBSession,
) -> CartolaRunRead:
    """Detalle de un run específico."""
    row = (
        await db.execute(
            text(
                """
                SELECT
                    run_id, empresa_codigo, dropbox_path, file_hash,
                    file_size_bytes, banco_detectado,
                    periodo_desde::text, periodo_hasta::text,
                    status, rows_extracted, rows_inserted, rows_skipped,
                    error_message, triggered_by, triggered_at, finished_at
                FROM core.cartolas_runs
                WHERE run_id = :id
                """
            ),
            {"id": run_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run {run_id} no encontrado",
        )
    return CartolaRunRead.model_validate(dict(row))
