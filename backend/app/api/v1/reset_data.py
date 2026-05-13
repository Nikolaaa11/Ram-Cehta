"""V5++ ola CD — Endpoints de reset/clear data por módulo.

Permiten al admin (o user con scope a empresa) borrar datos viejos antes
de re-importar/sincronizar. Cada endpoint:

  1. Requiere scope_check (no podés borrar data de empresa que no es tuya)
  2. Hace audit_log explícito (quién, cuándo, qué)
  3. Devuelve conteo de filas borradas
  4. Soft-fail si tablas no existen (migration pending)

Endpoints disponibles:

  POST /admin/reset/movimientos/{empresa_codigo}
       Body: { periodo_desde?, periodo_hasta?, confirm: true }

  POST /admin/reset/f29/{empresa_codigo}
       Body: { confirm: true }  → borra TODOS los F29 de esa empresa

  POST /admin/reset/f22/{empresa_codigo}
       Body: { confirm: true }

  POST /admin/reset/cartolas-runs/{empresa_codigo}
       Body: { confirm: true } → borra historial de runs (no los movimientos)

  POST /admin/reset/entregables
       Body: { categoria?, empresa_codigo?, confirm: true }

  POST /admin/reset/gantt/{empresa_codigo}
       Body: { confirm: true } → alias de DELETE /avance/{empresa}/import-excel/proyectos-importados

Solo accesible para admin global. Si necesitamos scoped (DIRECTOR puede
borrar Gantt de su empresa), agregar `assert_empresa_access`.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.services.audit_service import audit_log
from app.services.empresa_scope_service import assert_empresa_access

router = APIRouter()


# =============================================================================
# Schemas
# =============================================================================


class ResetConfirm(BaseModel):
    """Body para todos los endpoints reset.

    `confirm` debe ser True para que el server proceda. Esto evita resets
    accidentales por bots/curl mal escrito.
    """
    confirm: bool = Field(default=False, description="Debe ser True")


class ResetMovimientosBody(ResetConfirm):
    periodo_desde: str | None = Field(
        default=None, description="Filtro inclusivo. Ej '2026_01'"
    )
    periodo_hasta: str | None = Field(
        default=None, description="Filtro inclusivo. Ej '2026_06'"
    )


class ResetEntregablesBody(ResetConfirm):
    categoria: str | None = None
    empresa_codigo: str | None = None


class ResetResult(BaseModel):
    """Respuesta de cada endpoint reset."""
    rows_deleted: int
    detail: str


def _check_confirm(body: ResetConfirm) -> None:
    if not body.confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Falta confirm=true en el body (protección contra borrado accidental)",
        )


# =============================================================================
# /admin/reset/movimientos/{empresa_codigo}
# =============================================================================


@router.post(
    "/admin/reset/movimientos/{empresa_codigo}",
    response_model=ResetResult,
    dependencies=[Depends(require_scope("legal:delete"))],
)
async def reset_movimientos(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:delete"))],
    db: DBSession,
    request: Request,
    empresa_codigo: str,
    body: ResetMovimientosBody,
) -> ResetResult:
    """Borra movimientos bancarios de la empresa (opcionalmente filtrado por período).

    Útil cuando:
    - Importaste un ETL con datos errados y querés re-cargar.
    - El banco mandó cartolas duplicadas.

    NOTA: NO borra las cartolas_runs (que son el historial de sync). Solo
    los rows en core.movimientos.
    """
    _check_confirm(body)
    await assert_empresa_access(user, db, empresa_codigo)

    conds: list[str] = ["empresa_codigo = :emp"]
    params: dict = {"emp": empresa_codigo}
    if body.periodo_desde:
        conds.append("periodo >= :p_desde")
        params["p_desde"] = body.periodo_desde
    if body.periodo_hasta:
        conds.append("periodo <= :p_hasta")
        params["p_hasta"] = body.periodo_hasta

    where = " AND ".join(conds)
    res = await db.execute(
        text(f"DELETE FROM core.movimientos WHERE {where}"),  # noqa: S608
        params,
    )
    deleted = res.rowcount or 0
    await db.commit()

    desc = f"Borró {deleted} movimientos de {empresa_codigo}"
    if body.periodo_desde or body.periodo_hasta:
        desc += f" (período {body.periodo_desde or '*'} → {body.periodo_hasta or '*'})"
    await audit_log(
        db, request, user,
        action="delete",
        entity_type="movimientos_bulk",
        entity_id=empresa_codigo,
        entity_label=empresa_codigo,
        summary=desc,
        before=None,
        after={"rows_deleted": deleted},
    )
    return ResetResult(rows_deleted=deleted, detail=desc)


# =============================================================================
# /admin/reset/f29/{empresa_codigo}
# =============================================================================


@router.post(
    "/admin/reset/f29/{empresa_codigo}",
    response_model=ResetResult,
    dependencies=[Depends(require_scope("f29:create"))],
)
async def reset_f29(
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:create"))],
    db: DBSession,
    request: Request,
    empresa_codigo: str,
    body: ResetConfirm,
) -> ResetResult:
    """Borra TODOS los F29 de la empresa. Después podés re-sincronizar
    desde Dropbox con /f29/sync-dropbox/{codigo}."""
    _check_confirm(body)
    await assert_empresa_access(user, db, empresa_codigo)

    res = await db.execute(
        text("DELETE FROM core.f29_obligaciones WHERE empresa_codigo = :emp"),
        {"emp": empresa_codigo},
    )
    deleted = res.rowcount or 0
    await db.commit()

    desc = f"Borró {deleted} F29 de {empresa_codigo}"
    await audit_log(
        db, request, user,
        action="delete",
        entity_type="f29_bulk",
        entity_id=empresa_codigo,
        entity_label=empresa_codigo,
        summary=desc,
        before=None,
        after={"rows_deleted": deleted},
    )
    return ResetResult(rows_deleted=deleted, detail=desc)


# =============================================================================
# /admin/reset/f22/{empresa_codigo}
# =============================================================================


@router.post(
    "/admin/reset/f22/{empresa_codigo}",
    response_model=ResetResult,
    dependencies=[Depends(require_scope("f29:create"))],
)
async def reset_f22(
    user: Annotated[AuthenticatedUser, Depends(require_scope("f29:create"))],
    db: DBSession,
    request: Request,
    empresa_codigo: str,
    body: ResetConfirm,
) -> ResetResult:
    """Borra TODOS los F22 (declaraciones anuales) de la empresa."""
    _check_confirm(body)
    await assert_empresa_access(user, db, empresa_codigo)

    res = await db.execute(
        text("DELETE FROM core.f22_obligaciones WHERE empresa_codigo = :emp"),
        {"emp": empresa_codigo},
    )
    deleted = res.rowcount or 0
    await db.commit()

    desc = f"Borró {deleted} F22 de {empresa_codigo}"
    await audit_log(
        db, request, user,
        action="delete",
        entity_type="f22_bulk",
        entity_id=empresa_codigo,
        entity_label=empresa_codigo,
        summary=desc,
        before=None,
        after={"rows_deleted": deleted},
    )
    return ResetResult(rows_deleted=deleted, detail=desc)


# =============================================================================
# /admin/reset/cartolas-runs/{empresa_codigo}
# =============================================================================


@router.post(
    "/admin/reset/cartolas-runs/{empresa_codigo}",
    response_model=ResetResult,
    dependencies=[Depends(require_scope("legal:delete"))],
)
async def reset_cartolas_runs(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:delete"))],
    db: DBSession,
    request: Request,
    empresa_codigo: str,
    body: ResetConfirm,
) -> ResetResult:
    """Borra el historial de runs de sync de cartolas para esta empresa.

    NO borra los movimientos importados. Solo el log de qué archivos fueron
    procesados. Útil para forzar re-procesamiento de archivos que fueron
    skipped por hash duplicado.
    """
    _check_confirm(body)
    await assert_empresa_access(user, db, empresa_codigo)

    res = await db.execute(
        text(
            "DELETE FROM core.cartolas_runs WHERE empresa_codigo = :emp"
        ),
        {"emp": empresa_codigo},
    )
    deleted = res.rowcount or 0
    await db.commit()

    desc = f"Borró {deleted} runs de cartolas de {empresa_codigo}"
    await audit_log(
        db, request, user,
        action="delete",
        entity_type="cartolas_runs_bulk",
        entity_id=empresa_codigo,
        entity_label=empresa_codigo,
        summary=desc,
        before=None,
        after={"rows_deleted": deleted},
    )
    return ResetResult(rows_deleted=deleted, detail=desc)


# =============================================================================
# /admin/reset/entregables
# =============================================================================


@router.post(
    "/admin/reset/entregables",
    response_model=ResetResult,
    dependencies=[Depends(require_scope("audit:read"))],
)
async def reset_entregables(
    user: Annotated[AuthenticatedUser, Depends(require_scope("audit:read"))],
    db: DBSession,
    request: Request,
    body: ResetEntregablesBody,
) -> ResetResult:
    """Borra entregables filtrados. Si no se filtra, borra TODOS.

    Solo admin. Useful cuando se rehace el catálogo regulatorio entero.
    """
    _check_confirm(body)
    if body.empresa_codigo:
        await assert_empresa_access(user, db, body.empresa_codigo)

    conds: list[str] = []
    params: dict = {}
    if body.categoria:
        conds.append("categoria = :cat")
        params["cat"] = body.categoria
    if body.empresa_codigo:
        conds.append(
            "(subcategoria = :emp OR extra->>'empresa_codigo' = :emp)"
        )
        params["emp"] = body.empresa_codigo

    where = "WHERE " + " AND ".join(conds) if conds else ""

    res = await db.execute(
        text(f"DELETE FROM app.entregables_regulatorios {where}"),  # noqa: S608
        params,
    )
    deleted = res.rowcount or 0
    await db.commit()

    parts = []
    if body.categoria: parts.append(f"categoria={body.categoria}")
    if body.empresa_codigo: parts.append(f"empresa={body.empresa_codigo}")
    filtros = " · ".join(parts) if parts else "TODOS"
    desc = f"Borró {deleted} entregables (filtros: {filtros})"
    await audit_log(
        db, request, user,
        action="delete",
        entity_type="entregables_bulk",
        entity_id=body.empresa_codigo or "global",
        entity_label=body.empresa_codigo or "global",
        summary=desc,
        before=None,
        after={"rows_deleted": deleted, "filters": parts},
    )
    return ResetResult(rows_deleted=deleted, detail=desc)


# =============================================================================
# /admin/reset/gantt/{empresa_codigo}
# =============================================================================


@router.post(
    "/admin/reset/gantt/{empresa_codigo}",
    response_model=ResetResult,
    dependencies=[Depends(require_scope("avance:delete"))],
)
async def reset_gantt(
    user: Annotated[AuthenticatedUser, Depends(require_scope("avance:delete"))],
    db: DBSession,
    request: Request,
    empresa_codigo: str,
    body: ResetConfirm,
) -> ResetResult:
    """Borra los proyectos importados desde Excel (Gantt) de la empresa.

    Los proyectos creados manualmente (sin metadata_.codigo_excel) NO se tocan.
    Hitos asociados se borran en cascada.
    """
    _check_confirm(body)
    await assert_empresa_access(user, db, empresa_codigo)

    # Borrar solo los importados (los manuales no tienen metadata_.codigo_excel)
    res = await db.execute(
        text(
            """
            DELETE FROM core.proyectos_empresa
            WHERE empresa_codigo = :emp
              AND (metadata_->>'codigo_excel') IS NOT NULL
            """
        ),
        {"emp": empresa_codigo},
    )
    deleted = res.rowcount or 0
    await db.commit()

    desc = f"Borró {deleted} proyectos Gantt importados de {empresa_codigo}"
    await audit_log(
        db, request, user,
        action="delete",
        entity_type="gantt_proyectos_bulk",
        entity_id=empresa_codigo,
        entity_label=empresa_codigo,
        summary=desc,
        before=None,
        after={"rows_deleted": deleted},
    )
    return ResetResult(rows_deleted=deleted, detail=desc)
