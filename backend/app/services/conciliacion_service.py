"""Conciliación bancaria voucher ↔ movimiento (V5 Fase 5).

Cierra el ciclo contable: cada voucher EXECUTED debería tener un
`movimiento_id` apuntando a la fila de `core.movimientos` que lo cargó
en el banco.

Algoritmo de match automático:
  1. Filtra vouchers EXECUTED con movimiento_id NULL en la empresa.
  2. Para cada uno, busca movimientos en `core.movimientos` que matcheen:
     - misma empresa
     - monto exacto (total_debit del voucher == abs(monto del movimiento))
     - fecha del movimiento dentro de ±3 días de fecha_ejecucion
     - movimiento aún sin voucher_id apuntándole (no doble-asignado)
  3. Si hay EXACTAMENTE 1 candidato → match automático (alta confianza).
  4. Si hay >1 candidatos o 0 → queda como "no conciliado" para revisión
     manual.

Para vouchers ya `EXECUTED` sin match, la UI muestra los candidatos para
que el COO elija el correcto.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


# Tolerancia de días para match automático
_MATCH_DATE_WINDOW_DAYS = 3


class NoCandidatesError(Exception):
    """No hay candidatos para conciliar este voucher."""


# ---------------------------------------------------------------------
# Match candidates
# ---------------------------------------------------------------------


async def find_match_candidates(
    db: AsyncSession,
    *,
    voucher_id: int,
    window_days: int = _MATCH_DATE_WINDOW_DAYS,
) -> list[dict[str, Any]]:
    """Devuelve candidatos de match para un voucher EXECUTED.

    Criterios:
      - misma empresa que el voucher
      - monto del movimiento (abs) == total_debit del voucher
      - fecha del movimiento dentro de ±window_days de fecha_ejecucion
      - movimiento sin voucher_id apuntando (no asignado a otro)
    """
    voucher = (
        await db.execute(
            text(
                "SELECT empresa_codigo, total_debit, fecha_ejecucion, "
                "       fecha_contable, contraparte_nombre, moneda "
                "FROM core.vouchers WHERE voucher_id = :v"
            ),
            {"v": voucher_id},
        )
    ).mappings().first()
    if voucher is None:
        return []

    # Si no hay fecha_ejecucion (caso TRASPASO), usamos fecha_contable
    fecha_ref = voucher["fecha_ejecucion"] or voucher["fecha_contable"]
    monto = voucher["total_debit"]
    voucher_moneda = voucher["moneda"] or "CLP"

    # R152GGGGGG — Tolerancia de monto para absorber comisiones bancarias
    # y redondeos. Default exacto (0). Configurable via env CONCILIACION_
    # TOLERANCIA_CLP para que Nicolás lo suba si las comisiones generan
    # mismatch (ej. transferencia $100 que llega como $99.50).
    tolerancia = Decimal(str(getattr(settings, "conciliacion_tolerancia_clp", 0)))

    rows = (
        await db.execute(
            text(
                """
                SELECT
                    m.movimiento_id,
                    m.fecha,
                    m.descripcion,
                    m.monto,
                    m.banco,
                    m.tipo_egreso,
                    m.proveedor_id,
                    p.nombre AS proveedor_nombre
                FROM core.movimientos m
                LEFT JOIN core.proveedores p ON p.proveedor_id = m.proveedor_id
                WHERE m.empresa_codigo = :empresa
                  -- R152GGGGGG — Match por moneda: evita conciliar un
                  -- movimiento USD contra un voucher CLP del mismo importe.
                  AND m.moneda = :moneda
                  AND ABS(ABS(m.monto) - :monto) <= :tol
                  AND m.fecha BETWEEN (CAST(:fecha AS DATE) - INTERVAL ':win days')::DATE
                                  AND (CAST(:fecha AS DATE) + INTERVAL ':win days')::DATE
                  AND NOT EXISTS (
                      SELECT 1 FROM core.vouchers v2
                      WHERE v2.movimiento_id = m.movimiento_id
                  )
                ORDER BY ABS(ABS(m.monto) - :monto) ASC,
                         ABS(m.fecha - CAST(:fecha AS DATE)) ASC,
                         m.fecha DESC
                LIMIT 20
                """.replace(":win", str(window_days))
            ),
            {
                "empresa": voucher["empresa_codigo"],
                "monto": monto,
                "moneda": voucher_moneda,
                "tol": tolerancia,
                "fecha": fecha_ref,
            },
        )
    ).mappings().all()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------
# Auto-reconcile
# ---------------------------------------------------------------------


async def auto_reconcile(
    db: AsyncSession,
    *,
    empresa_codigo: str,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    window_days: int = _MATCH_DATE_WINDOW_DAYS,
) -> dict[str, Any]:
    """Corre el algoritmo automático sobre vouchers EXECUTED no conciliados.

    Devuelve counters:
      - vouchers_evaluados
      - matched_unico (asignados automáticamente)
      - matched_ambiguo (>1 candidato — quedan sin asignar)
      - sin_candidatos (0 candidatos — quedan sin asignar)
    """
    where_parts = [
        "v.empresa_codigo = :empresa",
        "v.status = 'EXECUTED'",
        "v.movimiento_id IS NULL",
    ]
    params: dict[str, Any] = {"empresa": empresa_codigo}
    if fecha_desde:
        where_parts.append("v.fecha_contable >= :fd")
        params["fd"] = fecha_desde
    if fecha_hasta:
        where_parts.append("v.fecha_contable <= :fh")
        params["fh"] = fecha_hasta
    where_sql = " AND ".join(where_parts)

    # R152WWWWW — LIMIT defensivo. El loop hace 2 queries por voucher
    # (find_match_candidates + link). Sin cap, 500 vouchers = 1000+
    # roundtrips, satura el pool. Cap a 200 corresponde a ~10s de ejecución
    # bajo carga normal — si hay más, el siguiente run los toma.
    # TODO refactor a bulk query: SELECT v.id, m.id FROM vouchers v JOIN
    # movimientos m ON match-criteria con HAVING COUNT(m)=1.
    AUTO_MATCH_VOUCHER_CAP = 200
    vouchers = (
        await db.execute(
            text(
                f"SELECT voucher_id FROM core.vouchers v WHERE {where_sql} "
                f"ORDER BY v.fecha_contable ASC LIMIT {AUTO_MATCH_VOUCHER_CAP}"
            ),
            params,
        )
    ).scalars().all()

    if len(vouchers) == AUTO_MATCH_VOUCHER_CAP:
        import structlog
        structlog.get_logger(__name__).warning(
            "conciliacion.auto_match.cap_hit",
            cap=AUTO_MATCH_VOUCHER_CAP,
            hint="Re-ejecutar para procesar los siguientes",
        )

    counters = {
        "vouchers_evaluados": len(vouchers),
        "matched_unico": 0,
        "matched_ambiguo": 0,
        "sin_candidatos": 0,
    }
    matches_made: list[dict[str, Any]] = []

    for vid in vouchers:
        candidates = await find_match_candidates(
            db, voucher_id=vid, window_days=window_days
        )
        if len(candidates) == 1:
            mov = candidates[0]
            await link_voucher_to_movimiento(
                db,
                voucher_id=vid,
                movimiento_id=mov["movimiento_id"],
                auto_match=True,
            )
            counters["matched_unico"] += 1
            matches_made.append(
                {
                    "voucher_id": vid,
                    "movimiento_id": mov["movimiento_id"],
                    "monto": mov["monto"],
                    "fecha": mov["fecha"],
                }
            )
        elif len(candidates) > 1:
            counters["matched_ambiguo"] += 1
        else:
            counters["sin_candidatos"] += 1

    return {**counters, "matches": matches_made}


# ---------------------------------------------------------------------
# Manual link / unlink
# ---------------------------------------------------------------------


async def link_voucher_to_movimiento(
    db: AsyncSession,
    *,
    voucher_id: int,
    movimiento_id: int,
    auto_match: bool = False,
) -> dict[str, Any]:
    """Asigna movimiento_id al voucher + cambia status a RECONCILED.

    Validaciones:
      - voucher existe y status == 'EXECUTED' (no se concilia DRAFT etc)
      - movimiento existe y de la misma empresa
      - movimiento no está asignado a otro voucher
    """
    voucher = (
        await db.execute(
            text(
                "SELECT voucher_id, codigo, empresa_codigo, status, "
                "       movimiento_id, moneda "
                "FROM core.vouchers WHERE voucher_id = :v"
            ),
            {"v": voucher_id},
        )
    ).mappings().first()
    if voucher is None:
        raise ValueError(f"Voucher {voucher_id} no existe")
    if voucher["status"] != "EXECUTED":
        raise ValueError(
            f"Voucher {voucher['codigo']} está en {voucher['status']}, "
            f"solo EXECUTED admite conciliación"
        )
    if voucher["movimiento_id"] is not None:
        raise ValueError(
            f"Voucher {voucher['codigo']} ya tiene movimiento_id asignado"
        )

    movimiento = (
        await db.execute(
            text(
                "SELECT movimiento_id, empresa_codigo, monto, fecha, moneda "
                "FROM core.movimientos WHERE movimiento_id = :m"
            ),
            {"m": movimiento_id},
        )
    ).mappings().first()
    if movimiento is None:
        raise ValueError(f"Movimiento {movimiento_id} no existe")
    if movimiento["empresa_codigo"] != voucher["empresa_codigo"]:
        raise ValueError(
            f"Movimiento es de empresa {movimiento['empresa_codigo']} "
            f"pero voucher es de {voucher['empresa_codigo']}"
        )
    # R152GGGGGG — Validar moneda: no conciliar un movimiento USD contra
    # un voucher CLP. Aplica tanto al match automático como al manual.
    mov_moneda = movimiento["moneda"] or "CLP"
    vou_moneda = voucher["moneda"] or "CLP"
    if mov_moneda != vou_moneda:
        raise ValueError(
            f"Moneda no coincide: movimiento en {mov_moneda} vs "
            f"voucher en {vou_moneda}. No se puede conciliar."
        )

    used_by = await db.scalar(
        text(
            "SELECT voucher_id FROM core.vouchers "
            "WHERE movimiento_id = :m AND voucher_id != :v"
        ),
        {"m": movimiento_id, "v": voucher_id},
    )
    if used_by:
        raise ValueError(
            f"Movimiento {movimiento_id} ya está asignado al voucher {used_by}"
        )

    await db.execute(
        text(
            """
            UPDATE core.vouchers
            SET movimiento_id = :m, status = 'RECONCILED', updated_at = now()
            WHERE voucher_id = :v
            """
        ),
        {"v": voucher_id, "m": movimiento_id},
    )

    return {
        "voucher_id": voucher_id,
        "voucher_codigo": voucher["codigo"],
        "movimiento_id": movimiento_id,
        "monto": movimiento["monto"],
        "fecha_movimiento": movimiento["fecha"],
        "auto_match": auto_match,
    }


async def unlink_voucher_movimiento(
    db: AsyncSession, *, voucher_id: int
) -> dict[str, Any]:
    """Desconcilia: voucher pasa de RECONCILED a EXECUTED, movimiento_id NULL.

    Útil cuando el match fue incorrecto.
    """
    voucher = (
        await db.execute(
            text(
                "SELECT voucher_id, codigo, status, movimiento_id "
                "FROM core.vouchers WHERE voucher_id = :v"
            ),
            {"v": voucher_id},
        )
    ).mappings().first()
    if voucher is None:
        raise ValueError(f"Voucher {voucher_id} no existe")
    if voucher["movimiento_id"] is None:
        raise ValueError(
            f"Voucher {voucher['codigo']} no tiene movimiento asignado"
        )

    await db.execute(
        text(
            """
            UPDATE core.vouchers
            SET movimiento_id = NULL,
                status = 'EXECUTED',
                updated_at = now()
            WHERE voucher_id = :v
            """
        ),
        {"v": voucher_id},
    )
    return {
        "voucher_id": voucher_id,
        "voucher_codigo": voucher["codigo"],
        "previous_movimiento_id": voucher["movimiento_id"],
    }


# ---------------------------------------------------------------------
# No conciliados / movimientos huérfanos
# ---------------------------------------------------------------------


async def list_no_conciliados(
    db: AsyncSession,
    *,
    empresa_codigo: str,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Vouchers EXECUTED sin movimiento_id (deberían haber sido pagados)."""
    where_parts = [
        "v.empresa_codigo = :empresa",
        "v.status = 'EXECUTED'",
        "v.movimiento_id IS NULL",
    ]
    params: dict[str, Any] = {"empresa": empresa_codigo, "limit": limit}
    if fecha_desde:
        where_parts.append("v.fecha_contable >= :fd")
        params["fd"] = fecha_desde
    if fecha_hasta:
        where_parts.append("v.fecha_contable <= :fh")
        params["fh"] = fecha_hasta
    where_sql = " AND ".join(where_parts)

    rows = (
        await db.execute(
            text(
                f"""
                SELECT v.voucher_id, v.codigo, v.tipo, v.fecha_contable,
                       v.fecha_ejecucion, v.glosa, v.contraparte_nombre,
                       v.contraparte_rut, v.total_debit, v.moneda
                FROM core.vouchers v
                WHERE {where_sql}
                ORDER BY v.fecha_contable DESC
                LIMIT :limit
                """
            ),
            params,
        )
    ).mappings().all()
    return [dict(r) for r in rows]


