"""Reportes contables formales (V5 Fase 4).

Pure SQL queries sobre vouchers con status >= APPROVED. Excluye
DRAFT/PENDING/REJECTED/VOID — solo se reportan asientos formalmente
aprobados.

Reportes:
  - libro_diario: cronología de asientos
  - libro_mayor: movimientos + saldo por cuenta
  - pl_por_proyecto: ingresos/gastos agrupados
  - pl_por_area: idem por área
  - rendicion_corfo: filtra proyectos CORFO + desglose por tipo_gasto

Convenciones:
  - Todos los reportes filtran por empresa (multi-tenant lógico).
  - Rango de fechas usa fecha_contable.
  - Status APPROVED, EXECUTED, SYNCED, RECONCILED, CLOSED son válidos.
  - REVERSO se incluye con signo invertido (neutraliza el original).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# Estados que aparecen en reportes formales (excluye DRAFT/PENDING/REJECTED/VOID)
_FORMAL_STATUSES = (
    "APPROVED", "EXECUTED", "SYNCED", "RECONCILED", "CLOSED"
)


def _formal_status_filter() -> str:
    """SQL fragment para filtrar status formales — usar en WHERE."""
    quoted = ",".join(f"'{s}'" for s in _FORMAL_STATUSES)
    return f"v.status IN ({quoted})"


# ---------------------------------------------------------------------
# Libro Diario
# ---------------------------------------------------------------------


async def libro_diario(
    db: AsyncSession,
    *,
    empresa_codigo: str,
    fecha_desde: date,
    fecha_hasta: date,
) -> list[dict[str, Any]]:
    """Cronología de asientos. Una fila por línea de voucher con headers
    repetidos para que el reporte sea print-friendly.

    Devuelve: voucher_codigo, voucher_tipo, fecha_contable, glosa,
    line_number, cuenta_codigo, cuenta_nombre, proyecto_codigo,
    area_codigo, debit, credit.
    """
    rows = (
        await db.execute(
            text(
                f"""
                SELECT
                    v.voucher_id,
                    v.codigo                AS voucher_codigo,
                    v.tipo                  AS voucher_tipo,
                    v.fecha_contable,
                    v.glosa,
                    v.contraparte_nombre,
                    vl.line_number,
                    vl.cuenta_codigo,
                    pc.nombre               AS cuenta_nombre,
                    vl.proyecto_codigo,
                    vl.area_codigo,
                    vl.debit,
                    vl.credit,
                    vl.descripcion          AS linea_descripcion
                FROM core.vouchers v
                INNER JOIN core.voucher_lines vl ON vl.voucher_id = v.voucher_id
                INNER JOIN core.plan_cuentas pc ON pc.codigo = vl.cuenta_codigo
                WHERE v.empresa_codigo = :empresa
                  AND v.fecha_contable BETWEEN :fd AND :fh
                  AND {_formal_status_filter()}
                ORDER BY v.fecha_contable, v.codigo, vl.line_number
                """
            ),
            {"empresa": empresa_codigo, "fd": fecha_desde, "fh": fecha_hasta},
        )
    ).mappings().all()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------
# Libro Mayor
# ---------------------------------------------------------------------


async def libro_mayor(
    db: AsyncSession,
    *,
    empresa_codigo: str,
    cuenta_codigo: str,
    fecha_desde: date,
    fecha_hasta: date,
) -> dict[str, Any]:
    """Saldos + movimientos de una cuenta en el período.

    Calcula:
      - saldo_apertura: SUM(debit - credit) ANTES de fecha_desde
      - movimientos: lista cronológica de líneas en el rango
      - total_debe / total_haber del período
      - saldo_cierre: apertura + (debe - haber del período)
    """
    apertura = await db.scalar(
        text(
            f"""
            SELECT COALESCE(SUM(vl.debit) - SUM(vl.credit), 0)
            FROM core.voucher_lines vl
            INNER JOIN core.vouchers v ON v.voucher_id = vl.voucher_id
            WHERE v.empresa_codigo = :empresa
              AND vl.cuenta_codigo = :cuenta
              AND v.fecha_contable < :fd
              AND {_formal_status_filter()}
            """
        ),
        {"empresa": empresa_codigo, "cuenta": cuenta_codigo, "fd": fecha_desde},
    )

    movimientos = (
        await db.execute(
            text(
                f"""
                SELECT
                    v.voucher_id,
                    v.codigo                AS voucher_codigo,
                    v.fecha_contable,
                    v.glosa,
                    v.contraparte_nombre,
                    vl.line_number,
                    vl.descripcion          AS linea_descripcion,
                    vl.proyecto_codigo,
                    vl.area_codigo,
                    vl.debit,
                    vl.credit
                FROM core.voucher_lines vl
                INNER JOIN core.vouchers v ON v.voucher_id = vl.voucher_id
                WHERE v.empresa_codigo = :empresa
                  AND vl.cuenta_codigo = :cuenta
                  AND v.fecha_contable BETWEEN :fd AND :fh
                  AND {_formal_status_filter()}
                ORDER BY v.fecha_contable, v.codigo, vl.line_number
                """
            ),
            {
                "empresa": empresa_codigo,
                "cuenta": cuenta_codigo,
                "fd": fecha_desde,
                "fh": fecha_hasta,
            },
        )
    ).mappings().all()

    total_debe = sum((Decimal(m["debit"]) for m in movimientos), Decimal(0))
    total_haber = sum((Decimal(m["credit"]) for m in movimientos), Decimal(0))
    saldo_apertura = Decimal(apertura or 0)
    saldo_cierre = saldo_apertura + total_debe - total_haber

    cuenta_meta = (
        await db.execute(
            text(
                "SELECT codigo, nombre, tipo, nivel "
                "FROM core.plan_cuentas WHERE codigo = :c"
            ),
            {"c": cuenta_codigo},
        )
    ).mappings().first()

    return {
        "cuenta": dict(cuenta_meta) if cuenta_meta else None,
        "fecha_desde": fecha_desde,
        "fecha_hasta": fecha_hasta,
        "saldo_apertura": saldo_apertura,
        "total_debe": total_debe,
        "total_haber": total_haber,
        "saldo_cierre": saldo_cierre,
        "movimientos": [dict(m) for m in movimientos],
    }


# ---------------------------------------------------------------------
# P&L por proyecto
# ---------------------------------------------------------------------


async def pl_por_proyecto(
    db: AsyncSession,
    *,
    empresa_codigo: str,
    fecha_desde: date,
    fecha_hasta: date,
) -> list[dict[str, Any]]:
    """Ingresos vs gastos agrupados por proyecto.

    Cuentas tipo INGRESO/RESULTADO con saldo acreedor → ingresos.
    Cuentas tipo GASTO/RESULTADO con saldo deudor → gastos.

    Usamos pc.tipo + signo dominante: para `RESULTADO` decidimos por flag
    si es ingreso o gasto a partir del prefijo del codigo (3-1x = ingreso,
    3-2x = gasto en plan típico chileno).
    """
    rows = (
        await db.execute(
            text(
                f"""
                WITH movs AS (
                    SELECT
                        COALESCE(vl.proyecto_codigo, '(sin proyecto)') AS proyecto_codigo,
                        pc.tipo                                          AS cuenta_tipo,
                        vl.debit,
                        vl.credit,
                        pc.codigo
                    FROM core.voucher_lines vl
                    INNER JOIN core.vouchers v ON v.voucher_id = vl.voucher_id
                    INNER JOIN core.plan_cuentas pc ON pc.codigo = vl.cuenta_codigo
                    WHERE v.empresa_codigo = :empresa
                      AND v.fecha_contable BETWEEN :fd AND :fh
                      AND {_formal_status_filter()}
                      AND pc.tipo IN ('INGRESO', 'GASTO', 'RESULTADO')
                )
                SELECT
                    proyecto_codigo,
                    COALESCE(p.nombre, '(Sin proyecto asignado)')  AS proyecto_nombre,
                    p.tipo_financiamiento,
                    COALESCE(SUM(CASE WHEN m.cuenta_tipo = 'INGRESO'
                                       OR (m.cuenta_tipo = 'RESULTADO' AND m.codigo LIKE '3-1%')
                                      THEN m.credit - m.debit ELSE 0 END), 0) AS ingresos,
                    COALESCE(SUM(CASE WHEN m.cuenta_tipo = 'GASTO'
                                       OR (m.cuenta_tipo = 'RESULTADO' AND m.codigo LIKE '3-2%')
                                      THEN m.debit - m.credit ELSE 0 END), 0) AS gastos
                FROM movs m
                LEFT JOIN core.proyectos_contables p ON p.codigo = m.proyecto_codigo
                GROUP BY proyecto_codigo, p.nombre, p.tipo_financiamiento
                ORDER BY proyecto_codigo
                """
            ),
            {"empresa": empresa_codigo, "fd": fecha_desde, "fh": fecha_hasta},
        )
    ).mappings().all()

    result = []
    for r in rows:
        ingresos = Decimal(r["ingresos"] or 0)
        gastos = Decimal(r["gastos"] or 0)
        result.append(
            {
                "proyecto_codigo": r["proyecto_codigo"],
                "proyecto_nombre": r["proyecto_nombre"],
                "tipo_financiamiento": r["tipo_financiamiento"],
                "ingresos": ingresos,
                "gastos": gastos,
                "resultado": ingresos - gastos,
            }
        )
    return result


# ---------------------------------------------------------------------
# P&L por área
# ---------------------------------------------------------------------


async def pl_por_area(
    db: AsyncSession,
    *,
    empresa_codigo: str,
    fecha_desde: date,
    fecha_hasta: date,
) -> list[dict[str, Any]]:
    """P&L agrupado por área (centro de costo)."""
    rows = (
        await db.execute(
            text(
                f"""
                WITH movs AS (
                    SELECT
                        COALESCE(vl.area_codigo, '---') AS area_codigo,
                        pc.tipo                          AS cuenta_tipo,
                        vl.debit,
                        vl.credit,
                        pc.codigo
                    FROM core.voucher_lines vl
                    INNER JOIN core.vouchers v ON v.voucher_id = vl.voucher_id
                    INNER JOIN core.plan_cuentas pc ON pc.codigo = vl.cuenta_codigo
                    WHERE v.empresa_codigo = :empresa
                      AND v.fecha_contable BETWEEN :fd AND :fh
                      AND {_formal_status_filter()}
                      AND pc.tipo IN ('INGRESO', 'GASTO', 'RESULTADO')
                )
                SELECT
                    area_codigo,
                    COALESCE(a.nombre, '(Sin área)')   AS area_nombre,
                    COALESCE(SUM(CASE WHEN m.cuenta_tipo = 'INGRESO'
                                       OR (m.cuenta_tipo = 'RESULTADO' AND m.codigo LIKE '3-1%')
                                      THEN m.credit - m.debit ELSE 0 END), 0) AS ingresos,
                    COALESCE(SUM(CASE WHEN m.cuenta_tipo = 'GASTO'
                                       OR (m.cuenta_tipo = 'RESULTADO' AND m.codigo LIKE '3-2%')
                                      THEN m.debit - m.credit ELSE 0 END), 0) AS gastos
                FROM movs m
                LEFT JOIN core.areas a ON a.codigo = m.area_codigo
                GROUP BY area_codigo, a.nombre
                ORDER BY area_codigo
                """
            ),
            {"empresa": empresa_codigo, "fd": fecha_desde, "fh": fecha_hasta},
        )
    ).mappings().all()

    result = []
    for r in rows:
        ingresos = Decimal(r["ingresos"] or 0)
        gastos = Decimal(r["gastos"] or 0)
        result.append(
            {
                "area_codigo": r["area_codigo"],
                "area_nombre": r["area_nombre"],
                "ingresos": ingresos,
                "gastos": gastos,
                "resultado": ingresos - gastos,
            }
        )
    return result


# ---------------------------------------------------------------------
# Rendición CORFO
# ---------------------------------------------------------------------


async def rendicion_corfo(
    db: AsyncSession,
    *,
    proyecto_codigo: str,
    fecha_desde: date,
    fecha_hasta: date,
) -> dict[str, Any]:
    """Rendición de gastos a CORFO para un proyecto específico.

    Devuelve:
      - proyecto: metadata + presupuesto total
      - desglose por tipo_gasto_corfo (RRHH/OPERACION/INVERSION/GG)
      - lineas individuales con voucher + monto + cuenta + tipo gasto
      - totales
    """
    proyecto = (
        await db.execute(
            text(
                """
                SELECT codigo, empresa_codigo, nombre, tipo_financiamiento,
                       programa, presupuesto_total, primer_desembolso_corfo,
                       tipos_gasto_elegibles
                FROM core.proyectos_contables
                WHERE codigo = :c
                """
            ),
            {"c": proyecto_codigo},
        )
    ).mappings().first()

    if proyecto is None:
        return {
            "proyecto": None,
            "lineas": [],
            "desglose_por_tipo_gasto": [],
            "total": Decimal(0),
        }

    # Líneas de gasto imputadas a este proyecto
    lineas = (
        await db.execute(
            text(
                f"""
                SELECT
                    v.codigo                AS voucher_codigo,
                    v.fecha_contable,
                    v.glosa,
                    v.contraparte_nombre,
                    v.contraparte_rut,
                    v.doc_tributario_tipo,
                    v.doc_tributario_folio,
                    vl.line_number,
                    vl.cuenta_codigo,
                    pc.nombre               AS cuenta_nombre,
                    pc.tipo_gasto_corfo,
                    vl.area_codigo,
                    vl.debit,
                    vl.credit,
                    vl.descripcion          AS linea_descripcion
                FROM core.voucher_lines vl
                INNER JOIN core.vouchers v ON v.voucher_id = vl.voucher_id
                INNER JOIN core.plan_cuentas pc ON pc.codigo = vl.cuenta_codigo
                WHERE vl.proyecto_codigo = :proyecto
                  AND v.fecha_contable BETWEEN :fd AND :fh
                  AND {_formal_status_filter()}
                  AND pc.corfo_elegible = TRUE
                  AND vl.debit > 0
                ORDER BY v.fecha_contable, v.codigo, vl.line_number
                """
            ),
            {
                "proyecto": proyecto_codigo,
                "fd": fecha_desde,
                "fh": fecha_hasta,
            },
        )
    ).mappings().all()

    # Desglose por tipo_gasto_corfo
    desglose: dict[str, Decimal] = {}
    for ln in lineas:
        tg = ln["tipo_gasto_corfo"] or "NO_ELEGIBLE"
        desglose[tg] = desglose.get(tg, Decimal(0)) + Decimal(ln["debit"])

    desglose_list = [
        {"tipo_gasto": k, "monto": v}
        for k, v in sorted(desglose.items(), key=lambda x: x[0])
    ]
    total = sum(desglose.values(), Decimal(0))

    return {
        "proyecto": dict(proyecto),
        "fecha_desde": fecha_desde,
        "fecha_hasta": fecha_hasta,
        "lineas": [dict(l) for l in lineas],
        "desglose_por_tipo_gasto": desglose_list,
        "total": total,
    }
