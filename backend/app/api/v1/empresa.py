"""Endpoints empresa-scoped para análisis financiero detallado (V3 fase 6).

Todos los endpoints filtran por `empresa_codigo`. La data viene de
`core.movimientos`. Mantenemos el módulo `dashboard.py` para la vista
consolidada del portafolio; este módulo es para drill-down dentro de
una empresa concreta.

Endpoints:
- GET /{codigo}/resumen-cc                Hero KPIs + Composición Completa CC
- GET /{codigo}/egresos-por-tipo          Donut chart top 9 + Otros
- GET /{codigo}/egresos-por-proyecto      Treemap por proyecto
- GET /{codigo}/flujo-mensual             Time series últimos N meses
- GET /{codigo}/transacciones-recientes   Feed paginado de últimas N
- GET /{codigo}/categorias                Breakdown concepto_general → detallado
- GET /{codigo}/proyectado-vs-real        Comparativa real vs proyectado
"""
from __future__ import annotations

from collections.abc import Iterable
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import text

import structlog

from app.api.deps import CurrentUser, DBSession, require_scope
from app.api.v1.dashboard import (
    acumular_saldo,
    calc_delta_pct,
    periodo_to_fecha_inicio,
)
from app.core.security import AuthenticatedUser
from app.domain.value_objects.periodo import Periodo
from app.schemas.empresa_dashboard import (
    CategoriaBreakdown,
    ComposicionRow,
    EgresoProyectoItem,
    EgresoTipoItem,
    FlujoMensualPoint,
    ProyectadoVsRealRow,
    ResumenCC,
    ResumenCCKpis,
    SubCategoriaItem,
    TransaccionRecienteItem,
)

router = APIRouter()

_log_empresa_logo = structlog.get_logger("empresa_logo")

ZERO = Decimal("0")


# =====================================================================
# Helpers puros (testeables sin DB)
# =====================================================================

# Mapeo concepto_general → tipo de naturaleza contable.
# Acepta variantes con/sin tilde porque la data viene del Excel y a veces
# difiere por encoding.
TIPO_MAP: dict[str, str] = {
    "pago_de_acciones": "Capital",
    "capital": "Capital",
    "inversion": "Tesoreria",
    "inversión": "Tesoreria",
    "reversa": "Ajuste",
    "ajuste": "Ajuste",
    "prestamos": "Financiero",
    "préstamos": "Financiero",
    "financiamiento": "Financiero",
    "desarrollo_proyecto": "Operacional",
    "recurso_humano": "Operacional",
    "administracion": "Operacional",
    "administración": "Operacional",
    "operacion": "Operacional",
    "operación": "Operacional",
    "ventas": "Operacional",
}

# Conceptos NO operacionales — se excluyen del KPI "egresos_operacionales".
NO_OPERACIONAL: frozenset[str] = frozenset(
    {
        "pago_de_acciones",
        "capital",
        "reversa",
        "ajuste",
    }
)

# Proyectos que se excluyen por default del treemap (ruido visual o no son
# proyectos propiamente tal).
DEFAULT_TREEMAP_EXCLUDE: frozenset[str] = frozenset(
    {"oficina", "reversa", "ajuste", "sin_proyecto"}
)

# Paleta determinista para el donut/treemap — coherente con `chart-palette.ts`
# del frontend. Server decide el color para que el cliente no calcule.
APPLE_PALETTE: tuple[str, ...] = (
    "#1d6f42",  # cehta-green
    "#0a84ff",  # sf-blue
    "#5e5ce6",  # sf-purple
    "#ff9500",  # warning / orange
    "#34c759",  # positive / green
    "#ff3b30",  # negative / red
    "#64d2ff",  # sf-teal
    "#bf5af2",  # pink-purple
    "#ff453a",  # bright red
    "#a1a1a6",  # ink-300 (fallback gris para "Otros")
)


def normalize_concepto(value: str | None) -> str:
    """Normaliza un concepto_general a la clave usada en TIPO_MAP."""
    if not value:
        return ""
    return value.strip().lower().replace(" ", "_")


def categorizar_tipo(concepto_general: str | None) -> str:
    """Devuelve el tipo (Capital/Tesoreria/...) para una categoría."""
    key = normalize_concepto(concepto_general)
    return TIPO_MAP.get(key, "Otros")


def is_operacional(concepto_general: str | None) -> bool:
    """True si el concepto es operacional (cuenta en egresos operacionales)."""
    key = normalize_concepto(concepto_general)
    return key not in NO_OPERACIONAL and bool(key)


