"""Endpoints del Plan de Cuentas (V5).

Expone:
  - POST /admin/plan-cuentas/import   (multipart .xlsx) — legal:write
  - GET  /admin/plan-cuentas/summary  (counters)
  - GET  /plan-cuentas                (lista flat con filtros)
  - GET  /plan-cuentas/tree           (árbol jerárquico 4 niveles)
  - GET  /plan-cuentas/{codigo}       (detalle de una cuenta)
  - PATCH /plan-cuentas/{codigo}      (activar/desactivar, marcar CORFO,
                                        actualizar nubox_code) — legal:write
  - GET  /plan-cuentas/{codigo}/empresas (qué empresas tienen habilitada esta cuenta)
  - PATCH /plan-cuentas/{codigo}/empresas/{empresa} (habilitar/deshabilitar)

Los CRUD destructivos (DELETE de una cuenta del plan) NO se exponen por
diseño — el plan se gestiona via re-import del Excel actualizado.
"""
from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.services.empresa_scope_service import assert_empresa_access
from app.services.plan_cuentas_import_service import (
    PlanCuentasParseError,
    apply_to_db,
    build_summary,
    parse_xlsx_bytes,
)

router = APIRouter()


# =====================================================================
# Schemas para los endpoints de lectura del plan
# =====================================================================


CuentaTipo = Literal[
    "ACTIVO", "PASIVO", "PATRIMONIO", "INGRESO", "GASTO", "RESULTADO", "ORDEN"
]
TipoGastoCorfo = Literal[
    "RRHH", "OPERACION", "INVERSION", "GASTOS_GENERALES", "NO_ELEGIBLE"
]


class PlanCuentaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    codigo: str
    nivel: int
    tipo: CuentaTipo
    nombre: str
    descripcion: str | None
    codigo_padre: str | None
    imputable: bool
    iva_tratamiento: str
    corfo_elegible: bool
    tipo_gasto_corfo: TipoGastoCorfo | None
    nubox_code: str | None
    codigo_f22: int | None
    ajuste_14d: str | None
    flag_caja: bool
    flag_activo_fijo: bool
    flag_documento: bool
    flag_control_gestion: bool
    flag_partida: bool
    flag_concepto: bool
    flag_capital: bool
    flag_activo_neto: bool
    flag_marca_14d: bool
    flag_percepcion: bool
    activa: bool


class PlanCuentaTreeNode(BaseModel):
    """Nodo del árbol jerárquico — recursivo via children."""

    codigo: str
    nivel: int
    tipo: CuentaTipo
    nombre: str
    imputable: bool
    activa: bool
    corfo_elegible: bool
    children: list["PlanCuentaTreeNode"] = Field(default_factory=list)


class PlanCuentaUpdate(BaseModel):
    """PATCH /plan-cuentas/{codigo} — campos editables.

    Estructura (codigo, nivel, padre) NO se edita — viene del Excel y se
    actualiza via re-import. Acá solo cosas que el COO puede tocar:
    desactivar, marcar CORFO post-hoc, actualizar nubox_code.
    """

    activa: bool | None = None
    corfo_elegible: bool | None = None
    tipo_gasto_corfo: TipoGastoCorfo | None = None
    nubox_code: str | None = Field(default=None, max_length=20)
    descripcion: str | None = Field(default=None, max_length=500)


class PlanCuentaEmpresaUpdate(BaseModel):
    habilitada: bool
    notas: str | None = Field(default=None, max_length=200)


class PlanCuentaEmpresaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    cuenta_codigo: str
    empresa_codigo: str
    habilitada: bool
    notas: str | None


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

    # Parse las 3 secciones (cuentas + proyectos + áreas)
    try:
        payload = parse_xlsx_bytes(contents)
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

    summary = build_summary(payload)

    # Apply en una sola transacción
    try:
        counters = await apply_to_db(db, payload)
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


# =====================================================================
# GET /plan-cuentas — lista flat con filtros
# =====================================================================


_PLAN_COLS = (
    "codigo, nivel, tipo, nombre, descripcion, codigo_padre, imputable, "
    "iva_tratamiento, corfo_elegible, tipo_gasto_corfo, nubox_code, "
    "codigo_f22, ajuste_14d, "
    "flag_caja, flag_activo_fijo, flag_documento, flag_control_gestion, "
    "flag_partida, flag_concepto, flag_capital, flag_activo_neto, "
    "flag_marca_14d, flag_percepcion, activa"
)


_PLAN_CACHE_HEADER = "private, max-age=300, stale-while-revalidate=60"


