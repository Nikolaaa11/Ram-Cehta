"""Dashboard — pre-calculated summary data (Discipline 2)."""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.domain.value_objects.periodo import current_periodo
from app.schemas.dashboard import (
    DashboardResponse,
    F29Resumen,
    MovimientoReciente,
    OCResumen,
    SaldoEmpresa,
)

router = APIRouter()


@router.get("", response_model=DashboardResponse)
async def get_dashboard(user: CurrentUser, db: DBSession) -> DashboardResponse:
    periodo = current_periodo()

    # Saldos por empresa: último registro de saldo_cehta / saldo_corfo / saldo_contable
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

    # Movimientos recientes (últimos 15)
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

    # Resumen OC
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

    # F29 pendientes / vencidos
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