def color_for_index(index: int) -> str:
    return APPLE_PALETTE[index % len(APPLE_PALETTE)]


def _validate_periodo(periodo: str | None) -> str | None:
    """Valida `MM_YY` o devuelve None si no se pasó. Lanza si es malformado."""
    if periodo is None:
        return None
    try:
        Periodo.parse(periodo)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Periodo inválido (MM_YY esperado): {periodo}",
        ) from exc
    return periodo


async def _get_empresa(db, codigo: str, user=None) -> tuple[str, str]:
    """Devuelve (codigo, razon_social) o lanza 404.

    V5++ ola CJ — si se pasa `user`, valida que tenga scope en la empresa
    (CRITICAL — antes 10 endpoints leian KPIs/saldos de otras empresas).
    `user` queda opcional por backward compat con call sites legacy que
    no hicimos migrar; los nuevos siempre lo pasan.

    Recomendado: pasar `user` SIEMPRE.
    """
    # Scope check primero — falla rápido si no tiene acceso, sin pegarle a la
    # tabla empresas. assert_empresa_access ya hace su propia query a
    # user_company_roles + cache.
    if user is not None:
        from app.services.empresa_scope_service import assert_empresa_access
        await assert_empresa_access(user, db, codigo)

    row = (
        await db.execute(
            text(
                """
                SELECT codigo, razon_social
                FROM core.empresas
                WHERE codigo = :codigo
                """
            ),
            {"codigo": codigo},
        )
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Empresa no encontrada: {codigo}",
        )
    return row[0], row[1]


# =====================================================================
# GET /empresa  (lista plana — universal selector source-of-truth)
# =====================================================================
#
# Las 12+ vistas que usan dropdown de empresa en el frontend pegan a este
# path. Antes esta ruta no existía (solo /empresa/{codigo}/...) y los
# selectores quedaban vacíos en silencio (404 → useQuery devuelve undefined).
#
# Disciplina: este endpoint devuelve TODAS las empresas (incluso las
# inactivas) ordenadas por código. La razón: en módulos contables/legales
# necesitamos referenciar empresas históricas aunque ya no operen. El
# `activo` flag se respeta sólo en endpoints operativos (movimientos,
# OCs, alertas) que filtran a nivel de query.
#
# Si en el futuro se necesita un selector "solo activas", agregar un
# query param `?solo_activas=true` y NO crear endpoint paralelo.


class EmpresaListItem(BaseModel):
    """Forma mínima usada por todos los selects del frontend."""

    codigo: str
    razon_social: str
    rut: str | None = None
    oc_prefix: str | None = None
    activo: bool = True


@router.get("", response_model=list[EmpresaListItem])
async def list_empresas_flat(
    user: CurrentUser,
    db: DBSession,
    response: Response,
    solo_activas: bool = False,
) -> list[EmpresaListItem]:
    """Lista plana de empresas para poblar selects.

    Devuelve TODAS las empresas por defecto (incluidas inactivas) para que
    los selectores en /vouchers, /reportes, /admin, etc. muestren el set
    completo del portafolio. Pasá `?solo_activas=true` si necesitás filtrar
    a las que están operando hoy.

    Cache: 5min stale-while-revalidate. Las empresas cambian rara vez —
    esto reduce ~30 requests/sesión a 1.
    """
    response.headers["Cache-Control"] = (
        "private, max-age=300, stale-while-revalidate=60"
    )
    where = "WHERE activo = TRUE" if solo_activas else ""
    rows = (
        await db.execute(
            text(
                f"""
                SELECT codigo, razon_social, rut, oc_prefix, activo
                FROM core.empresas
                {where}
                ORDER BY codigo
                """
            )
        )
    ).fetchall()
    return [
        EmpresaListItem(
            codigo=r[0],
            razon_social=r[1],
            rut=r[2],
            oc_prefix=r[3],
            activo=bool(r[4]),
        )
        for r in rows
    ]


# =====================================================================
# POST /empresa/{codigo}/sync-all-dropbox  — sync compuesto
# =====================================================================
#
# Botón "una sola tecla" para Nicolás: corre los 5 syncs disponibles para
# una empresa en secuencia. Cada uno es soft-fail individual — si Dropbox
# no está conectado para uno, lo skipea y sigue con el resto.


class SyncAllDropboxResponse(BaseModel):
    trabajadores: dict | None = None
    legal: dict | None = None
    f29: dict | None = None
    f22: dict | None = None
    estados_financieros: dict | None = None
    errors: list[str] = []


