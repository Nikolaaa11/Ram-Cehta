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

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text

from app.api.deps import DBSession, require_scope
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


async def _get_empresa(db, codigo: str) -> tuple[str, str]:
    """Devuelve (codigo, razon_social) o lanza 404."""
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

    codigo, razon_social = await _get_empresa(db, empresa_codigo)

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
    await _get_empresa(db, empresa_codigo)

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
    await _get_empresa(db, empresa_codigo)

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
    await _get_empresa(db, empresa_codigo)

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
    await _get_empresa(db, empresa_codigo)

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
    await _get_empresa(db, empresa_codigo)

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
    await _get_empresa(db, empresa_codigo)

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
