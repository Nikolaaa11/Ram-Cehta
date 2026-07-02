"""Endpoints de exportación a Nubox (V5 Fase 3).

Flujo:
  1. POST /admin/nubox/export-batch?empresa=X&fecha_desde=Y&fecha_hasta=Z
       → genera CSV con vouchers APPROVED no exportados, persiste batch,
         marca vouchers como EXPORTED.
  2. GET /admin/nubox/export-batches/{id}/download
       → devuelve el CSV para descargar.
  3. GET /admin/nubox/export-batches
       → lista histórica de batches.
  4. POST /admin/nubox/export-batches/{id}/confirm
       → COO carga en Nubox, vuelve, ingresa folios → vouchers SYNCED.
  5. POST /admin/nubox/export-batches/{id}/cancel
       → descarta batch + libera vouchers para re-exportar.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.services.empresa_scope_service import (
    EmpresaScopeDep,
    assert_empresa_access,
)
from app.services.nubox_export_service import (
    NoVouchersToExportError,
    aggregate_batch_summary,
    confirm_batch_with_folios,
    create_export_batch,
    generate_csv,
    select_pending_vouchers,
)

router = APIRouter()


class NuboxBatchRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    batch_id: int
    empresa_codigo: str
    fecha_desde: date | None
    fecha_hasta: date | None
    voucher_count: int
    total_debit: Decimal
    total_credit: Decimal
    file_name: str
    file_format: str
    file_hash: str | None
    file_size_bytes: int | None
    status: str
    generated_by: str | None
    generated_at: datetime
    uploaded_at: datetime | None
    confirmed_at: datetime | None
    error_message: str | None
    notas: str | None


class GenerateBatchRequest(BaseModel):
    empresa_codigo: str = Field(min_length=2, max_length=20)
    fecha_desde: date | None = None
    fecha_hasta: date | None = None


class ConfirmBatchRequest(BaseModel):
    """COO ingresa los folios devueltos por Nubox tras cargar el CSV.

    Mapeo: codigo del voucher (CSL-2026-EGR-00001) → folio Nubox.
    """
    folios: dict[str, str] = Field(
        default_factory=dict,
        description="Map de voucher.codigo a folio Nubox. Si vacío, marca CONFIRMED sin folios.",
    )
    notas: str | None = Field(default=None, max_length=500)


class CancelBatchRequest(BaseModel):
    razon: str = Field(min_length=10, max_length=500)


_BATCH_COLS = (
    "batch_id, empresa_codigo, fecha_desde, fecha_hasta, voucher_count, "
    "total_debit, total_credit, file_name, file_format, file_hash, "
    "file_size_bytes, status, generated_by::text AS generated_by, "
    "generated_at, uploaded_at, confirmed_at, error_message, notas"
)


@router.get(
    "/admin/nubox/export-batches", response_model=list[NuboxBatchRead]
)
async def list_export_batches(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    empresa_codigo: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[NuboxBatchRead]:
    """V5++ ola CG security: aplica scope multi-tenant. Sin filtro, devuelve
    solo batches de las empresas que el user puede ver."""
    where_parts: list[str] = []
    params: dict[str, Any] = {"limit": limit}
    if empresa_codigo:
        await assert_empresa_access(user, db, empresa_codigo)
        where_parts.append("empresa_codigo = :e")
        params["e"] = empresa_codigo
    else:
        codes = scope.filter_codes(None)
        if codes is not None:
            if not codes:
                return []
            where_parts.append("empresa_codigo = ANY(CAST(:codes AS text[]))")
            params["codes"] = codes
    if status_filter:
        where_parts.append("status = :st")
        params["st"] = status_filter
    where_sql = " WHERE " + " AND ".join(where_parts) if where_parts else ""

    rows = (
        await db.execute(
            text(
                f"SELECT {_BATCH_COLS} FROM core.nubox_export_batches"
                f"{where_sql} ORDER BY generated_at DESC LIMIT :limit"
            ),
            params,
        )
    ).mappings().all()
    return [NuboxBatchRead.model_validate(dict(r)) for r in rows]


@router.get(
    "/admin/nubox/export-batches/{batch_id}", response_model=NuboxBatchRead
)
async def get_export_batch(
    user: CurrentUser, db: DBSession, batch_id: int
) -> NuboxBatchRead:
    row = (
        await db.execute(
            text(
                f"SELECT {_BATCH_COLS} FROM core.nubox_export_batches "
                "WHERE batch_id = :b"
            ),
            {"b": batch_id},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Batch no encontrado"
        )
    # V5++ ola CG security: scope check sobre la empresa del batch.
    await assert_empresa_access(user, db, row["empresa_codigo"])
    return NuboxBatchRead.model_validate(dict(row))


@router.post(
    "/admin/nubox/export-batch",
    response_model=NuboxBatchRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def create_export_batch_endpoint(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    body: GenerateBatchRequest,
) -> NuboxBatchRead:
    """Genera batch de exportación con vouchers APPROVED no exportados.

    V5++ ola CG security: scope check sobre `body.empresa_codigo`.
    """
    await assert_empresa_access(user, db, body.empresa_codigo)
    rows = await select_pending_vouchers(
        db,
        empresa_codigo=body.empresa_codigo,
        fecha_desde=body.fecha_desde,
        fecha_hasta=body.fecha_hasta,
    )
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"No hay vouchers APPROVED sin exportar para "
                f"{body.empresa_codigo} en ese rango. Aprobá vouchers primero "
                f"o ajustá las fechas."
            ),
        )

    try:
        csv_content = generate_csv(rows)
    except NoVouchersToExportError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    summary = aggregate_batch_summary(rows)
    batch_id = await create_export_batch(
        db,
        empresa_codigo=body.empresa_codigo,
        fecha_desde=body.fecha_desde,
        fecha_hasta=body.fecha_hasta,
        csv_content=csv_content,
        summary=summary,
        generated_by=str(user.sub),
    )
    await db.commit()
    return await get_export_batch(user, db, batch_id)


@router.get(
    "/admin/nubox/export-batches/{batch_id}/download",
    response_class=Response,
)
async def download_batch_csv(
    user: CurrentUser, db: DBSession, batch_id: int
) -> Response:
    """Re-genera el CSV de un batch para descarga.

    No persistimos el archivo en blob storage — lo regeneramos a partir
    de los vouchers que el batch agrupó. Esto garantiza que si los
    folios Nubox se asignaron, el CSV refleja el estado actual.
    """
    batch = (
        await db.execute(
            text(
                "SELECT batch_id, empresa_codigo, fecha_desde, fecha_hasta, "
                "       file_name, status "
                "FROM core.nubox_export_batches WHERE batch_id = :b"
            ),
            {"b": batch_id},
        )
    ).mappings().first()
    if batch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Batch no encontrado"
        )
    # V5++ ola CG security: scope check sobre la empresa del batch.
    await assert_empresa_access(user, db, batch["empresa_codigo"])

    # Re-fetch rows del batch (vouchers que estaban pending al generarlo)
    rows = (
        await db.execute(
            text(
                """
                SELECT
                    v.voucher_id,
                    v.codigo                AS voucher_codigo,
                    v.tipo                  AS voucher_tipo,
                    v.fecha_contable,
                    v.glosa,
                    v.contraparte_rut,
                    v.contraparte_nombre,
                    v.doc_tributario_tipo,
                    v.doc_tributario_folio,
                    vl.line_number,
                    vl.cuenta_codigo,
                    vl.proyecto_codigo,
                    vl.area_codigo,
                    vl.debit,
                    vl.credit,
                    vl.descripcion          AS linea_descripcion,
                    pc.nombre               AS cuenta_nombre,
                    COALESCE(pc.nubox_code, vl.cuenta_codigo) AS cuenta_nubox
                FROM core.nubox_export_voucher nev
                INNER JOIN core.vouchers v ON v.voucher_id = nev.voucher_id
                INNER JOIN core.voucher_lines vl ON vl.voucher_id = v.voucher_id
                INNER JOIN core.plan_cuentas pc ON pc.codigo = vl.cuenta_codigo
                WHERE nev.batch_id = :b
                ORDER BY v.fecha_contable, v.codigo, vl.line_number
                """
            ),
            {"b": batch_id},
        )
    ).mappings().all()

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="El batch no tiene vouchers asociados",
        )

    csv_content = generate_csv([dict(r) for r in rows])
    return Response(
        content=csv_content.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{batch["file_name"]}"',
        },
    )


@router.post(
    "/admin/nubox/export-batches/{batch_id}/confirm",
    response_model=NuboxBatchRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def confirm_batch(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    batch_id: int,
    body: ConfirmBatchRequest,
) -> NuboxBatchRead:
    """COO confirma carga en Nubox e ingresa folios devueltos.

    Si vienen folios, mapea cada voucher_codigo → folio_nubox y los marca
    como SYNCED. Si folios={} marca el batch como CONFIRMED sin trazar
    folios individuales (se puede asignar después por voucher).
    """
    batch = (
        await db.execute(
            text(
                "SELECT status, empresa_codigo FROM core.nubox_export_batches WHERE batch_id = :b"
            ),
            {"b": batch_id},
        )
    ).mappings().first()
    if batch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Batch no encontrado"
        )
    # V5++ ola CG security: scope check.
    await assert_empresa_access(user, db, batch["empresa_codigo"])
    if batch["status"] != "GENERATED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Batch en estado {batch['status']} no se puede confirmar",
        )

    updated_count = await confirm_batch_with_folios(
        db,
        batch_id=batch_id,
        folios=body.folios,
        confirmed_by=str(user.sub),
    )

    if body.notas:
        await db.execute(
            text(
                "UPDATE core.nubox_export_batches SET notas = :n "
                "WHERE batch_id = :b"
            ),
            {"n": body.notas, "b": batch_id},
        )

    await db.commit()
    return await get_export_batch(user, db, batch_id)


@router.post(
    "/admin/nubox/export-batches/{batch_id}/cancel",
    response_model=NuboxBatchRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def cancel_batch(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    batch_id: int,
    body: CancelBatchRequest,
) -> NuboxBatchRead:
    """Cancela el batch + libera vouchers para re-exportar.

    Útil si el COO se da cuenta que generó el batch con criterios mal
    (rango fechas equivocado, empresa equivocada). Los vouchers vuelven
    a APPROVED + nubox_status NULL.
    """
    batch = (
        await db.execute(
            text(
                "SELECT status, empresa_codigo FROM core.nubox_export_batches WHERE batch_id = :b"
            ),
            {"b": batch_id},
        )
    ).mappings().first()
    if batch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Batch no encontrado"
        )
    # R152UUUUUU — scope check: confirm_batch (ola CG) lo tenía, cancel no —
    # un usuario scopeado a otra empresa podía cancelar el batch por id y
    # liberar sus vouchers (nubox_status=NULL) forzando re-exportación.
    await assert_empresa_access(user, db, batch["empresa_codigo"])
    if batch["status"] not in ("GENERATED", "FAILED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Batch en estado {batch['status']} no se puede cancelar. "
                "Si ya está confirmado, los vouchers están sincronizados."
            ),
        )

    # Liberar vouchers: nubox_status = NULL para que vuelvan a aparecer
    # como pendientes para el próximo batch
    await db.execute(
        text(
            """
            UPDATE core.vouchers
            SET nubox_status = NULL, updated_at = now()
            WHERE voucher_id IN (
                SELECT voucher_id FROM core.nubox_export_voucher
                WHERE batch_id = :b
            )
            """
        ),
        {"b": batch_id},
    )

    await db.execute(
        text(
            """
            UPDATE core.nubox_export_batches
            SET status = 'CANCELLED', error_message = :msg
            WHERE batch_id = :b
            """
        ),
        {"b": batch_id, "msg": f"Cancelado: {body.razon}"},
    )
    await db.commit()
    return await get_export_batch(user, db, batch_id)