@router.post(
    "/{empresa_codigo}/sync-all-dropbox",
    response_model=SyncAllDropboxResponse,
)
async def sync_all_dropbox(
    empresa_codigo: str,
    user: Annotated[
        AuthenticatedUser, Depends(require_scope("integration:write"))
    ],
    db: DBSession,
) -> SyncAllDropboxResponse:
    """Corre todos los syncs Dropbox de la empresa en una transacción.

    Cada sub-sync atrapa sus errores y los acumula en `errors[]` sin
    abortar los demás. Idempotente — si re-corres no duplica nada.
    """
    # Validar empresa
    await _get_empresa(db, empresa_codigo, user=user)

    response = SyncAllDropboxResponse()

    # Importar perezosamente para evitar circular dependencies
    try:
        from app.services.dropbox_service import (
            DropboxNotConfigured,
            DropboxService,
        )
        from app.services.dropbox_sync_service import DropboxSyncService

        dbx = DropboxService()
        svc = DropboxSyncService(db, dbx)
    except DropboxNotConfigured as exc:
        response.errors.append(f"Dropbox no configurado: {exc}")
        return response
    except Exception as exc:  # noqa: BLE001
        response.errors.append(f"Init Dropbox: {exc}")
        return response

    # 1. Trabajadores
    try:
        result = await svc.sync_trabajadores(empresa_codigo)
        response.trabajadores = result.to_dict()
    except Exception as exc:  # noqa: BLE001
        response.errors.append(f"Trabajadores: {exc}")

    # 2. Legal
    try:
        result = await svc.sync_legal(empresa_codigo)
        response.legal = result.to_dict()
    except Exception as exc:  # noqa: BLE001
        response.errors.append(f"Legal: {exc}")

    # 3. F29
    try:
        result = await svc.sync_f29(empresa_codigo)
        response.f29 = result.to_dict()
    except Exception as exc:  # noqa: BLE001
        response.errors.append(f"F29: {exc}")

    # 4. Estados Financieros
    try:
        if hasattr(svc, "sync_estados_financieros"):
            result = await svc.sync_estados_financieros(empresa_codigo)
            response.estados_financieros = result.to_dict()
    except Exception as exc:  # noqa: BLE001
        response.errors.append(f"EEFF: {exc}")

    # 5. F22 (módulo independiente — usa la misma lógica del endpoint
    # /f22/sync-dropbox/{empresa} para no duplicar reglas de matching).
    try:
        from app.services.f22_sync_service import sync_f22_dropbox

        result = await sync_f22_dropbox(db, dbx, empresa_codigo)
        response.f22 = result
    except Exception as exc:  # noqa: BLE001
        response.errors.append(f"F22: {exc}")
        await db.rollback()

    return response


