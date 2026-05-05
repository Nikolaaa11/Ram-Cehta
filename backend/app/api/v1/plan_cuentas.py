"""Endpoints del Plan de Cuentas (V5).

Por ahora solo expone:
  - POST /admin/plan-cuentas/import (multipart .xlsx) — admin only
  - GET  /admin/plan-cuentas/summary — counters útiles para el botón "Importar"

Los CRUD completos del plan (árbol jerárquico, edición de cuenta,
activación por empresa) van en otro router cuando construyamos la UI
de gestión. Este archivo se enfoca en el flujo de importación.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.services.plan_cuentas_import_service import (
    PlanCuentasParseError,
    apply_to_db,
    build_summary,
    parse_xlsx_bytes,
)

router = APIRouter()


# Tamaño máximo del .xlsx (10 MB) — el plan completo pesa ~150 KB,
# 10 MB nos deja margen amplio sin permitir uploads abusivos.
MAX_XLSX_BYTES = 10 * 1024 * 1024
ALLOWED_EXTENSIONS = (".xlsx", ".xls")


class ImportPlanCuentasReport(BaseModel):
    """Respuesta del endpoint de import — resumen + counters DB."""

    summary: dict[str, Any]
    counters: dict[str, int]
    file_name: str
    file_size_bytes: int


class PlanCuentasSummary(BaseModel):
    """Estado actual del plan de cuentas en DB."""

    total_cuentas: int
    cuentas_imputables: int
    cuentas_corfo: int
    habilitaciones_total: int
    last_imported: str | None  # max(updated_at)


@router.get("/admin/plan-cuentas/summary", response_model=PlanCuentasSummary)
async def plan_cuentas_summary(
    user: CurrentUser,
    db: DBSession,
) -> PlanCuentasSummary:
    """Estado actual del plan de cuentas en DB.

    Usado por la UI antes/después del import para mostrar "tienes X
    cuentas cargadas, último import: ...". No requiere scope adicional
    porque solo expone counts agregados.
    """
    row = (
        await db.execute(
            text(
                """
                SELECT
                    COUNT(*)                                          AS total,
                    COUNT(*) FILTER (WHERE imputable)                 AS imputables,
                    COUNT(*) FILTER (WHERE corfo_elegible)            AS corfo,
                    MAX(updated_at)                                   AS last_updated
                FROM core.plan_cuentas
                """
            )
        )
    ).mappings().one()

    habilitaciones_total = (
        await db.scalar(
            text(
                "SELECT COUNT(*) FROM core.plan_cuenta_empresa "
                "WHERE habilitada = TRUE"
            )
        )
    ) or 0

    return PlanCuentasSummary(
        total_cuentas=row["total"] or 0,
        cuentas_imputables=row["imputables"] or 0,
        cuentas_corfo=row["corfo"] or 0,
        habilitaciones_total=habilitaciones_total,
        last_imported=row["last_updated"].isoformat() if row["last_updated"] else None,
    )


@router.post(
    "/admin/plan-cuentas/import",
    response_model=ImportPlanCuentasReport,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def import_plan_cuentas(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    file: UploadFile = File(..., description="Plan_de_cuentas_v2.xlsx"),
) -> ImportPlanCuentasReport:
    """Importa el plan de cuentas desde un .xlsx subido.

    Idempotente: re-correr con el mismo archivo no duplica nada (UPSERT
    por código de cuenta). Útil cuando el COO actualiza el Excel y
    quiere re-sincronizar la DB con el archivo más reciente.

    Validaciones:
      - Extensión .xlsx / .xls
      - Tamaño máximo 10 MB
      - Estructura del Excel: hoja `PlanDeCuentas` con las 31 columnas esperadas
      - Cuentas se insertan en orden por nivel (1→4) para respetar FK
      - Habilitaciones por empresa solo crean si la empresa existe en `core.empresas`
        (ej: si CENERGY no estuviera en DB, las suyas se omiten silenciosamente)
    """
    # Validaciones rápidas
    if not file.filename or not file.filename.lower().endswith(ALLOWED_EXTENSIONS):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El archivo debe ser .xlsx o .xls. Recibido: {file.filename}",
        )

    contents = await file.read()
    if len(contents) > MAX_XLSX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"El archivo excede {MAX_XLSX_BYTES // (1024 * 1024)} MB",
        )
    if len(contents) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archivo vacío",
        )

    # Parse
    try:
        cuentas, habilitaciones = parse_xlsx_bytes(contents)
    except PlanCuentasParseError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Estructura del Excel inválida: {exc}",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se pudo leer el .xlsx: {exc}",
        ) from exc

    summary = build_summary(cuentas, habilitaciones)

    # Apply
    try:
        counters = await apply_to_db(db, cuentas, habilitaciones)
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error escribiendo a la DB: {exc}",
        ) from exc

    return ImportPlanCuentasReport(
        summary=summary,
        counters=counters,
        file_name=file.filename,
        file_size_bytes=len(contents),
    )
