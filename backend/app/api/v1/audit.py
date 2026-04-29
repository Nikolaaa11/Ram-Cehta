"""Endpoints de auditoría — admin only (`audit:read`).

Lecturas:
    * `audit.etl_runs` + `audit.rejected_rows` (trazabilidad ETL).
    * `audit.action_log` (per-action audit trail — V3 fase 8). La app
      lo escribe vía `app.services.audit_service.audit_log` (best-effort).
También expone `/data-quality`: reporte de issues operativos derivados.
"""
from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text

from app.api.deps import DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.infrastructure.repositories.audit_repository import AuditRepository
from app.schemas.audit import (
    DataQualityIssue,
    DataQualityReport,
    EtlRunRead,
    RejectedRowRead,
)
from app.schemas.audit_log import AuditLogList, AuditLogRead
from app.schemas.common import Page

router = APIRouter()


@router.get("/etl-runs", response_model=Page[EtlRunRead])
async def list_runs(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 20,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
) -> Page[EtlRunRead]:
    repo = AuditRepository(db)
    items, total = await repo.list_etl_runs(status=status_filter, page=page, size=size)
    return Page.build(
        items=[EtlRunRead.model_validate(r) for r in items],
        total=total,
        page=page,
        size=size,
    )


@router.get("/etl-runs/{run_id}", response_model=EtlRunRead)
async def get_run(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    run_id: str,
) -> EtlRunRead:
    repo = AuditRepository(db)
    run = await repo.get_etl_run(run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run no encontrada")
    return EtlRunRead.model_validate(run)


@router.get("/etl-runs/{run_id}/rejected-rows", response_model=Page[RejectedRowRead])
async def rejected_rows(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    run_id: str,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> Page[RejectedRowRead]:
    repo = AuditRepository(db)
    if (await repo.get_etl_run(run_id)) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run no encontrada")
    items, total = await repo.list_rejected_rows(run_id, page=page, size=size)
    return Page.build(
        items=[RejectedRowRead.model_validate(r) for r in items],
        total=total,
        page=page,
        size=size,
    )


@router.get("/data-quality", response_model=DataQualityReport)
async def data_quality(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
) -> DataQualityReport:
    """Reporte de issues operativos. Computa varios chequeos y los devuelve
    como lista de issues con severidad + count + descripción + recurso para
    drill-down desde la UI."""
    repo = AuditRepository(db)
    issues: list[DataQualityIssue] = []

    # 1) OCs emitidas hace > 30 días sin pago
    oc_old = await db.scalar(
        text(
            """
            SELECT COUNT(*) FROM core.ordenes_compra
            WHERE estado = 'emitida' AND fecha_emision < (current_date - INTERVAL '30 days')
            """
        )
    )
    if (oc_old or 0) > 0:
        issues.append(
            DataQualityIssue(
                code="oc_emitida_old",
                severity="warning",
                count=int(oc_old or 0),
                description="OCs emitidas hace más de 30 días sin estado 'pagada'",
                resource="/api/v1/ordenes-compra?estado=emitida",
            )
        )

    # 2) F29 vencidas sin pago
    f29_vencidas = await db.scalar(
        text(
            """
            SELECT COUNT(*) FROM core.f29_obligaciones
            WHERE estado IN ('pendiente','vencido')
              AND fecha_vencimiento < current_date
            """
        )
    )
    if (f29_vencidas or 0) > 0:
        issues.append(
            DataQualityIssue(
                code="f29_vencida_unpaid",
                severity="critical",
                count=int(f29_vencidas or 0),
                description="F29 vencidas sin pago (riesgo SII)",
                resource="/api/v1/f29?estado=vencido",
            )
        )

    # 3) Empresas sin movimientos en último periodo (heurística: últimos 60 días)
    empresas_sin_mov = await db.scalar(
        text(
            """
            SELECT COUNT(*) FROM core.empresas e
            WHERE e.activo = true
              AND NOT EXISTS (
                SELECT 1 FROM core.movimientos m
                WHERE m.empresa_codigo = e.codigo
                  AND m.fecha >= (current_date - INTERVAL '60 days')
              )
            """
        )
    )
    if (empresas_sin_mov or 0) > 0:
        issues.append(
            DataQualityIssue(
                code="empresa_sin_movimientos",
                severity="info",
                count=int(empresas_sin_mov or 0),
                description="Empresas activas sin movimientos en últimos 60 días",
                resource=None,
            )
        )

    # 4) Movimientos con saldo_contable null
    sin_saldo = await db.scalar(
        text("SELECT COUNT(*) FROM core.movimientos WHERE saldo_contable IS NULL")
    )
    if (sin_saldo or 0) > 0:
        issues.append(
            DataQualityIssue(
                code="movimiento_sin_saldo",
                severity="warning",
                count=int(sin_saldo or 0),
                description="Movimientos sin saldo contable (revisar conciliación)",
                resource="/api/v1/movimientos",
            )
        )

    # 5) Rejected rows del último run
    last_run_id = await repo.latest_run_id()
    if last_run_id:
        rejected = await db.scalar(
            text(
                "SELECT COUNT(*) FROM audit.rejected_rows WHERE run_id = :rid"
            ),
            {"rid": last_run_id},
        )
        if (rejected or 0) > 0:
            issues.append(
                DataQualityIssue(
                    code="rejected_rows_last_run",
                    severity="warning",
                    count=int(rejected or 0),
                    description="Filas rechazadas en la última corrida ETL",
                    resource=f"/api/v1/audit/etl-runs/{last_run_id}/rejected-rows",
                )
            )

    return DataQualityReport(generated_at=datetime.now(UTC), issues=issues)


# ---------------------------------------------------------------------
# Per-action audit trail — `audit.action_log` (V3 fase 8)
# ---------------------------------------------------------------------

_ACTION_LOG_LIST_COLS = (
    "id, user_id, user_email, action, entity_type, entity_id, "
    "entity_label, summary, ip, user_agent, created_at"
)
_ACTION_LOG_FULL_COLS = (
    "id, user_id, user_email, action, entity_type, entity_id, "
    "entity_label, summary, diff_before, diff_after, "
    "ip, user_agent, created_at"
)


@router.get("/actions", response_model=Page[AuditLogList])
async def list_actions(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 25,
    entity_type: str | None = None,
    entity_id: str | None = None,
    user_id: str | None = None,
    action: str | None = None,
    from_date: Annotated[date | None, Query(alias="from_date")] = None,
    to_date: Annotated[date | None, Query(alias="to_date")] = None,
) -> Page[AuditLogList]:
    """Listado paginado del audit trail (sin diffs, lighter)."""
    conds: list[str] = []
    params: dict = {}
    if entity_type:
        conds.append("entity_type = :entity_type")
        params["entity_type"] = entity_type
    if entity_id:
        conds.append("entity_id = :entity_id")
        params["entity_id"] = entity_id
    if user_id:
        conds.append("user_id = CAST(:user_id AS UUID)")
        params["user_id"] = user_id
    if action:
        conds.append("action = :action")
        params["action"] = action
    if from_date:
        conds.append("created_at >= :from_date")
        params["from_date"] = from_date
    if to_date:
        conds.append("created_at < (:to_date::date + INTERVAL '1 day')")
        params["to_date"] = to_date

    where = "WHERE " + " AND ".join(conds) if conds else ""
    params["limit"] = size
    params["offset"] = (page - 1) * size

    total = (
        await db.scalar(
            text(f"SELECT COUNT(*) FROM audit.action_log {where}"),  # noqa: S608
            params,
        )
    ) or 0

    rows = (
        await db.execute(
            text(
                f"SELECT {_ACTION_LOG_LIST_COLS} FROM audit.action_log "  # noqa: S608
                f"{where} ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
            ),
            params,
        )
    ).mappings().all()

    items = [AuditLogList.model_validate(dict(r)) for r in rows]
    return Page.build(items=items, total=total, page=page, size=size)


@router.get("/actions/{log_id}", response_model=AuditLogRead)
async def get_action(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    log_id: str,
) -> AuditLogRead:
    """Detalle completo de una entrada (incluye diffs)."""
    row = (
        await db.execute(
            text(
                f"SELECT {_ACTION_LOG_FULL_COLS} FROM audit.action_log "  # noqa: S608
                "WHERE id = CAST(:id AS UUID)"
            ),
            {"id": log_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Entrada de audit no encontrada"
        )
    return AuditLogRead.model_validate(dict(row))


@router.get(
    "/entity/{entity_type}/{entity_id}/history",
    response_model=Page[AuditLogList],
)
async def entity_history(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    entity_type: str,
    entity_id: str,
    page: Annotated[int, Query(ge=1)] = 1,
    size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> Page[AuditLogList]:
    """Historial completo de mutaciones para una entidad concreta."""
    params: dict = {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "limit": size,
        "offset": (page - 1) * size,
    }
    total = (
        await db.scalar(
            text(
                "SELECT COUNT(*) FROM audit.action_log "
                "WHERE entity_type = :entity_type AND entity_id = :entity_id"
            ),
            params,
        )
    ) or 0
    rows = (
        await db.execute(
            text(
                f"SELECT {_ACTION_LOG_LIST_COLS} FROM audit.action_log "  # noqa: S608
                "WHERE entity_type = :entity_type AND entity_id = :entity_id "
                "ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
            ),
            params,
        )
    ).mappings().all()
    items = [AuditLogList.model_validate(dict(r)) for r in rows]
    return Page.build(items=items, total=total, page=page, size=size)