# =====================================================================
# GET /empresa/{codigo}/resumen-cc
# =====================================================================
@router.get("/{empresa_codigo}/resumen-cc", response_model=ResumenCC)
async def resumen_cc(
    empresa_codigo: str,
    user: Annotated[AuthenticatedUser, Depends(require_scope("movimiento:read"))],
    db: DBSession,
    periodo: str | None = None,
    real_proyectado: str | None = None,
) -> ResumenCC:
    """Hero KPIs + tabla Composición Completa CC para una empresa."""
    _validate_periodo(periodo)
    if real_proyectado not in (None, "Real", "Proyectado"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="real_proyectado debe ser 'Real' o 'Proyectado'",
        )

    codigo, razon_social = await _get_empresa(db, empresa_codigo, user=user)

    # Filtros opcionales
    where_extra = []
    params: dict = {"codigo": codigo}
    if periodo is not None:
        where_extra.append("AND periodo = :periodo")
        params["periodo"] = periodo
    if real_proyectado is not None:
        where_extra.append("AND real_proyectado = :rp")
        params["rp"] = real_proyectado
    extra_sql = "\n".join(where_extra)

    # Totales globales + último saldo_corfo (para presupuesto CORFO)
    totales_row = (
        await db.execute(
            text(
                f"""
                SELECT
                    COALESCE(SUM(egreso), 0)             AS total_egresos,
                    COALESCE(SUM(abono), 0)              AS total_abonos,
                    COUNT(*)                              AS transaction_count
                FROM core.movimientos
                WHERE empresa_codigo = :codigo
                {extra_sql}
                """  # noqa: S608
            ),
            params,
        )
    ).fetchone()

    total_egresos = Decimal(totales_row[0] or 0) if totales_row else ZERO
    total_abonos = Decimal(totales_row[1] or 0) if totales_row else ZERO
    transaction_count = int(totales_row[2] or 0) if totales_row else 0

    # Presupuesto CORFO = último valor saldo_corfo conocido para la empresa.
    # No depende del filtro de periodo (es el techo presupuestario vigente).
    corfo_row = (
        await db.execute(
            text(
                """
                SELECT saldo_corfo
                FROM core.movimientos
                WHERE empresa_codigo = :codigo
                  AND saldo_corfo IS NOT NULL
                ORDER BY fecha DESC, movimiento_id DESC
                LIMIT 1
                """
            ),
            {"codigo": codigo},
        )
    ).fetchone()
    presupuesto_corfo = Decimal(corfo_row[0] or 0) if corfo_row else ZERO

    # Composición por concepto_general — base para tabla y para egresos
    # operacionales (filtramos en Python por simplicidad y testabilidad).
    comp_rows = (
        await db.execute(
            text(
                f"""
                SELECT
                    COALESCE(concepto_general, 'Sin clasificar') AS categoria,
                    COALESCE(SUM(egreso), 0)                     AS egresos,
                    COALESCE(SUM(abono), 0)                      AS abonos,
                    COUNT(*)                                      AS tx_count
                FROM core.movimientos
                WHERE empresa_codigo = :codigo
                {extra_sql}
                GROUP BY COALESCE(concepto_general, 'Sin clasificar')
                ORDER BY (COALESCE(SUM(egreso), 0) + COALESCE(SUM(abono), 0)) DESC
                """  # noqa: S608
            ),
            params,
        )
    ).fetchall()

    composicion: list[ComposicionRow] = []
    egresos_operacionales = ZERO
    for r in comp_rows:
        cat = r[0]
        eg = Decimal(r[1] or 0)
        ab = Decimal(r[2] or 0)
        tx = int(r[3] or 0)
        composicion.append(
            ComposicionRow(
                categoria=cat,
                egresos=eg,
                abonos=ab,
                neto=ab - eg,
                tipo=categorizar_tipo(cat),
                transaction_count=tx,
            )
        )
        if is_operacional(cat):
            egresos_operacionales += eg

    ejecucion_pcto = (
        float(round((egresos_operacionales / presupuesto_corfo * 100), 2))
        if presupuesto_corfo > 0
        else 0.0
    )

    kpis = ResumenCCKpis(
        egresos_totales_cc=total_egresos,
        abonos_totales_cc=total_abonos,
        egresos_operacionales=egresos_operacionales,
        presupuesto_corfo=presupuesto_corfo,
        ejecucion_pcto=ejecucion_pcto,
    )

    return ResumenCC(
        empresa_codigo=codigo,
        razon_social=razon_social,
        transaction_count=transaction_count,
        periodo_filtro=periodo,
        real_proyectado_filtro=real_proyectado,
        kpis=kpis,
        composicion=composicion,
    )


# =====================================================================
# GET /empresa/{codigo}/egresos-por-tipo
# =====================================================================
@router.get(
    "/{empresa_codigo}/egresos-por-tipo",
    response_model=list[EgresoTipoItem],
)
async def egresos_por_tipo(
    empresa_codigo: str,
    user: Annotated[AuthenticatedUser, Depends(require_scope("movimiento:read"))],
    db: DBSession,
    periodo: str | None = None,
    real_proyectado: str | None = "Real",
) -> list[EgresoTipoItem]:
    """Top 9 conceptos por egreso + 'Otros'. Para el donut chart."""
    _validate_periodo(periodo)
    await _get_empresa(db, empresa_codigo, user=user)

    where_extra = []
    params: dict = {"codigo": empresa_codigo}
    if periodo is not None:
        where_extra.append("AND periodo = :periodo")
        params["periodo"] = periodo
    if real_proyectado is not None:
        where_extra.append("AND real_proyectado = :rp")
        params["rp"] = real_proyectado
    extra_sql = "\n".join(where_extra)

    rows = (
        await db.execute(
            text(
                f"""
                SELECT
                    COALESCE(concepto_general, 'Sin clasificar') AS categoria,
                    COALESCE(SUM(egreso), 0)                     AS total,
                    COUNT(*)                                      AS tx
                FROM core.movimientos
                WHERE empresa_codigo = :codigo
                  AND egreso > 0
                {extra_sql}
                GROUP BY COALESCE(concepto_general, 'Sin clasificar')
                ORDER BY total DESC
                """  # noqa: S608
            ),
            params,
        )
    ).fetchall()

    if not rows:
        return []

    parsed = [(r[0], Decimal(r[1] or 0), int(r[2] or 0)) for r in rows]
    total = sum((p[1] for p in parsed), ZERO)

    TOP_N = 9
    top = parsed[:TOP_N]
    rest = parsed[TOP_N:]

    out: list[EgresoTipoItem] = []
    for i, (cat, eg, tx) in enumerate(top):
        pct = float(round((eg / total * 100), 2)) if total > 0 else 0.0
        out.append(
            EgresoTipoItem(
                categoria=cat,
                total_egreso=eg,
                transaction_count=tx,
                porcentaje=pct,
                color=color_for_index(i),
            )
        )
    if rest:
        rest_eg = sum((r[1] for r in rest), ZERO)
        rest_tx = sum((r[2] for r in rest))
        rest_pct = float(round((rest_eg / total * 100), 2)) if total > 0 else 0.0
        out.append(
            EgresoTipoItem(
                categoria="Otros",
                total_egreso=rest_eg,
                transaction_count=rest_tx,
                porcentaje=rest_pct,
                color=APPLE_PALETTE[-1],  # gris reservado para "Otros"
            )
        )
    return out