@router.get("/plan-cuentas", response_model=list[PlanCuentaRead])
async def list_plan_cuentas(
    user: CurrentUser,
    db: DBSession,
    response: Response,
    nivel: int | None = Query(default=None, ge=1, le=4),
    tipo: CuentaTipo | None = Query(default=None),
    imputable: bool | None = Query(default=None),
    corfo_elegible: bool | None = Query(default=None),
    activa: bool | None = Query(default=None),
    empresa_codigo: str | None = Query(
        default=None,
        description="Si se pasa, solo devuelve cuentas habilitadas para esa empresa",
    ),
    search: str | None = Query(
        default=None, max_length=100,
        description="Busca en codigo y nombre (case-insensitive)",
    ),
) -> list[PlanCuentaRead]:
    """Lista flat del plan de cuentas con filtros típicos.

    Si `empresa_codigo` se pasa, JOIN con `plan_cuenta_empresa` para filtrar
    solo las habilitadas. Útil para los selectores del form de voucher
    (mostrar solo cuentas que aplican a la empresa del voucher).

    V5++ ola CG security: si el filtro `empresa_codigo` viene, validamos
    que el user tenga acceso. Sin esto, un user scoped a empresa A podía
    listar las cuentas habilitadas para empresa B (cross-tenant leak).

    V5++ ola CG perf: cache 5 min — el plan de cuentas cambia cuando se
    re-importa el Excel, rara vez en operación normal.
    """
    response.headers["Cache-Control"] = _PLAN_CACHE_HEADER
    if empresa_codigo:
        await assert_empresa_access(user, db, empresa_codigo)

    where_parts: list[str] = []
    params: dict[str, Any] = {}

    if nivel is not None:
        where_parts.append("c.nivel = :nivel")
        params["nivel"] = nivel
    if tipo is not None:
        where_parts.append("c.tipo = :tipo")
        params["tipo"] = tipo
    if imputable is not None:
        where_parts.append("c.imputable = :imputable")
        params["imputable"] = imputable
    if corfo_elegible is not None:
        where_parts.append("c.corfo_elegible = :corfo_elegible")
        params["corfo_elegible"] = corfo_elegible
    if activa is not None:
        where_parts.append("c.activa = :activa")
        params["activa"] = activa
    if search:
        where_parts.append("(c.codigo ILIKE :s OR c.nombre ILIKE :s)")
        params["s"] = f"%{search}%"

    join_clause = ""
    if empresa_codigo:
        join_clause = (
            " INNER JOIN core.plan_cuenta_empresa pce "
            "   ON pce.cuenta_codigo = c.codigo "
            "   AND pce.empresa_codigo = :empresa "
            "   AND pce.habilitada = TRUE"
        )
        params["empresa"] = empresa_codigo

    where_sql = " WHERE " + " AND ".join(where_parts) if where_parts else ""

    rows = (
        await db.execute(
            text(
                f"SELECT {_PLAN_COLS} FROM core.plan_cuentas c"
                f"{join_clause}"
                f"{where_sql}"
                " ORDER BY c.codigo ASC"
            ),
            params,
        )
    ).mappings().all()

    return [PlanCuentaRead.model_validate(dict(r)) for r in rows]


# =====================================================================
# GET /plan-cuentas/tree — árbol jerárquico 4 niveles
# =====================================================================


@router.get("/plan-cuentas/tree", response_model=list[PlanCuentaTreeNode])
async def plan_cuentas_tree(
    user: CurrentUser,
    db: DBSession,
    response: Response,
    empresa_codigo: str | None = Query(default=None),
    only_active: bool = Query(default=True),
) -> list[PlanCuentaTreeNode]:
    """Devuelve el plan como árbol con 4 niveles anidados.

    Útil para el componente `PlanCuentasTree` de la UI. Performance: una
    sola query trae todas las cuentas; el armado del árbol es O(n) en
    Python.

    V5++ ola CG security: si filtro `empresa_codigo` viene, scope check.
    V5++ ola CG perf: cache 5 min.
    """
    response.headers["Cache-Control"] = _PLAN_CACHE_HEADER
    if empresa_codigo:
        await assert_empresa_access(user, db, empresa_codigo)

    join_clause = ""
    params: dict[str, Any] = {}
    where_parts: list[str] = []
    if empresa_codigo:
        join_clause = (
            " INNER JOIN core.plan_cuenta_empresa pce "
            "   ON pce.cuenta_codigo = c.codigo "
            "   AND pce.empresa_codigo = :empresa "
            "   AND pce.habilitada = TRUE"
        )
        params["empresa"] = empresa_codigo
    if only_active:
        where_parts.append("c.activa = TRUE")

    where_sql = " WHERE " + " AND ".join(where_parts) if where_parts else ""

    rows = (
        await db.execute(
            text(
                "SELECT c.codigo, c.nivel, c.tipo, c.nombre, c.imputable, "
                "       c.activa, c.corfo_elegible, c.codigo_padre "
                "FROM core.plan_cuentas c"
                f"{join_clause}"
                f"{where_sql}"
                " ORDER BY c.codigo ASC"
            ),
            params,
        )
    ).mappings().all()

    # Build tree
    nodes: dict[str, PlanCuentaTreeNode] = {
        r["codigo"]: PlanCuentaTreeNode(
            codigo=r["codigo"],
            nivel=r["nivel"],
            tipo=r["tipo"],
            nombre=r["nombre"],
            imputable=r["imputable"],
            activa=r["activa"],
            corfo_elegible=r["corfo_elegible"],
            children=[],
        )
        for r in rows
    }

    roots: list[PlanCuentaTreeNode] = []
    for r in rows:
        node = nodes[r["codigo"]]
        if r["codigo_padre"] and r["codigo_padre"] in nodes:
            nodes[r["codigo_padre"]].children.append(node)
        else:
            roots.append(node)

    return roots


