"""Endpoints de reportes contables formales (V5 Fase 4).

Consume el service `reportes_contables_service` y devuelve JSON
estructurado para que el frontend renderice + permita print/PDF.

Endpoints:
  GET /reportes/contables/libro-diario       (empresa + rango fechas)
  GET /reportes/contables/libro-mayor        (empresa + cuenta + rango)
  GET /reportes/contables/pl-proyecto        (empresa + rango)
  GET /reportes/contables/pl-area            (empresa + rango)
  GET /reportes/contables/rendicion-corfo    (proyecto + rango)
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.api.deps import CurrentUser, DBSession
from app.services.reportes_contables_service import (
    libro_diario,
    libro_mayor,
    pl_por_area,
    pl_por_proyecto,
    rendicion_corfo,
)

router = APIRouter()


class LibroDiarioRow(BaseModel):
    voucher_id: int
    voucher_codigo: str
    voucher_tipo: str
    fecha_contable: date
    glosa: str
    contraparte_nombre: str | None
    line_number: int
    cuenta_codigo: str
    cuenta_nombre: str
    proyecto_codigo: str | None
    area_codigo: str | None
    debit: Decimal
    credit: Decimal
    linea_descripcion: str | None


class LibroMayorMovimiento(BaseModel):
    voucher_id: int
    voucher_codigo: str
    fecha_contable: date
    glosa: str
    contraparte_nombre: str | None
    line_number: int
    linea_descripcion: str | None
    proyecto_codigo: str | None
    area_codigo: str | None
    debit: Decimal
    credit: Decimal


class CuentaMeta(BaseModel):
    codigo: str
    nombre: str
    tipo: str
    nivel: int


class LibroMayorReport(BaseModel):
    cuenta: CuentaMeta | None
    fecha_desde: date
    fecha_hasta: date
    saldo_apertura: Decimal
    total_debe: Decimal
    total_haber: Decimal
    saldo_cierre: Decimal
    movimientos: list[LibroMayorMovimiento]


class PLProyectoRow(BaseModel):
    proyecto_codigo: str
    proyecto_nombre: str
    tipo_financiamiento: str | None
    ingresos: Decimal
    gastos: Decimal
    resultado: Decimal


class PLAreaRow(BaseModel):
    area_codigo: str
    area_nombre: str
    ingresos: Decimal
    gastos: Decimal
    resultado: Decimal


class RendicionCorfoLinea(BaseModel):
    voucher_codigo: str
    fecha_contable: date
    glosa: str
    contraparte_nombre: str | None
    contraparte_rut: str | None
    doc_tributario_tipo: str | None
    doc_tributario_folio: str | None
    line_number: int
    cuenta_codigo: str
    cuenta_nombre: str
    tipo_gasto_corfo: str | None
    area_codigo: str | None
    debit: Decimal
    credit: Decimal
    linea_descripcion: str | None


class RendicionCorfoTipoGasto(BaseModel):
    tipo_gasto: str
    monto: Decimal


class RendicionCorfoProyectoMeta(BaseModel):
    codigo: str
    empresa_codigo: str
    nombre: str
    tipo_financiamiento: str
    programa: str | None
    presupuesto_total: Decimal | None
    primer_desembolso_corfo: date | None
    tipos_gasto_elegibles: list[str]


class RendicionCorfoReport(BaseModel):
    proyecto: RendicionCorfoProyectoMeta | None
    fecha_desde: date | None = None
    fecha_hasta: date | None = None
    lineas: list[RendicionCorfoLinea]
    desglose_por_tipo_gasto: list[RendicionCorfoTipoGasto]
    total: Decimal


# =====================================================================
# Endpoints
# =====================================================================


@router.get(
    "/reportes/contables/libro-diario",
    response_model=list[LibroDiarioRow],
)
async def get_libro_diario(
    user: CurrentUser,
    db: DBSession,
    empresa: Annotated[str, Query(min_length=2, max_length=20)],
    fecha_desde: Annotated[date, Query()],
    fecha_hasta: Annotated[date, Query()],
) -> list[LibroDiarioRow]:
    rows = await libro_diario(
        db,
        empresa_codigo=empresa,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
    )
    return [LibroDiarioRow.model_validate(r) for r in rows]


@router.get(
    "/reportes/contables/libro-mayor",
    response_model=LibroMayorReport,
)
async def get_libro_mayor(
    user: CurrentUser,
    db: DBSession,
    empresa: Annotated[str, Query(min_length=2, max_length=20)],
    cuenta: Annotated[str, Query(min_length=1)],
    fecha_desde: Annotated[date, Query()],
    fecha_hasta: Annotated[date, Query()],
) -> LibroMayorReport:
    data = await libro_mayor(
        db,
        empresa_codigo=empresa,
        cuenta_codigo=cuenta,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
    )
    return LibroMayorReport.model_validate(data)


@router.get(
    "/reportes/contables/pl-proyecto",
    response_model=list[PLProyectoRow],
)
async def get_pl_proyecto(
    user: CurrentUser,
    db: DBSession,
    empresa: Annotated[str, Query(min_length=2, max_length=20)],
    fecha_desde: Annotated[date, Query()],
    fecha_hasta: Annotated[date, Query()],
) -> list[PLProyectoRow]:
    rows = await pl_por_proyecto(
        db,
        empresa_codigo=empresa,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
    )
    return [PLProyectoRow.model_validate(r) for r in rows]


@router.get(
    "/reportes/contables/pl-area",
    response_model=list[PLAreaRow],
)
async def get_pl_area(
    user: CurrentUser,
    db: DBSession,
    empresa: Annotated[str, Query(min_length=2, max_length=20)],
    fecha_desde: Annotated[date, Query()],
    fecha_hasta: Annotated[date, Query()],
) -> list[PLAreaRow]:
    rows = await pl_por_area(
        db,
        empresa_codigo=empresa,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
    )
    return [PLAreaRow.model_validate(r) for r in rows]


@router.get(
    "/reportes/contables/rendicion-corfo",
    response_model=RendicionCorfoReport,
)
async def get_rendicion_corfo(
    user: CurrentUser,
    db: DBSession,
    proyecto: Annotated[str, Query(min_length=8)],
    fecha_desde: Annotated[date, Query()],
    fecha_hasta: Annotated[date, Query()],
) -> RendicionCorfoReport:
    data = await rendicion_corfo(
        db,
        proyecto_codigo=proyecto,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
    )
    return RendicionCorfoReport.model_validate(data)


# ============================================================================
# Reportes HTML/PDF — server-side render con CSS print embedido
# ============================================================================
#
# Endpoints que devuelven HTML self-contained imprimible. El user abre el
# link en su browser → Ctrl+P → "Guardar como PDF" → archivo formal.
#
# Si la URL incluye `?print=1`, el HTML auto-dispara window.print() al cargar.
#
# Estos endpoints son alternativos a los GET JSON existentes — el frontend
# los puede linkear como "Descargar PDF" y abrir en nueva tab.


from fastapi.responses import HTMLResponse  # noqa: E402

from app.services.report_renderer_service import (  # noqa: E402
    render_balance_general_html,
    render_balance_prueba_html,
    render_cashflow_mensual_html,
    render_cierre_mensual_html,
    render_consolidado_fondo_html,
    render_estado_resultados_html,
    render_libro_diario_html,
    render_pl_mensual_html,
)


@router.get(
    "/reportes/contables/libro-diario.html",
    response_class=HTMLResponse,
)
async def get_libro_diario_html(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: Annotated[str, Query(min_length=2, max_length=20)],
    fecha_desde: Annotated[date, Query()],
    fecha_hasta: Annotated[date, Query()],
) -> HTMLResponse:
    """Renderea el libro diario como HTML imprimible (Ctrl+P → PDF)."""
    rows_raw = await libro_diario(
        db,
        empresa_codigo=empresa_codigo,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
    )
    rows = [
        {
            "voucher_codigo": r.voucher_codigo,
            "fecha_contable": r.fecha_contable,
            "glosa": r.glosa or "",
            "line_number": r.line_number,
            "cuenta_codigo": r.cuenta_codigo,
            "cuenta_nombre": r.cuenta_nombre,
            "debit": r.debit,
            "credit": r.credit,
            "descripcion": r.linea_descripcion or "",
        }
        for r in rows_raw
    ]
    html = render_libro_diario_html(
        empresa_codigo=empresa_codigo,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        rows=rows,
    )
    return HTMLResponse(content=html)


@router.get(
    "/reportes/contables/balance-prueba.html",
    response_class=HTMLResponse,
)
async def get_balance_prueba_html(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: Annotated[str, Query(min_length=2, max_length=20)],
    fecha_desde: Annotated[date, Query()],
    fecha_hasta: Annotated[date, Query()],
) -> HTMLResponse:
    """Balance de prueba: saldos por cuenta agrupados.

    Computado con SQL agregado de voucher_lines en el rango. Solo cuentas
    con movimiento. Cuadrado (Σ debe = Σ haber).
    """
    from sqlalchemy import text

    rows_db = (
        await db.execute(
            text(
                """
                SELECT
                    vl.cuenta_codigo,
                    pc.nombre AS cuenta_nombre,
                    SUM(vl.debit) AS suma_debe,
                    SUM(vl.credit) AS suma_haber,
                    SUM(vl.debit - vl.credit) AS saldo
                FROM core.voucher_lines vl
                JOIN core.vouchers v USING (voucher_id)
                LEFT JOIN core.plan_cuentas pc ON pc.codigo = vl.cuenta_codigo
                WHERE v.empresa_codigo = :emp
                  AND v.fecha_contable BETWEEN :desde AND :hasta
                  AND v.status IN ('APPROVED', 'EXECUTED', 'SYNCED', 'RECONCILED')
                GROUP BY vl.cuenta_codigo, pc.nombre
                HAVING SUM(vl.debit + vl.credit) > 0
                ORDER BY vl.cuenta_codigo
                """
            ),
            {
                "emp": empresa_codigo,
                "desde": fecha_desde,
                "hasta": fecha_hasta,
            },
        )
    ).mappings().all()

    rows = [dict(r) for r in rows_db]

    html = render_balance_prueba_html(
        empresa_codigo=empresa_codigo,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
        rows=rows,
    )
    return HTMLResponse(content=html)


@router.get(
    "/reportes/contables/cierre-mensual.html",
    response_class=HTMLResponse,
)
async def get_cierre_mensual_html(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: Annotated[str, Query(min_length=2, max_length=20)],
    anio: Annotated[int, Query(ge=2020, le=2100)],
    mes: Annotated[int, Query(ge=1, le=12)],
) -> HTMLResponse:
    """Reporte de cierre mensual con checklist + KPIs.

    Agrega: counts de vouchers (pending/approved), F29 status, cartolas
    importadas, movimientos cargados. Sirve como hoja de ruta para
    cerrar el mes y generar export Nubox.
    """
    from sqlalchemy import text

    # Counts vouchers del mes
    counts = (
        await db.execute(
            text(
                """
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status = 'PENDING') AS pending,
                    COUNT(*) FILTER (WHERE status IN ('APPROVED', 'EXECUTED', 'SYNCED', 'RECONCILED')) AS approved
                FROM core.vouchers
                WHERE empresa_codigo = :emp
                  AND EXTRACT(year FROM fecha_contable) = :anio
                  AND EXTRACT(month FROM fecha_contable) = :mes
                """
            ),
            {"emp": empresa_codigo, "anio": anio, "mes": mes},
        )
    ).first()
    total, pending, approved = (
        (int(counts[0] or 0), int(counts[1] or 0), int(counts[2] or 0))
        if counts else (0, 0, 0)
    )

    # F29 del período
    periodo_f29 = f"{mes:02d}_{str(anio)[-2:]}"
    f29_row = (
        await db.execute(
            text(
                """
                SELECT estado, fecha_vencimiento::text AS fecha_vencimiento,
                       monto_a_pagar, fecha_pago::text AS fecha_pago
                FROM core.f29_obligaciones
                WHERE empresa_codigo = :emp AND periodo_tributario = :p
                LIMIT 1
                """
            ),
            {"emp": empresa_codigo, "p": periodo_f29},
        )
    ).mappings().first()
    f29_status = dict(f29_row) if f29_row else None

    # Cartolas y movimientos del mes
    try:
        cartolas_row = (
            await db.execute(
                text(
                    """
                    SELECT COUNT(*) FROM core.cartolas_runs
                    WHERE empresa_codigo = :emp
                      AND EXTRACT(year FROM triggered_at) = :anio
                      AND EXTRACT(month FROM triggered_at) = :mes
                      AND status = 'imported'
                    """
                ),
                {"emp": empresa_codigo, "anio": anio, "mes": mes},
            )
        ).first()
        cartolas_imported = int(cartolas_row[0] or 0) if cartolas_row else 0
    except Exception:
        cartolas_imported = 0

    movs_row = (
        await db.execute(
            text(
                """
                SELECT COUNT(*) FROM core.movimientos
                WHERE empresa_codigo = :emp
                  AND EXTRACT(year FROM fecha) = :anio
                  AND EXTRACT(month FROM fecha) = :mes
                """
            ),
            {"emp": empresa_codigo, "anio": anio, "mes": mes},
        )
    ).first()
    movimientos_inserted = int(movs_row[0] or 0) if movs_row else 0

    html = render_cierre_mensual_html(
        empresa_codigo=empresa_codigo,
        anio=anio,
        mes=mes,
        voucher_count=total,
        f29_status=f29_status,
        cartolas_imported=cartolas_imported,
        movimientos_inserted=movimientos_inserted,
        vouchers_pending=pending,
        vouchers_approved=approved,
    )
    return HTMLResponse(content=html)



@router.get(
    "/reportes/contables/cashflow-mensual.html",
    response_class=HTMLResponse,
)
async def get_cashflow_mensual_html(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: Annotated[str, Query(min_length=2, max_length=20)],
    anio: Annotated[int, Query(ge=2020, le=2100)],
) -> HTMLResponse:
    """Cashflow mensual — entradas vs salidas mes a mes del año.

    Agrega abonos/egresos de core.movimientos por mes + saldo acumulado
    corrido desde enero.
    """
    from sqlalchemy import text

    rows_db = (
        await db.execute(
            text(
                """
                WITH meses AS (
                    SELECT generate_series(1, 12) AS mes
                ),
                aggregated AS (
                    SELECT
                        EXTRACT(month FROM fecha)::int AS mes,
                        COALESCE(SUM(abono), 0) AS abonos,
                        COALESCE(SUM(egreso), 0) AS egresos
                    FROM core.movimientos
                    WHERE empresa_codigo = :emp
                      AND EXTRACT(year FROM fecha) = :anio
                    GROUP BY EXTRACT(month FROM fecha)
                )
                SELECT
                    m.mes,
                    COALESCE(a.abonos, 0) AS abonos,
                    COALESCE(a.egresos, 0) AS egresos,
                    SUM(COALESCE(a.abonos, 0) - COALESCE(a.egresos, 0))
                        OVER (ORDER BY m.mes ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                        AS saldo_acumulado
                FROM meses m
                LEFT JOIN aggregated a ON a.mes = m.mes
                ORDER BY m.mes
                """
            ),
            {"emp": empresa_codigo, "anio": anio},
        )
    ).mappings().all()

    rows = [dict(r) for r in rows_db]
    html = render_cashflow_mensual_html(
        empresa_codigo=empresa_codigo,
        anio=anio,
        rows_by_month=rows,
    )
    return HTMLResponse(content=html)



@router.get(
    "/reportes/contables/pl-mensual.html",
    response_class=HTMLResponse,
)
async def get_pl_mensual_html(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: Annotated[str, Query(min_length=2, max_length=20)],
    anio: Annotated[int, Query(ge=2020, le=2100)],
) -> HTMLResponse:
    """P&L mensual — ingresos (cuentas 4-*) vs gastos (cuentas 5-*) por mes.

    Solo voucher_lines aprobados+ (APPROVED, EXECUTED, SYNCED, RECONCILED).
    Plan de cuentas chileno estándar.
    """
    from sqlalchemy import text

    rows_db = (
        await db.execute(
            text(
                """
                WITH meses AS (
                    SELECT generate_series(1, 12) AS mes
                ),
                aggregated AS (
                    SELECT
                        EXTRACT(month FROM v.fecha_contable)::int AS mes,
                        COALESCE(SUM(
                            CASE WHEN LEFT(vl.cuenta_codigo, 1) = '4'
                            THEN vl.credit - vl.debit ELSE 0 END
                        ), 0) AS ingresos,
                        COALESCE(SUM(
                            CASE WHEN LEFT(vl.cuenta_codigo, 1) = '5'
                            THEN vl.debit - vl.credit ELSE 0 END
                        ), 0) AS gastos
                    FROM core.voucher_lines vl
                    JOIN core.vouchers v USING (voucher_id)
                    WHERE v.empresa_codigo = :emp
                      AND EXTRACT(year FROM v.fecha_contable) = :anio
                      AND v.status IN ('APPROVED', 'EXECUTED', 'SYNCED', 'RECONCILED')
                    GROUP BY EXTRACT(month FROM v.fecha_contable)
                )
                SELECT m.mes,
                       COALESCE(a.ingresos, 0) AS ingresos,
                       COALESCE(a.gastos, 0) AS gastos
                FROM meses m
                LEFT JOIN aggregated a ON a.mes = m.mes
                ORDER BY m.mes
                """
            ),
            {"emp": empresa_codigo, "anio": anio},
        )
    ).mappings().all()

    rows = [dict(r) for r in rows_db]
    html = render_pl_mensual_html(
        empresa_codigo=empresa_codigo,
        anio=anio,
        rows_by_month=rows,
    )
    return HTMLResponse(content=html)



@router.get(
    "/reportes/contables/estado-resultados.html",
    response_class=HTMLResponse,
)
async def get_estado_resultados_html(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: Annotated[str, Query(min_length=2, max_length=20)],
    anio: Annotated[int, Query(ge=2020, le=2100)],
) -> HTMLResponse:
    """Estado de Resultados anual jerárquico (cuentas 4-* y 5-*)."""
    from sqlalchemy import text

    rows_db = (
        await db.execute(
            text(
                """
                SELECT
                    pc.codigo AS cuenta_codigo,
                    pc.nombre AS cuenta_nombre,
                    pc.nivel,
                    CASE
                        WHEN LEFT(pc.codigo, 1) = '4' THEN
                            COALESCE(SUM(vl.credit - vl.debit), 0)
                        WHEN LEFT(pc.codigo, 1) = '5' THEN
                            COALESCE(SUM(vl.debit - vl.credit), 0)
                        ELSE 0
                    END AS monto,
                    FALSE AS es_total
                FROM core.plan_cuentas pc
                LEFT JOIN core.voucher_lines vl ON vl.cuenta_codigo = pc.codigo
                LEFT JOIN core.vouchers v ON v.voucher_id = vl.voucher_id
                    AND v.empresa_codigo = :emp
                    AND EXTRACT(year FROM v.fecha_contable) = :anio
                    AND v.status IN ('APPROVED', 'EXECUTED', 'SYNCED', 'RECONCILED')
                WHERE LEFT(pc.codigo, 1) IN ('4', '5')
                GROUP BY pc.codigo, pc.nombre, pc.nivel
                HAVING (
                    LEFT(pc.codigo, 1) = '4'
                    AND COALESCE(SUM(vl.credit - vl.debit), 0) <> 0
                ) OR (
                    LEFT(pc.codigo, 1) = '5'
                    AND COALESCE(SUM(vl.debit - vl.credit), 0) <> 0
                )
                ORDER BY pc.codigo
                """
            ),
            {"emp": empresa_codigo, "anio": anio},
        )
    ).mappings().all()

    rows = [dict(r) for r in rows_db]
    html = render_estado_resultados_html(
        empresa_codigo=empresa_codigo,
        anio=anio,
        rows=rows,
    )
    return HTMLResponse(content=html)


@router.get(
    "/reportes/contables/balance-general.html",
    response_class=HTMLResponse,
)
async def get_balance_general_html(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: Annotated[str, Query(min_length=2, max_length=20)],
    fecha_corte: Annotated[date, Query()],
) -> HTMLResponse:
    """Balance General (Activo / Pasivo / Patrimonio) a fecha de corte."""
    from sqlalchemy import text

    rows_db = (
        await db.execute(
            text(
                """
                SELECT
                    pc.codigo AS cuenta_codigo,
                    pc.nombre AS cuenta_nombre,
                    pc.nivel,
                    CASE
                        WHEN LEFT(pc.codigo, 1) = '1' THEN
                            COALESCE(SUM(vl.debit - vl.credit), 0)
                        WHEN LEFT(pc.codigo, 1) IN ('2', '3') THEN
                            COALESCE(SUM(vl.credit - vl.debit), 0)
                        ELSE 0
                    END AS saldo,
                    FALSE AS es_total
                FROM core.plan_cuentas pc
                LEFT JOIN core.voucher_lines vl ON vl.cuenta_codigo = pc.codigo
                LEFT JOIN core.vouchers v ON v.voucher_id = vl.voucher_id
                    AND v.empresa_codigo = :emp
                    AND v.fecha_contable <= :fecha
                    AND v.status IN ('APPROVED', 'EXECUTED', 'SYNCED', 'RECONCILED')
                WHERE LEFT(pc.codigo, 1) IN ('1', '2', '3')
                GROUP BY pc.codigo, pc.nombre, pc.nivel
                HAVING ABS(COALESCE(SUM(vl.debit - vl.credit), 0)) > 0
                    OR ABS(COALESCE(SUM(vl.credit - vl.debit), 0)) > 0
                ORDER BY pc.codigo
                """
            ),
            {"emp": empresa_codigo, "fecha": fecha_corte},
        )
    ).mappings().all()

    rows = [dict(r) for r in rows_db]
    html = render_balance_general_html(
        empresa_codigo=empresa_codigo,
        fecha_corte=fecha_corte,
        rows=rows,
    )
    return HTMLResponse(content=html)



@router.get(
    "/reportes/contables/consolidado-fondo.html",
    response_class=HTMLResponse,
)
async def get_consolidado_fondo_html(
    user: CurrentUser,
    db: DBSession,
    anio: Annotated[int, Query(ge=2020, le=2100)],
) -> HTMLResponse:
    """Reporte consolidado del fondo — todas las empresas activas del portafolio."""
    from sqlalchemy import text

    rows_db = (
        await db.execute(
            text(
                """
                SELECT
                    e.codigo AS empresa_codigo,
                    e.razon_social,
                    COALESCE(SUM(
                        CASE WHEN LEFT(vl.cuenta_codigo, 1) = '4'
                        THEN vl.credit - vl.debit ELSE 0 END
                    ), 0) AS ingresos,
                    COALESCE(SUM(
                        CASE WHEN LEFT(vl.cuenta_codigo, 1) = '5'
                        THEN vl.debit - vl.credit ELSE 0 END
                    ), 0) AS gastos,
                    COUNT(DISTINCT v.voucher_id) AS vouchers_count,
                    COALESCE((
                        SELECT COUNT(*) FROM core.ordenes_compra oc
                        WHERE oc.empresa_codigo = e.codigo
                          AND EXTRACT(year FROM oc.fecha_emision) = :anio
                    ), 0) AS ocs_count
                FROM core.empresas e
                LEFT JOIN core.vouchers v ON v.empresa_codigo = e.codigo
                    AND EXTRACT(year FROM v.fecha_contable) = :anio
                    AND v.status IN ('APPROVED', 'EXECUTED', 'SYNCED', 'RECONCILED')
                LEFT JOIN core.voucher_lines vl ON vl.voucher_id = v.voucher_id
                WHERE e.activo = TRUE
                GROUP BY e.codigo, e.razon_social
                ORDER BY e.codigo
                """
            ),
            {"anio": anio},
        )
    ).mappings().all()

    empresas_data = [dict(r) for r in rows_db]
    empresas_data.append({"empresa_codigo": "_dummy", "ingresos": 0, "gastos": 0, "vouchers_count": 0})  # forzar render incluso con todas en 0
    empresas_data = [r for r in empresas_data if r["empresa_codigo"] != "_dummy"]

    html = render_consolidado_fondo_html(
        anio=anio,
        empresas_data=empresas_data,
    )
    return HTMLResponse(content=html)



@router.get(
    "/reportes/contables/index",
    response_model=list[dict],
)
async def get_reportes_index(
    user: CurrentUser,
    db: DBSession,
) -> list[dict]:
    """Lista los 12 reportes contables disponibles con metadata.

    Útil para integraciones externas (ej: API tokens) que quieran descubrir
    los reportes accesibles. También sirve como sitemap interno.
    """
    return [
        {
            "id": "libro-diario",
            "title": "Libro Diario",
            "description": "Asientos cronológicos voucher_lines APPROVED+",
            "html_endpoint": "/api/v1/reportes/contables/libro-diario.html",
            "params": ["empresa_codigo", "fecha_desde", "fecha_hasta"],
            "uso_tipico": "SII / Contador externo",
        },
        {
            "id": "balance-prueba",
            "title": "Balance de Prueba",
            "description": "Saldos por cuenta + verificación Σdebe=Σhaber",
            "html_endpoint": "/api/v1/reportes/contables/balance-prueba.html",
            "params": ["empresa_codigo", "fecha_desde", "fecha_hasta"],
            "uso_tipico": "Cuadre contable",
        },
        {
            "id": "cierre-mensual",
            "title": "Cierre Mensual",
            "description": "Checklist + KPIs operativos del mes",
            "html_endpoint": "/api/v1/reportes/contables/cierre-mensual.html",
            "params": ["empresa_codigo", "anio", "mes"],
            "uso_tipico": "Cierre operativo mensual",
        },
        {
            "id": "cashflow-mensual",
            "title": "Cashflow Mensual",
            "description": "Entradas vs salidas mes a mes + saldo acumulado",
            "html_endpoint": "/api/v1/reportes/contables/cashflow-mensual.html",
            "params": ["empresa_codigo", "anio"],
            "uso_tipico": "Análisis de flujo",
        },
        {
            "id": "pl-mensual",
            "title": "P&L Mensual",
            "description": "Ingresos (4-*) vs Gastos (5-*) por mes + margen",
            "html_endpoint": "/api/v1/reportes/contables/pl-mensual.html",
            "params": ["empresa_codigo", "anio"],
            "uso_tipico": "Margen mes a mes",
        },
        {
            "id": "estado-resultados",
            "title": "Estado de Resultados",
            "description": "ER anual jerárquico + resultado del ejercicio",
            "html_endpoint": "/api/v1/reportes/contables/estado-resultados.html",
            "params": ["empresa_codigo", "anio"],
            "uso_tipico": "F22 SII / cierre anual",
        },
        {
            "id": "balance-general",
            "title": "Balance General",
            "description": "Activo / Pasivo / Patrimonio a fecha de corte",
            "html_endpoint": "/api/v1/reportes/contables/balance-general.html",
            "params": ["empresa_codigo", "fecha_corte"],
            "uso_tipico": "Análisis patrimonial",
        },
        {
            "id": "consolidado-fondo",
            "title": "Consolidado del Fondo",
            "description": "Agregado de las 9 empresas del portafolio",
            "html_endpoint": "/api/v1/reportes/contables/consolidado-fondo.html",
            "params": ["anio"],
            "uso_tipico": "Reportería al fondo / comité",
        },
        {
            "id": "libro-mayor-json",
            "title": "Libro Mayor (JSON legacy)",
            "description": "Movimientos cuenta x cuenta + saldos apertura/cierre",
            "json_endpoint": "/api/v1/reportes/contables/libro-mayor",
            "params": ["empresa", "cuenta", "fecha_desde", "fecha_hasta"],
            "uso_tipico": "Análisis de cuenta específica",
        },
        {
            "id": "pl-proyecto-json",
            "title": "P&L por Proyecto (JSON)",
            "description": "Rentabilidad por proyecto contable",
            "json_endpoint": "/api/v1/reportes/contables/pl-proyecto",
            "params": ["empresa", "fecha_desde", "fecha_hasta"],
            "uso_tipico": "Análisis por proyecto",
        },
        {
            "id": "pl-area-json",
            "title": "P&L por Área (JSON)",
            "description": "Rentabilidad por centro de costo",
            "json_endpoint": "/api/v1/reportes/contables/pl-area",
            "params": ["empresa", "fecha_desde", "fecha_hasta"],
            "uso_tipico": "Centros de costo",
        },
        {
            "id": "rendicion-corfo-json",
            "title": "Rendición CORFO (JSON)",
            "description": "Desglose por tipo de gasto para proyecto CORFO",
            "json_endpoint": "/api/v1/reportes/contables/rendicion-corfo",
            "params": ["proyecto", "fecha_desde", "fecha_hasta"],
            "uso_tipico": "Subsidios I+D",
        },
    ]