# =====================================================================
# GET /empresa/{codigo}/egresos-por-proyecto
# =====================================================================
@router.get(
    "/{empresa_codigo}/egresos-por-proyecto",
    response_model=list[EgresoProyectoItem],
)
async def egresos_por_proyecto(
    empresa_codigo: str,
    user: Annotated[AuthenticatedUser, Depends(require_scope("movimiento:read"))],
    db: DBSession,
    periodo: str | None = None,
    real_proyectado: str | None = "Real",
    exclude: Annotated[list[str], Query()] = [],
    include_default_excluded: bool = False,
) -> list[EgresoProyectoItem]:
    """Egresos agrupados por proyecto, ordenado desc — para treemap."""
    _validate_periodo(periodo)
    await _get_empresa(db, empresa_codigo, user=user)

    excluded = {e.strip().lower() for e in exclude if e and e.strip()}
    if not include_default_excluded:
        excluded |= DEFAULT_TREEMAP_EXCLUDE

    where_extra = []
    params: dict = {"codigo": empresa_codigo}
    if periodo is not None:
        where_extra.append("AND periodo = :periodo")
        params["periodo"] = periodo
    if real_proyectado is not None:
        where_extra.append("AND real_proyectado = :rp")
        params["rp"] = real_proyectado
    extra_sql = "\n".join(where_extra)

    rows = (
        await db.execute(
            text(
                f"""
                SELECT
                    proyecto,
                    COALESCE(SUM(egreso), 0) AS total,
                    COUNT(*)                  AS tx
                FROM core.movimientos
                WHERE empresa_codigo = :codigo
                  AND egreso > 0
                  AND proyecto IS NOT NULL
                {extra_sql}
                GROUP BY proyecto
                ORDER BY total DESC
                """  # noqa: S608
            ),
            params,
        )
    ).fetchall()

    filtered: list[tuple[str, Decimal, int]] = []
    for r in rows:
        proyecto = (r[0] or "").strip()
        if not proyecto:
            continue
        if proyecto.lower() in excluded:
            continue
        filtered.append((proyecto, Decimal(r[1] or 0), int(r[2] or 0)))

    total = sum((p[1] for p in filtered), ZERO)
    return [
        EgresoProyectoItem(
            proyecto=p,
            total_egreso=eg,
            transaction_count=tx,
            porcentaje=float(round((eg / total * 100), 2)) if total > 0 else 0.0,
        )
        for p, eg, tx in filtered
    ]


