"""Dashboard — KPIs y series de tiempo para UI ultra-pro estilo Apple.

Endpoints (todos bajo /api/v1/dashboard, requieren auth, lectura para todos los roles):

- GET /                       resumen original (saldos + mov + OC + F29)
- GET /kpis                   hero stats (6 tarjetas grandes)
- GET /cashflow               serie temporal de flujo de caja (real vs proyectado)
- GET /egresos-por-concepto   top 10 conceptos del periodo (treemap/donut)
- GET /saldos-por-empresa     detalle por empresa con delta 30d (bar chart)
- GET /iva-trend              IVA crédito/débito/a pagar mes a mes
- GET /proyectos-ranking      top N proyectos por gasto últimos 12 meses
- GET /movimientos-recientes  feed de actividad
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.domain.value_objects.periodo import Periodo, current_periodo
from app.schemas.dashboard import (
    Alert,
    CashflowPoint,
    CashflowResponse,
    CEOConsolidatedReport,
    DashboardKPIs,
    DashboardResponse,
    EgresoConcepto,
    EmpresaCEOKPIs,
    F29Resumen,
    HeatmapCell,
    IvaPoint,
    MovimientoReciente,
    OCResumen,
    ProyectoRanking,
    SaldoEmpresa,
    SaldoEmpresaDetalle,
)

router = APIRouter()


# =====================================================================
# Helpers puros (testeables sin DB)
# =====================================================================
ZERO = Decimal("0")


def calc_delta_pct(actual: Decimal, anterior: Decimal) -> float:
    """Variación porcentual con NULL/zero safety.

    - Si `anterior` es 0/None y `actual` también, devuelve 0.0.
    - Si `anterior` es 0/None y `actual` no es 0, devuelve 100.0 (crecimiento desde cero).
    - En otro caso, (actual - anterior) / anterior * 100, redondeado a 2 decimales.
    """
    a = Decimal(actual) if actual is not None else ZERO
    b = Decimal(anterior) if anterior is not None else ZERO
    if b == 0:
        return 0.0 if a == 0 else 100.0
    delta = (a - b) / b * Decimal(100)
    return round(float(delta), 2)


def periodo_to_fecha_inicio(periodo: str) -> date:
    """Convierte 'MM_YY' al primer día del mes correspondiente."""
    p = Periodo.parse(periodo)
    return date(p.anio_completo, p.mes, 1)


def shift_periodo(periodo: str, months: int) -> str:
    """Mueve un periodo 'MM_YY' por N meses (negativos = atrás)."""
    p = Periodo.parse(periodo)
    total = p.anio_completo * 12 + (p.mes - 1) + months
    new_year = total // 12
    new_month = total % 12 + 1
    return f"{new_month:02d}_{new_year % 100:02d}"


def acumular_saldo(
    points: Iterable[tuple[Decimal, Decimal]],
    saldo_inicial: Decimal = ZERO,
) -> list[Decimal]:
    """Calcula saldo acumulado a partir de pares (abono, egreso). Pure function."""
    saldo = Decimal(saldo_inicial)
    out: list[Decimal] = []
    for abono, egreso in points:
        saldo = saldo + (abono or ZERO) - (egreso or ZERO)
        out.append(saldo)
    return out


# =====================================================================
# GET /dashboard — endpoint legacy (saldos + mov + OC + F29)
# =====================================================================
@router.get("", response_model=DashboardResponse)
async def get_dashboard(user: CurrentUser, db: DBSession) -> DashboardResponse:
    periodo = current_periodo()

    saldos_rows = (
        await db.execute(
            text("""
                SELECT
                    e.codigo,
                    e.razon_social,
                    m.saldo_cehta,
                    m.saldo_corfo,
                    m.saldo_contable,
                    m.periodo
                FROM core.empresas e
                LEFT JOIN LATERAL (
                    SELECT saldo_cehta, saldo_corfo, saldo_contable, periodo
                    FROM core.movimientos
                    WHERE empresa_codigo = e.codigo
                      AND saldo_cehta IS NOT NULL
                    ORDER BY fecha DESC
                    LIMIT 1
                ) m ON true
                WHERE e.activo = true
                ORDER BY e.codigo
            """)
        )
    ).fetchall()

    mov_rows = (
        await db.execute(
            text("""
                SELECT movimiento_id, fecha::text, empresa_codigo,
                       descripcion, abono, egreso, concepto_general, proyecto
                FROM core.movimientos
                ORDER BY fecha DESC, movimiento_id DESC
                LIMIT 15
            """)
        )
    ).fetchall()

    oc_row = (
        await db.execute(
            text("""
                SELECT
                    COUNT(*) FILTER (WHERE estado = 'emitida') AS total_emitidas,
                    COALESCE(SUM(total) FILTER (WHERE estado = 'emitida'), 0) AS monto_emitidas,
                    COUNT(*) FILTER (WHERE estado = 'pagada') AS total_pagadas,
                    COALESCE(SUM(total) FILTER (WHERE estado = 'pagada'), 0) AS monto_pagadas,
                    COUNT(*) FILTER (WHERE estado = 'anulada') AS total_anuladas
                FROM core.ordenes_compra
            """)
        )
    ).fetchone()

    f29_rows = (
        await db.execute(
            text("""
                SELECT empresa_codigo, periodo_tributario,
                       fecha_vencimiento::text, monto_a_pagar, estado
                FROM core.f29_obligaciones
                WHERE estado IN ('pendiente', 'vencido')
                ORDER BY fecha_vencimiento
            """)
        )
    ).fetchall()

    return DashboardResponse(
        saldos_por_empresa=[
            SaldoEmpresa(
                empresa_codigo=r[0],
                razon_social=r[1],
                saldo_cehta=r[2],
                saldo_corfo=r[3],
                saldo_contable=r[4],
                periodo=r[5],
            )
            for r in saldos_rows
        ],
        movimientos_recientes=[
            MovimientoReciente(
                movimiento_id=r[0],
                fecha=r[1],
                empresa_codigo=r[2],
                descripcion=r[3],
                abono=r[4] or 0,
                egreso=r[5] or 0,
                concepto_general=r[6],
                proyecto=r[7],
            )
            for r in mov_rows
        ],
        oc_resumen=OCResumen(
            total_emitidas=oc_row[0] if oc_row else 0,
            monto_total_emitidas=oc_row[1] if oc_row else 0,
            total_pagadas=oc_row[2] if oc_row else 0,
            monto_total_pagadas=oc_row[3] if oc_row else 0,
            total_anuladas=oc_row[4] if oc_row else 0,
        ),
        f29_pendientes=[
            F29Resumen(
                empresa_codigo=r[0],
                periodo_tributario=r[1],
                fecha_vencimiento=r[2],
                monto_a_pagar=r[3],
                estado=r[4],
            )
            for r in f29_rows
        ],
        periodo_actual=periodo,
    )


# =====================================================================
# GET /dashboard/kpis — hero stats
# =====================================================================
@router.get("/kpis", response_model=DashboardKPIs)
async def get_kpis(user: CurrentUser, db: DBSession) -> DashboardKPIs:
    periodo = current_periodo()
    periodo_anterior = shift_periodo(periodo, -1)

    # Saldos consolidados (suma del último movimiento Real por empresa+banco)
    saldos_row = (
        await db.execute(
            text("""
                SELECT
                    COALESCE(SUM(saldo_contable), 0) AS s_contable,
                    COALESCE(SUM(saldo_cehta), 0)    AS s_cehta,
                    COALESCE(SUM(saldo_corfo), 0)    AS s_corfo
                FROM core.v_saldos_actuales
            """)
        )
    ).fetchone()

    # Egresos / abonos del mes actual y anterior (real_proyectado='Real')
    flujo_row = (
        await db.execute(
            text("""
                SELECT
                    COALESCE(SUM(egreso) FILTER (WHERE periodo = :p_now), 0) AS egreso_now,
                    COALESCE(SUM(egreso) FILTER (WHERE periodo = :p_prev), 0) AS egreso_prev,
                    COALESCE(SUM(abono)  FILTER (WHERE periodo = :p_now), 0) AS abono_now,
                    COALESCE(SUM(abono)  FILTER (WHERE periodo = :p_prev), 0) AS abono_prev
                FROM core.movimientos
                WHERE real_proyectado = 'Real'
                  AND periodo IN (:p_now, :p_prev)
            """),
            {"p_now": periodo, "p_prev": periodo_anterior},
        )
    ).fetchone()

    egreso_now = Decimal(flujo_row[0] or 0)
    egreso_prev = Decimal(flujo_row[1] or 0)
    abono_now = Decimal(flujo_row[2] or 0)
    abono_prev = Decimal(flujo_row[3] or 0)

    # IVA a pagar consolidado del mes
    iva_row = (
        await db.execute(
            text("""
                SELECT COALESCE(SUM(iva_a_pagar), 0)
                FROM core.v_iva_consolidado
                WHERE periodo = :p
            """),
            {"p": periodo},
        )
    ).fetchone()
    iva_a_pagar = Decimal(iva_row[0] or 0) if iva_row else ZERO

    # OC emitidas pendientes
    oc_row = (
        await db.execute(
            text("""
                SELECT
                    COUNT(*) FILTER (WHERE estado = 'emitida') AS n_emitidas,
                    COALESCE(SUM(total) FILTER (WHERE estado = 'emitida'), 0) AS monto_emitidas
                FROM core.ordenes_compra
            """)
        )
    ).fetchone()

    # F29 alertas
    f29_row = (
        await db.execute(
            text("""
                SELECT
                    COUNT(*) FILTER (WHERE dias_para_vencer BETWEEN 0 AND 30)
                        AS proximas_30d,
                    COUNT(*) FILTER (WHERE dias_para_vencer < 0 AND estado = 'pendiente')
                        AS vencidas
                FROM core.v_f29_alertas
            """)
        )
    ).fetchone()

    # ETL run más reciente
    etl_row = (
        await db.execute(
            text("""
                SELECT finished_at, status
                FROM audit.etl_runs
                WHERE status = 'success'
                ORDER BY finished_at DESC NULLS LAST
                LIMIT 1
            """)
        )
    ).fetchone()
    if etl_row and etl_row[0] is not None:
        ultimo_etl_run = etl_row[0]
        # Stale si el último run exitoso es más viejo que 24h
        ahora = datetime.now(tz=UTC)
        finished = (
            ultimo_etl_run if ultimo_etl_run.tzinfo else ultimo_etl_run.replace(tzinfo=UTC)
        )
        etl_status = "success" if (ahora - finished).total_seconds() < 86400 else "stale"
    else:
        ultimo_etl_run = None
        etl_status = "never"

    return DashboardKPIs(
        saldo_total_consolidado=Decimal(saldos_row[0] or 0) if saldos_row else ZERO,
        saldo_total_cehta=Decimal(saldos_row[1] or 0) if saldos_row else ZERO,
        saldo_total_corfo=Decimal(saldos_row[2] or 0) if saldos_row else ZERO,
        egreso_mes_actual=egreso_now,
        egreso_mes_anterior=egreso_prev,
        egreso_delta_pct=calc_delta_pct(egreso_now, egreso_prev),
        abono_mes_actual=abono_now,
        abono_mes_anterior=abono_prev,
        abono_delta_pct=calc_delta_pct(abono_now, abono_prev),
        flujo_neto_mes=abono_now - egreso_now,
        iva_a_pagar_mes=iva_a_pagar,
        oc_emitidas_pendientes=int(oc_row[0]) if oc_row else 0,
        monto_oc_pendiente=Decimal(oc_row[1] or 0) if oc_row else ZERO,
        f29_proximas_30d=int(f29_row[0]) if f29_row else 0,
        f29_vencidas=int(f29_row[1]) if f29_row else 0,
        ultimo_etl_run=ultimo_etl_run,
        etl_status=etl_status,
    )


# =====================================================================
# GET /dashboard/cashflow — serie temporal
# =====================================================================
@router.get("/cashflow", response_model=CashflowResponse)
async def get_cashflow(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str | None = None,
    meses: Annotated[int, Query(ge=1, le=36)] = 12,
) -> CashflowResponse:
    """Devuelve los últimos N meses pivotando real vs proyectado.

    Si `empresa_codigo` es None, agrega sobre todo el portafolio.
    """
    where_empresa = "AND empresa_codigo = :empresa" if empresa_codigo else ""
    params: dict = {"meses": meses}
    if empresa_codigo:
        params["empresa"] = empresa_codigo

    rows = (
        await db.execute(
            text(f"""
                WITH agg AS (
                    SELECT
                        anio,
                        periodo,
                        SUM(total_abonos) FILTER (WHERE real_proyectado = 'Real')
                            AS abono_real,
                        SUM(total_egresos) FILTER (WHERE real_proyectado = 'Real')
                            AS egreso_real,
                        SUM(total_abonos) FILTER (WHERE real_proyectado = 'Proyectado')
                            AS abono_proy,
                        SUM(total_egresos) FILTER (WHERE real_proyectado = 'Proyectado')
                            AS egreso_proy
                    FROM core.v_flujo_caja
                    WHERE 1=1 {where_empresa}
                    GROUP BY anio, periodo
                )
                SELECT
                    periodo,
                    anio,
                    COALESCE(abono_real, 0)  AS abono_real,
                    COALESCE(egreso_real, 0) AS egreso_real,
                    COALESCE(abono_proy, 0)  AS abono_proy,
                    COALESCE(egreso_proy, 0) AS egreso_proy
                FROM agg
                ORDER BY anio DESC,
                         split_part(periodo, '_', 1)::int DESC
                LIMIT :meses
            """),
            params,
        )
    ).fetchall()

    # Ordenar cronológicamente (la query devuelve DESC para limitar a los últimos N)
    rows_asc = sorted(
        rows,
        key=lambda r: (r[1], int(r[0].split("_")[0]) if r[0] else 0),
    )

    # Saldo acumulado: suma de (abono_real + abono_proy) - (egreso_real + egreso_proy)
    pares = [
        (Decimal(r[2] or 0) + Decimal(r[4] or 0), Decimal(r[3] or 0) + Decimal(r[5] or 0))
        for r in rows_asc
    ]
    saldos = acumular_saldo(pares)

    points: list[CashflowPoint] = []
    for r, saldo in zip(rows_asc, saldos, strict=False):
        per = r[0]
        try:
            fecha_inicio = periodo_to_fecha_inicio(per)
        except ValueError:
            # periodo malformado en BD: skip
            continue
        abono_real = Decimal(r[2] or 0)
        egreso_real = Decimal(r[3] or 0)
        abono_proy = Decimal(r[4] or 0)
        egreso_proy = Decimal(r[5] or 0)
        points.append(
            CashflowPoint(
                periodo=per,
                fecha_inicio=fecha_inicio,
                abono_real=abono_real,
                egreso_real=egreso_real,
                abono_proyectado=abono_proy,
                egreso_proyectado=egreso_proy,
                flujo_neto_real=abono_real - egreso_real,
                flujo_neto_proyectado=abono_proy - egreso_proy,
                saldo_acumulado=saldo,
            )
        )

    return CashflowResponse(empresa_codigo=empresa_codigo, points=points)


# =====================================================================
# GET /dashboard/egresos-por-concepto — top 10 categorías
# =====================================================================
@router.get("/egresos-por-concepto", response_model=list[EgresoConcepto])
async def get_egresos_por_concepto(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str | None = None,
    periodo: str | None = None,
) -> list[EgresoConcepto]:
    """Top 10 conceptos por egreso del periodo. Default: periodo actual."""
    p = periodo or current_periodo()
    # validamos formato — si es inválido devolvemos lista vacía
    try:
        Periodo.parse(p)
    except ValueError:
        return []

    where_empresa = "AND empresa_codigo = :empresa" if empresa_codigo else ""
    params: dict = {"periodo": p}
    if empresa_codigo:
        params["empresa"] = empresa_codigo

    # where_empresa es un literal server-side, no input de usuario.
    sql = f"""
        WITH agg AS (
            SELECT
                COALESCE(concepto_general, 'Sin clasificar') AS concepto_general,
                concepto_detallado,
                SUM(egreso) AS total_egreso,
                COUNT(*)    AS num_movimientos
            FROM core.movimientos
            WHERE periodo = :periodo
              AND egreso > 0
              AND real_proyectado = 'Real'
              {where_empresa}
            GROUP BY concepto_general, concepto_detallado
        ),
        tot AS (SELECT SUM(total_egreso) AS gran_total FROM agg)
        SELECT a.concepto_general, a.concepto_detallado,
               a.total_egreso, a.num_movimientos,
               (SELECT gran_total FROM tot) AS gran_total
        FROM agg a
        ORDER BY a.total_egreso DESC
        LIMIT 10
    """  # noqa: S608
    rows = (await db.execute(text(sql), params)).fetchall()

    out: list[EgresoConcepto] = []
    for r in rows:
        total = Decimal(r[2] or 0)
        gran = Decimal(r[4] or 0)
        pct = float(round((total / gran * 100), 2)) if gran > 0 else 0.0
        out.append(
            EgresoConcepto(
                concepto_general=r[0],
                concepto_detallado=r[1],
                total_egreso=total,
                porcentaje=pct,
                num_movimientos=int(r[3]),
            )
        )
    return out


# =====================================================================
# GET /dashboard/saldos-por-empresa — detalle con delta 30d
# =====================================================================
@router.get("/saldos-por-empresa", response_model=list[SaldoEmpresaDetalle])
async def get_saldos_por_empresa(
    user: CurrentUser, db: DBSession
) -> list[SaldoEmpresaDetalle]:
    """Saldo actual + variación últimos 30 días por empresa."""
    rows = (
        await db.execute(
            text("""
                WITH ult AS (
                    SELECT DISTINCT ON (empresa_codigo)
                        empresa_codigo,
                        fecha,
                        saldo_contable,
                        saldo_cehta,
                        saldo_corfo
                    FROM core.movimientos
                    WHERE real_proyectado = 'Real'
                      AND saldo_contable IS NOT NULL
                    ORDER BY empresa_codigo, fecha DESC, movimiento_id DESC
                ),
                hace_30 AS (
                    SELECT DISTINCT ON (empresa_codigo)
                        empresa_codigo,
                        saldo_contable AS saldo_30d
                    FROM core.movimientos
                    WHERE real_proyectado = 'Real'
                      AND saldo_contable IS NOT NULL
                      AND fecha <= CURRENT_DATE - INTERVAL '30 days'
                    ORDER BY empresa_codigo, fecha DESC, movimiento_id DESC
                )
                SELECT
                    e.codigo,
                    e.razon_social,
                    u.saldo_contable,
                    u.saldo_cehta,
                    u.saldo_corfo,
                    u.fecha,
                    COALESCE(u.saldo_contable, 0) - COALESCE(h.saldo_30d, 0) AS delta_30d
                FROM core.empresas e
                LEFT JOIN ult     u ON u.empresa_codigo = e.codigo
                LEFT JOIN hace_30 h ON h.empresa_codigo = e.codigo
                WHERE e.activo = true
                ORDER BY e.codigo
            """)
        )
    ).fetchall()

    return [
        SaldoEmpresaDetalle(
            empresa_codigo=r[0],
            razon_social=r[1],
            saldo_contable=r[2],
            saldo_cehta=r[3],
            saldo_corfo=r[4],
            ultima_actualizacion=r[5],
            delta_30d=Decimal(r[6] or 0),
        )
        for r in rows
    ]


# =====================================================================
# GET /dashboard/iva-trend — IVA mes a mes
# =====================================================================
@router.get("/iva-trend", response_model=list[IvaPoint])
async def get_iva_trend(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str | None = None,
    meses: Annotated[int, Query(ge=1, le=36)] = 12,
) -> list[IvaPoint]:
    where_empresa = "WHERE empresa_codigo = :empresa" if empresa_codigo else ""
    params: dict = {"meses": meses}
    if empresa_codigo:
        params["empresa"] = empresa_codigo

    # where_empresa es un literal server-side, no input de usuario.
    sql = f"""
        WITH agg AS (
            SELECT
                anio,
                periodo,
                SUM(iva_credito) AS credito,
                SUM(iva_debito)  AS debito,
                SUM(iva_a_pagar) AS a_pagar
            FROM core.v_iva_consolidado
            {where_empresa}
            GROUP BY anio, periodo
        )
        SELECT periodo, anio, credito, debito, a_pagar
        FROM agg
        ORDER BY anio DESC,
                 split_part(periodo, '_', 1)::int DESC
        LIMIT :meses
    """  # noqa: S608
    rows = (await db.execute(text(sql), params)).fetchall()

    rows_asc = sorted(
        rows,
        key=lambda r: (r[1], int(r[0].split("_")[0]) if r[0] else 0),
    )

    out: list[IvaPoint] = []
    for r in rows_asc:
        try:
            fecha_inicio = periodo_to_fecha_inicio(r[0])
        except ValueError:
            continue
        out.append(
            IvaPoint(
                periodo=r[0],
                fecha_inicio=fecha_inicio,
                iva_credito=Decimal(r[2] or 0),
                iva_debito=Decimal(r[3] or 0),
                iva_a_pagar=Decimal(r[4] or 0),
            )
        )
    return out


# =====================================================================
# GET /dashboard/proyectos-ranking — top N proyectos últimos 12 meses
# =====================================================================
@router.get("/proyectos-ranking", response_model=list[ProyectoRanking])
async def get_proyectos_ranking(
    user: CurrentUser,
    db: DBSession,
    limit: Annotated[int, Query(ge=1, le=50)] = 5,
) -> list[ProyectoRanking]:
    rows = (
        await db.execute(
            text("""
                SELECT
                    proyecto,
                    SUM(egreso)                              AS total_egreso,
                    COUNT(*)                                 AS num_movimientos,
                    ARRAY_AGG(DISTINCT empresa_codigo)       AS empresas
                FROM core.movimientos
                WHERE proyecto IS NOT NULL
                  AND egreso > 0
                  AND real_proyectado = 'Real'
                  AND fecha >= CURRENT_DATE - INTERVAL '12 months'
                GROUP BY proyecto
                ORDER BY total_egreso DESC
                LIMIT :limit
            """),
            {"limit": limit},
        )
    ).fetchall()

    return [
        ProyectoRanking(
            proyecto=r[0],
            total_egreso=Decimal(r[1] or 0),
            num_movimientos=int(r[2]),
            empresas=list(r[3]) if r[3] else [],
        )
        for r in rows
    ]


# =====================================================================
# GET /dashboard/movimientos-recientes — feed de actividad
# =====================================================================
@router.get("/movimientos-recientes", response_model=list[MovimientoReciente])
async def get_movimientos_recientes(
    user: CurrentUser,
    db: DBSession,
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> list[MovimientoReciente]:
    rows = (
        await db.execute(
            text("""
                SELECT movimiento_id, fecha::text, empresa_codigo,
                       descripcion, abono, egreso, concepto_general, proyecto
                FROM core.movimientos
                WHERE real_proyectado = 'Real'
                ORDER BY fecha DESC, movimiento_id DESC
                LIMIT :limit
            """),
            {"limit": limit},
        )
    ).fetchall()

    return [
        MovimientoReciente(
            movimiento_id=r[0],
            fecha=r[1],
            empresa_codigo=r[2],
            descripcion=r[3],
            abono=r[4] or 0,
            egreso=r[5] or 0,
            concepto_general=r[6],
            proyecto=r[7],
        )
        for r in rows
    ]


# =====================================================================
# CEO Dashboard helpers (puros, testeables sin DB)
# =====================================================================
def compute_health_score(
    saldo_contable: Decimal,
    flujo_neto_30d: Decimal,
    f29_vencidas: int,
    f29_proximas: int,
    oc_pendientes: int,
) -> int:
    """Score 0-100 que combina los KPIs operativos por empresa.

    Lógica simple, transparente y reversible:
    - Empezamos en 100.
    - F29 vencidas: -25 c/u (capeado a -50)
    - F29 próximas (sin vencidas que ya descontaron): -5 c/u (capeado a -15)
    - Flujo neto 30d negativo: -20 si <0
    - Saldo ≤ 0: -25
    - OCs pendientes >10: -10 (carga operativa)
    """
    score = 100
    score -= min(25 * f29_vencidas, 50)
    if f29_vencidas == 0:
        score -= min(5 * f29_proximas, 15)
    if flujo_neto_30d < 0:
        score -= 20
    if saldo_contable <= 0:
        score -= 25
    if oc_pendientes > 10:
        score -= 10
    return max(0, min(100, score))


def trend_from_flujo(flujo_neto_30d: Decimal) -> str:
    if flujo_neto_30d > 0:
        return "up"
    if flujo_neto_30d < 0:
        return "down"
    return "flat"


def color_for_score(value: int) -> str:
    """Mapeo color heatmap: ≥80 verde, 60-79 amarillo, <60 rojo."""
    if value >= 80:
        return "green"
    if value >= 60:
        return "yellow"
    return "red"


# =====================================================================
# GET /dashboard/ceo-consolidated — vista consolidada para Dashboard CEO
# =====================================================================
@router.get("/ceo-consolidated", response_model=CEOConsolidatedReport)
async def ceo_consolidated(
    user: Annotated[AuthenticatedUser, Depends(require_scope("ceo:read"))],
    db: DBSession,
) -> CEOConsolidatedReport:
    """Reporte consolidado para Dashboard CEO.

    Datos reales calculados sobre los movimientos / OC / F29 ya cargados.
    El bloque `insights_ai` queda como placeholder hasta integrar con el
    AI Asistente (V3 fase 3 — separado).
    """
    # ----- AUM consolidado (último saldo por empresa) ---------------------
    aum_row = (
        await db.execute(
            text("""
                SELECT
                    COALESCE(SUM(saldo_contable), 0) AS aum_total,
                    COALESCE(SUM(saldo_cehta),    0) AS aum_cehta,
                    COALESCE(SUM(saldo_corfo),    0) AS aum_corfo
                FROM core.v_saldos_actuales
            """)
        )
    ).fetchone()

    aum_total = Decimal(aum_row[0] or 0) if aum_row else ZERO
    aum_cehta = Decimal(aum_row[1] or 0) if aum_row else ZERO
    aum_corfo = Decimal(aum_row[2] or 0) if aum_row else ZERO

    # ----- Saldos hace 30/90 días por empresa para deltas -----------------
    deltas_rows = (
        await db.execute(
            text("""
                WITH ult AS (
                    SELECT DISTINCT ON (empresa_codigo)
                        empresa_codigo, COALESCE(saldo_contable, 0) AS saldo_actual
                    FROM core.movimientos
                    WHERE real_proyectado = 'Real' AND saldo_contable IS NOT NULL
                    ORDER BY empresa_codigo, fecha DESC, movimiento_id DESC
                ),
                hace_30 AS (
                    SELECT DISTINCT ON (empresa_codigo)
                        empresa_codigo, COALESCE(saldo_contable, 0) AS s30
                    FROM core.movimientos
                    WHERE real_proyectado = 'Real' AND saldo_contable IS NOT NULL
                      AND fecha <= CURRENT_DATE - INTERVAL '30 days'
                    ORDER BY empresa_codigo, fecha DESC, movimiento_id DESC
                ),
                hace_90 AS (
                    SELECT DISTINCT ON (empresa_codigo)
                        empresa_codigo, COALESCE(saldo_contable, 0) AS s90
                    FROM core.movimientos
                    WHERE real_proyectado = 'Real' AND saldo_contable IS NOT NULL
                      AND fecha <= CURRENT_DATE - INTERVAL '90 days'
                    ORDER BY empresa_codigo, fecha DESC, movimiento_id DESC
                )
                SELECT
                    COALESCE(SUM(u.saldo_actual), 0) AS now,
                    COALESCE(SUM(h30.s30), 0)        AS prev_30,
                    COALESCE(SUM(h90.s90), 0)        AS prev_90
                FROM ult u
                LEFT JOIN hace_30 h30 ON h30.empresa_codigo = u.empresa_codigo
                LEFT JOIN hace_90 h90 ON h90.empresa_codigo = u.empresa_codigo
            """)
        )
    ).fetchone()
    saldo_now = Decimal(deltas_rows[0] or 0) if deltas_rows else ZERO
    saldo_30d = Decimal(deltas_rows[1] or 0) if deltas_rows else ZERO
    saldo_90d = Decimal(deltas_rows[2] or 0) if deltas_rows else ZERO
    delta_30d_pct = calc_delta_pct(saldo_now, saldo_30d)
    delta_90d_pct = calc_delta_pct(saldo_now, saldo_90d)

    # ----- Flujo neto del portafolio últimos 30 días ----------------------
    flujo_row = (
        await db.execute(
            text("""
                SELECT COALESCE(SUM(abono), 0) - COALESCE(SUM(egreso), 0)
                FROM core.movimientos
                WHERE real_proyectado = 'Real'
                  AND fecha >= CURRENT_DATE - INTERVAL '30 days'
            """)
        )
    ).fetchone()
    flujo_neto_30d = Decimal(flujo_row[0] or 0) if flujo_row else ZERO

    # ----- KPIs por empresa -----------------------------------------------
    by_empresa_rows = (
        await db.execute(
            text("""
                WITH saldo_actual AS (
                    SELECT DISTINCT ON (empresa_codigo)
                        empresa_codigo,
                        COALESCE(saldo_contable, 0) AS saldo_contable
                    FROM core.movimientos
                    WHERE real_proyectado = 'Real' AND saldo_contable IS NOT NULL
                    ORDER BY empresa_codigo, fecha DESC, movimiento_id DESC
                ),
                flujo_30 AS (
                    SELECT empresa_codigo,
                           COALESCE(SUM(abono), 0) - COALESCE(SUM(egreso), 0) AS flujo
                    FROM core.movimientos
                    WHERE real_proyectado = 'Real'
                      AND fecha >= CURRENT_DATE - INTERVAL '30 days'
                    GROUP BY empresa_codigo
                ),
                oc_pend AS (
                    SELECT empresa_codigo,
                           COUNT(*) FILTER (WHERE estado = 'emitida') AS n_oc,
                           COALESCE(SUM(total) FILTER (WHERE estado = 'emitida'), 0) AS monto_oc
                    FROM core.ordenes_compra
                    GROUP BY empresa_codigo
                ),
                f29 AS (
                    SELECT empresa_codigo,
                           COUNT(*) FILTER (WHERE dias_para_vencer BETWEEN 0 AND 30)
                               AS proximas,
                           COUNT(*) FILTER (WHERE dias_para_vencer < 0 AND estado = 'pendiente')
                               AS vencidas
                    FROM core.v_f29_alertas
                    GROUP BY empresa_codigo
                )
                SELECT
                    e.codigo,
                    e.razon_social,
                    COALESCE(s.saldo_contable, 0)                AS saldo_contable,
                    COALESCE(f.flujo, 0)                         AS flujo_neto_30d,
                    COALESCE(o.n_oc, 0)                          AS oc_pendientes,
                    COALESCE(o.monto_oc, 0)                      AS monto_oc_pendiente,
                    COALESCE(f29.proximas, 0)                    AS f29_proximas,
                    COALESCE(f29.vencidas, 0)                    AS f29_vencidas
                FROM core.empresas e
                LEFT JOIN saldo_actual s ON s.empresa_codigo = e.codigo
                LEFT JOIN flujo_30 f     ON f.empresa_codigo = e.codigo
                LEFT JOIN oc_pend o      ON o.empresa_codigo = e.codigo
                LEFT JOIN f29 f29        ON f29.empresa_codigo = e.codigo
                WHERE e.activo = true
                ORDER BY e.codigo
            """)
        )
    ).fetchall()

    by_empresa: list[EmpresaCEOKPIs] = []
    heatmap: list[HeatmapCell] = []
    top_alerts: list[Alert] = []

    for r in by_empresa_rows:
        empresa_codigo = r[0]
        razon_social = r[1]
        saldo = Decimal(r[2] or 0)
        flujo = Decimal(r[3] or 0)
        oc_pend = int(r[4] or 0)
        monto_oc = Decimal(r[5] or 0)
        f29_prox = int(r[6] or 0)
        f29_venc = int(r[7] or 0)

        score = compute_health_score(saldo, flujo, f29_venc, f29_prox, oc_pend)
        trend = trend_from_flujo(flujo)

        by_empresa.append(
            EmpresaCEOKPIs(
                empresa_codigo=empresa_codigo,
                razon_social=razon_social,
                saldo_contable=saldo,
                flujo_neto_30d=flujo,
                oc_pendientes=oc_pend,
                monto_oc_pendiente=monto_oc,
                f29_proximas=f29_prox,
                f29_vencidas=f29_venc,
                health_score=score,
                trend=trend,
            )
        )

        # Heatmap 6 columnas: saldo / flujo / oc / f29 / etl / audit
        saldo_score = 100 if saldo > 0 else 0
        flujo_score = 100 if flujo >= 0 else 30
        oc_score = 100 if oc_pend <= 5 else (60 if oc_pend <= 10 else 30)
        f29_score = (
            100
            if (f29_venc == 0 and f29_prox == 0)
            else (60 if f29_venc == 0 else 20)
        )
        # ETL/audit son globales, pero los exponemos por empresa con el
        # mismo valor (placeholder hasta que tengamos estado per-empresa).
        etl_score = 100
        audit_score = 100

        for kpi, value in [
            ("saldo", saldo_score),
            ("flujo", flujo_score),
            ("oc", oc_score),
            ("f29", f29_score),
            ("etl", etl_score),
            ("audit", audit_score),
        ]:
            heatmap.append(
                HeatmapCell(
                    empresa_codigo=empresa_codigo,
                    kpi=kpi,
                    value=value,
                    color=color_for_score(value),
                )
            )

        # Alertas priorizadas
        if f29_venc > 0:
            top_alerts.append(
                Alert(
                    severity="critical",
                    empresa_codigo=empresa_codigo,
                    title=f"{empresa_codigo}: {f29_venc} F29 vencida(s)",
                    detail=f"{razon_social} tiene {f29_venc} F29 sin pagar fuera de plazo.",
                    href="/f29",
                )
            )
        if saldo <= 0:
            top_alerts.append(
                Alert(
                    severity="critical",
                    empresa_codigo=empresa_codigo,
                    title=f"{empresa_codigo}: saldo no positivo",
                    detail=f"Saldo contable de {razon_social}: {saldo}.",
                    href=f"/empresa/{empresa_codigo}",
                )
            )
        if flujo < 0 and saldo > 0:
            top_alerts.append(
                Alert(
                    severity="warning",
                    empresa_codigo=empresa_codigo,
                    title=f"{empresa_codigo}: flujo neto 30d negativo",
                    detail=f"{razon_social} con flujo {flujo} en últimos 30 días.",
                    href=f"/empresa/{empresa_codigo}",
                )
            )
        if f29_prox > 0 and f29_venc == 0:
            top_alerts.append(
                Alert(
                    severity="warning",
                    empresa_codigo=empresa_codigo,
                    title=f"{empresa_codigo}: {f29_prox} F29 próxima(s) a vencer",
                    detail=f"{razon_social} tiene {f29_prox} F29 con vencimiento ≤30 días.",
                    href="/f29",
                )
            )

    # Ordenar alertas: critical → warning → info, y por empresa.
    severity_rank = {"critical": 0, "warning": 1, "info": 2}
    top_alerts.sort(
        key=lambda a: (severity_rank.get(a.severity, 9), a.empresa_codigo or "")
    )

    insights_ai = (
        "Resumen ejecutivo automatizado próximamente: cuando el AI Asistente "
        "esté integrado, este bloque mostrará un análisis semanal con drivers "
        "de cambio, riesgos detectados y recomendaciones priorizadas."
    )

    return CEOConsolidatedReport(
        aum_total=aum_total,
        aum_cehta=aum_cehta,
        aum_corfo=aum_corfo,
        delta_30d=delta_30d_pct,
        delta_90d=delta_90d_pct,
        flujo_neto_30d=flujo_neto_30d,
        by_empresa=by_empresa,
        heatmap=heatmap,
        top_alerts=top_alerts[:10],
        insights_ai=insights_ai,
        last_updated=datetime.now(tz=UTC),
    )