async def list_movimientos_huerfanos(
    db: AsyncSession,
    *,
    empresa_codigo: str,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Movimientos bancarios que no tienen voucher apuntándoles."""
    where_parts = [
        "m.empresa_codigo = :empresa",
        "NOT EXISTS (SELECT 1 FROM core.vouchers v WHERE v.movimiento_id = m.movimiento_id)",
    ]
    params: dict[str, Any] = {"empresa": empresa_codigo, "limit": limit}
    if fecha_desde:
        where_parts.append("m.fecha >= :fd")
        params["fd"] = fecha_desde
    if fecha_hasta:
        where_parts.append("m.fecha <= :fh")
        params["fh"] = fecha_hasta
    where_sql = " AND ".join(where_parts)

    rows = (
        await db.execute(
            text(
                f"""
                SELECT m.movimiento_id, m.fecha, m.descripcion, m.monto,
                       m.banco, m.tipo_egreso, m.proveedor_id,
                       p.nombre AS proveedor_nombre
                FROM core.movimientos m
                LEFT JOIN core.proveedores p ON p.proveedor_id = m.proveedor_id
                WHERE {where_sql}
                ORDER BY m.fecha DESC
                LIMIT :limit
                """
            ),
            params,
        )
    ).mappings().all()
    return [dict(r) for r in rows]


async def get_summary(
    db: AsyncSession, *, empresa_codigo: str
) -> dict[str, Any]:
    """KPIs de conciliación de la empresa: count + suma."""
    row = (
        await db.execute(
            text(
                """
                SELECT
                    COUNT(*) FILTER (WHERE v.status = 'EXECUTED' AND v.movimiento_id IS NULL) AS no_conciliados,
                    COUNT(*) FILTER (WHERE v.status = 'RECONCILED') AS conciliados,
                    COALESCE(SUM(v.total_debit) FILTER (WHERE v.status = 'EXECUTED' AND v.movimiento_id IS NULL), 0) AS monto_pendiente
                FROM core.vouchers v
                WHERE v.empresa_codigo = :empresa
                """
            ),
            {"empresa": empresa_codigo},
        )
    ).mappings().one()
    huerfanos = await db.scalar(
        text(
            """
            SELECT COUNT(*) FROM core.movimientos m
            WHERE m.empresa_codigo = :empresa
              AND NOT EXISTS (SELECT 1 FROM core.vouchers v WHERE v.movimiento_id = m.movimiento_id)
            """
        ),
        {"empresa": empresa_codigo},
    )
    return {
        "no_conciliados": row["no_conciliados"] or 0,
        "conciliados": row["conciliados"] or 0,
        "movimientos_huerfanos": huerfanos or 0,
        "monto_pendiente": Decimal(row["monto_pendiente"] or 0),
    }