# =====================================================================
# GET /empresa/{codigo}/flujo-mensual
# =====================================================================
@router.get(
    "/{empresa_codigo}/flujo-mensual",
    response_model=list[FlujoMensualPoint],
)
async def flujo_mensual(
    empresa_codigo: str,
    user: Annotated[AuthenticatedUser, Depends(require_scope("movimiento:read"))],
    db: DBSession,
    meses: Annotated[int, Query(ge=1, le=36)] = 12,
) -> list[FlujoMensualPoint]:
    """Time series de los últimos N meses para esta empresa, real + proyectado."""
    await _get_empresa(db, empresa_codigo, user=user)

    rows = (
        await db.execute(
            text(
                """
                WITH agg AS (
                    SELECT
                        anio,
                        periodo,
                        SUM(abono)  FILTER (WHERE real_proyectado = 'Real')      AS abono_real,
                        SUM(egreso) FILTER (WHERE real_proyectado = 'Real')      AS egreso_real,
                        SUM(abono)  FILTER (WHERE real_proyectado = 'Proyectado') AS abono_proy,
                        SUM(egreso) FILTER (WHERE real_proyectado = 'Proyectado') AS egreso_proy
                    FROM core.movimientos
                    WHERE empresa_codigo = :codigo
                    GROUP BY anio, periodo
                )
                SELECT periodo, anio,
                       COALESCE(abono_real, 0),
                       COALESCE(egreso_real, 0),
                       COALESCE(abono_proy, 0),
                       COALESCE(egreso_proy, 0)
                FROM agg
                ORDER BY anio DESC,
                         split_part(periodo, '_', 1)::int DESC
                LIMIT :meses
                """
            ),
            {"codigo": empresa_codigo, "meses": meses},
        )
    ).fetchall()

    rows_asc = sorted(
        rows,
        key=lambda r: (r[1], int(r[0].split("_")[0]) if r[0] else 0),
    )

    pares: Iterable[tuple[Decimal, Decimal]] = [
        (Decimal(r[2] or 0) + Decimal(r[4] or 0), Decimal(r[3] or 0) + Decimal(r[5] or 0))
        for r in rows_asc
    ]
    saldos = acumular_saldo(pares)

    out: list[FlujoMensualPoint] = []
    for r, saldo in zip(rows_asc, saldos, strict=False):
        try:
            fi = periodo_to_fecha_inicio(r[0])
        except ValueError:
            continue
        ar = Decimal(r[2] or 0)
        er = Decimal(r[3] or 0)
        ap = Decimal(r[4] or 0)
        ep = Decimal(r[5] or 0)
        out.append(
            FlujoMensualPoint(
                periodo=r[0],
                fecha_inicio=fi,
                abono_real=ar,
                egreso_real=er,
                abono_proyectado=ap,
                egreso_proyectado=ep,
                flujo_neto=(ar + ap) - (er + ep),
                saldo_acumulado=saldo,
            )
        )
    return out


# =====================================================================
# GET /empresa/{codigo}/transacciones-recientes
# =====================================================================
@router.get(
    "/{empresa_codigo}/transacciones-recientes",
    response_model=list[TransaccionRecienteItem],
)
async def transacciones_recientes(
    empresa_codigo: str,
    user: Annotated[AuthenticatedUser, Depends(require_scope("movimiento:read"))],
    db: DBSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
    proyecto: str | None = None,
    concepto: str | None = None,
    real_proyectado: str | None = None,
) -> list[TransaccionRecienteItem]:
    """Últimas N transacciones para feed/tabla, con filtros opcionales."""
    if real_proyectado not in (None, "Real", "Proyectado"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="real_proyectado debe ser 'Real' o 'Proyectado'",
        )
    await _get_empresa(db, empresa_codigo, user=user)

    where_extra = []
    params: dict = {"codigo": empresa_codigo, "limit": limit}
    if proyecto:
        where_extra.append("AND proyecto = :proyecto")
        params["proyecto"] = proyecto
    if concepto:
        where_extra.append("AND concepto_general = :concepto")
        params["concepto"] = concepto
    if real_proyectado:
        where_extra.append("AND real_proyectado = :rp")
        params["rp"] = real_proyectado
    extra_sql = "\n".join(where_extra)

    rows = (
        await db.execute(
            text(
                f"""
                SELECT
                    movimiento_id,
                    fecha::text,
                    descripcion,
                    abono,
                    egreso,
                    saldo_contable,
                    concepto_general,
                    concepto_detallado,
                    proyecto,
                    real_proyectado,
                    hipervinculo
                FROM core.movimientos
                WHERE empresa_codigo = :codigo
                {extra_sql}
                ORDER BY fecha DESC, movimiento_id DESC
                LIMIT :limit
                """  # noqa: S608
            ),
            params,
        )
    ).fetchall()

    return [
        TransaccionRecienteItem(
            movimiento_id=r[0],
            fecha=r[1],
            descripcion=r[2],
            abono=Decimal(r[3] or 0),
            egreso=Decimal(r[4] or 0),
            saldo_contable=Decimal(r[5]) if r[5] is not None else None,
            concepto_general=r[6],
            concepto_detallado=r[7],
            proyecto=r[8],
            real_proyectado=r[9],
            hipervinculo=r[10],
        )
        for r in rows
    ]