# =====================================================================
# GET /plan-cuentas/{codigo} — detalle
# =====================================================================


@router.get("/plan-cuentas/{codigo}", response_model=PlanCuentaRead)
async def get_plan_cuenta(
    user: CurrentUser, db: DBSession, codigo: str
) -> PlanCuentaRead:
    row = (
        await db.execute(
            text(f"SELECT {_PLAN_COLS} FROM core.plan_cuentas WHERE codigo = :c"),
            {"c": codigo},
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cuenta {codigo} no encontrada",
        )
    return PlanCuentaRead.model_validate(dict(row))


# =====================================================================
# PATCH /plan-cuentas/{codigo} — editar campos no estructurales
# =====================================================================


@router.patch(
    "/plan-cuentas/{codigo}",
    response_model=PlanCuentaRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def update_plan_cuenta(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    codigo: str,
    body: PlanCuentaUpdate,
) -> PlanCuentaRead:
    update_data = body.model_dump(exclude_unset=True)
    if not update_data:
        # Nada que actualizar — devolver el actual
        return await get_plan_cuenta(user, db, codigo)

    set_clauses = ", ".join(f"{k} = :{k}" for k in update_data)
    update_data["codigo"] = codigo
    res = await db.execute(
        text(
            f"UPDATE core.plan_cuentas SET {set_clauses}, updated_at = now() "
            "WHERE codigo = :codigo"
        ),
        update_data,
    )
    if res.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Cuenta {codigo} no encontrada",
        )
    await db.commit()
    return await get_plan_cuenta(user, db, codigo)


# =====================================================================
# Habilitación por empresa
# =====================================================================


@router.get(
    "/plan-cuentas/{codigo}/empresas",
    response_model=list[PlanCuentaEmpresaRead],
)
async def list_cuenta_empresas(
    user: CurrentUser, db: DBSession, codigo: str
) -> list[PlanCuentaEmpresaRead]:
    """Lista las empresas que tienen habilitada esta cuenta."""
    rows = (
        await db.execute(
            text(
                "SELECT cuenta_codigo, empresa_codigo, habilitada, notas "
                "FROM core.plan_cuenta_empresa "
                "WHERE cuenta_codigo = :c "
                "ORDER BY empresa_codigo"
            ),
            {"c": codigo},
        )
    ).mappings().all()
    return [PlanCuentaEmpresaRead.model_validate(dict(r)) for r in rows]


@router.patch(
    "/plan-cuentas/{codigo}/empresas/{empresa_codigo}",
    response_model=PlanCuentaEmpresaRead,
    dependencies=[Depends(require_scope("legal:write"))],
)
async def toggle_cuenta_empresa(
    user: Annotated[AuthenticatedUser, Depends(require_scope("legal:write"))],
    db: DBSession,
    codigo: str,
    empresa_codigo: str,
    body: PlanCuentaEmpresaUpdate,
) -> PlanCuentaEmpresaRead:
    """Habilita o deshabilita una cuenta para una empresa específica.

    V5++ ola CG security: scope check sobre `empresa_codigo`. Sin esto, un
    user con `legal:write` pero scoped a empresa A podía manipular cuentas
    habilitadas en empresa B.
    """
    await assert_empresa_access(user, db, empresa_codigo)
    await db.execute(
        text(
            """
            INSERT INTO core.plan_cuenta_empresa (
                cuenta_codigo, empresa_codigo, habilitada, notas, habilitada_por
            )
            VALUES (:c, :e, :h, :n, CAST(:by AS UUID))
            ON CONFLICT (cuenta_codigo, empresa_codigo) DO UPDATE
                SET habilitada = EXCLUDED.habilitada,
                    notas = EXCLUDED.notas,
                    habilitada_en = now(),
                    habilitada_por = EXCLUDED.habilitada_por
            """
        ),
        {
            "c": codigo,
            "e": empresa_codigo,
            "h": body.habilitada,
            "n": body.notas,
            "by": str(user.sub),
        },
    )
    await db.commit()

    row = (
        await db.execute(
            text(
                "SELECT cuenta_codigo, empresa_codigo, habilitada, notas "
                "FROM core.plan_cuenta_empresa "
                "WHERE cuenta_codigo = :c AND empresa_codigo = :e"
            ),
            {"c": codigo, "e": empresa_codigo},
        )
    ).mappings().one()
    return PlanCuentaEmpresaRead.model_validate(dict(row))