# =====================================================================
# GET /empresa/{codigo}/categorias
# =====================================================================
@router.get(
    "/{empresa_codigo}/categorias",
    response_model=list[CategoriaBreakdown],
)
async def categorias_breakdown(
    empresa_codigo: str,
    user: Annotated[AuthenticatedUser, Depends(require_scope("movimiento:read"))],
    db: DBSession,
    real_proyectado: str | None = "Real",
) -> list[CategoriaBreakdown]:
    """Vista detallada: por concepto_general → concepto_detallado."""
    if real_proyectado not in (None, "Real", "Proyectado"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="real_proyectado debe ser 'Real' o 'Proyectado'",
        )
    await _get_empresa(db, empresa_codigo, user=user)

    where_extra = ""
    params: dict = {"codigo": empresa_codigo}
    if real_proyectado:
        where_extra = "AND real_proyectado = :rp"
        params["rp"] = real_proyectado

    rows = (
        await db.execute(
            text(
                f"""
                SELECT
                    COALESCE(concepto_general, 'Sin clasificar')   AS cg,
                    COALESCE(concepto_detallado, 'Sin detalle')    AS cd,
                    COALESCE(SUM(egreso), 0)                       AS egresos,
                    COALESCE(SUM(abono), 0)                        AS abonos,
                    COUNT(*)                                        AS tx
                FROM core.movimientos
                WHERE empresa_codigo = :codigo
                {where_extra}
                GROUP BY COALESCE(concepto_general, 'Sin clasificar'),
                         COALESCE(concepto_detallado, 'Sin detalle')
                ORDER BY cg, egresos DESC
                """  # noqa: S608
            ),
            params,
        )
    ).fetchall()

    grouped: dict[str, dict] = {}
    for r in rows:
        cg = r[0]
        cd = r[1]
        eg = Decimal(r[2] or 0)
        ab = Decimal(r[3] or 0)
        tx = int(r[4] or 0)
        bucket = grouped.setdefault(
            cg,
            {"total_egreso": ZERO, "total_abono": ZERO, "tx": 0, "subs": []},
        )
        bucket["total_egreso"] += eg
        bucket["total_abono"] += ab
        bucket["tx"] += tx
        bucket["subs"].append(
            SubCategoriaItem(
                concepto_detallado=cd,
                total_egreso=eg,
                total_abono=ab,
                transaction_count=tx,
            )
        )

    out = [
        CategoriaBreakdown(
            concepto_general=cg,
            total_egreso=g["total_egreso"],
            total_abono=g["total_abono"],
            transaction_count=g["tx"],
            sub_categorias=g["subs"],
        )
        for cg, g in grouped.items()
    ]
    out.sort(key=lambda c: c.total_egreso, reverse=True)
    return out


# =====================================================================
# GET /empresa/{codigo}/proyectado-vs-real
# =====================================================================
@router.get(
    "/{empresa_codigo}/proyectado-vs-real",
    response_model=list[ProyectadoVsRealRow],
)
async def proyectado_vs_real(
    empresa_codigo: str,
    user: Annotated[AuthenticatedUser, Depends(require_scope("movimiento:read"))],
    db: DBSession,
    periodo: str | None = None,
) -> list[ProyectadoVsRealRow]:
    """Comparativa Real vs Proyectado por categoría (concepto_general)."""
    _validate_periodo(periodo)
    await _get_empresa(db, empresa_codigo, user=user)

    where_extra = ""
    params: dict = {"codigo": empresa_codigo}
    if periodo:
        where_extra = "AND periodo = :periodo"
        params["periodo"] = periodo

    rows = (
        await db.execute(
            text(
                f"""
                SELECT
                    COALESCE(concepto_general, 'Sin clasificar') AS cg,
                    COALESCE(SUM(egreso) FILTER (WHERE real_proyectado = 'Real'), 0)
                        AS real_egreso,
                    COALESCE(SUM(egreso) FILTER (WHERE real_proyectado = 'Proyectado'), 0)
                        AS proy_egreso
                FROM core.movimientos
                WHERE empresa_codigo = :codigo
                {where_extra}
                GROUP BY COALESCE(concepto_general, 'Sin clasificar')
                ORDER BY (
                    COALESCE(SUM(egreso) FILTER (WHERE real_proyectado = 'Real'), 0)
                    + COALESCE(SUM(egreso) FILTER (WHERE real_proyectado = 'Proyectado'), 0)
                ) DESC
                """  # noqa: S608
            ),
            params,
        )
    ).fetchall()

    out: list[ProyectadoVsRealRow] = []
    for r in rows:
        cg = r[0]
        real = Decimal(r[1] or 0)
        proy = Decimal(r[2] or 0)
        out.append(
            ProyectadoVsRealRow(
                categoria=cg,
                real=real,
                proyectado=proy,
                delta_pct=calc_delta_pct(real, proy),
            )
        )
    return out


# =====================================================================
# V5++ ola CG — Logo de la empresa (para PDFs branded)
# =====================================================================

class LogoUploadResponse(BaseModel):
    empresa_codigo: str
    logo_dropbox_path: str
    size_bytes: int


@router.post(
    "/{empresa_codigo}/logo",
    response_model=LogoUploadResponse,
)
async def upload_empresa_logo(
    empresa_codigo: str,
    user: Annotated[AuthenticatedUser, Depends(require_scope("empresa:update"))],
    db: DBSession,
    file: Annotated[UploadFile, File(description="Logo PNG/JPG/SVG max 2MB")],
) -> LogoUploadResponse:
    """Sube logo via multipart. Lo guarda en Dropbox + DB."""
    import re as _re
    import time as _time

    # Validaciones
    filename = file.filename or "logo.png"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    if ext not in {"png", "jpg", "jpeg", "svg", "webp"}:
        raise HTTPException(
            status_code=415,
            detail=f"Formato '.{ext}' no soportado. Usá PNG, JPG, SVG o WebP.",
        )

    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"Archivo muy grande ({len(content) / 1024:.0f} KB). Max 2 MB.",
        )
    if len(content) < 100:
        raise HTTPException(status_code=400, detail="Archivo vacío o corrupto")

    # Verificar empresa existe
    empresa = await _get_empresa(db, empresa_codigo, user=user)

    # Upload a Dropbox
    from app.infrastructure.repositories.integration_repository import IntegrationRepository
    from app.services.dropbox_service import DropboxNotConfigured, DropboxService

    integration_repo = IntegrationRepository(db)
    integration = await integration_repo.get_by_provider("dropbox")
    if integration is None or not integration.access_token:
        raise HTTPException(
            status_code=503,
            detail="Dropbox no conectado. Conectalo en /admin/integraciones.",
        )
    try:
        dbx = DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
    except DropboxNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    # Naming: logo.<ext> en /00-Branding/ — sobreescribe si existe
    safe_ext = _re.sub(r"[^a-z]", "", ext.lower())
    target_path = (
        f"/Cehta Capital/01-Empresas/{empresa_codigo}/00-Branding/logo.{safe_ext}"
    )

    try:
        dbx.upload_file(target_path, content, overwrite=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail=f"Fallé subiendo a Dropbox: {exc}"
        ) from exc

    # Update DB
    from sqlalchemy import text as _text
    await db.execute(
        _text(
            "UPDATE core.empresas SET logo_dropbox_path = :path, updated_at = now() "
            "WHERE codigo = :cod"
        ),
        {"path": target_path, "cod": empresa_codigo},
    )
    await db.commit()

    _log_empresa_logo.info(
        "empresa.logo.uploaded",
        empresa=empresa_codigo,
        path=target_path,
        size=len(content),
    )

    return LogoUploadResponse(
        empresa_codigo=empresa_codigo,
        logo_dropbox_path=target_path,
        size_bytes=len(content),
    )


class LogoUrlResponse(BaseModel):
    url: str
    expires_in_hours: int = 4


@router.get("/{empresa_codigo}/logo-url", response_model=LogoUrlResponse)
async def get_empresa_logo_url(
    empresa_codigo: str,
    user: CurrentUser,
    db: DBSession,
) -> LogoUrlResponse:
    """Devuelve URL temporal Dropbox (4h) del logo. Usada por FE para
    mostrar preview y por el render_orden_compra_html para embeber."""
    import asyncio as _asyncio

    from app.infrastructure.repositories.integration_repository import (
        IntegrationRepository,
    )
    from app.services.dropbox_service import DropboxNotConfigured, DropboxService

    row = (
        await db.execute(
            text(
                "SELECT logo_dropbox_path FROM core.empresas WHERE codigo = :cod"
            ),
            {"cod": empresa_codigo},
        )
    ).first()
    if not row:
        raise HTTPException(
            status_code=404, detail=f"Empresa no encontrada: {empresa_codigo}"
        )
    logo_path = row[0]
    if not logo_path:
        raise HTTPException(
            status_code=404,
            detail=f"Empresa {empresa_codigo} no tiene logo cargado",
        )

    integration_repo = IntegrationRepository(db)
    integration = await integration_repo.get_by_provider("dropbox")
    if integration is None:
        raise HTTPException(status_code=503, detail="Dropbox no conectado")
    try:
        dbx = DropboxService(
            access_token=integration.access_token,
            refresh_token=integration.refresh_token,
        )
        url = await _asyncio.to_thread(dbx.get_temporary_link, logo_path)
    except DropboxNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail=f"No se pudo generar URL: {exc}"
        ) from exc

    return LogoUrlResponse(url=url, expires_in_hours=4)
