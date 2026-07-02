"""Service de exportación a Nubox (V5 Fase 3).

Genera CSV con formato estándar que Nubox acepta para importar asientos
contables. Una fila por línea de voucher con columnas:

    Fecha, NumComprobante, TipoComprobante, Glosa, Cuenta, NombreCuenta,
    Debe, Haber, CentroCosto, Proyecto, RutContraparte, NombreContraparte,
    DocumentoTipo, DocumentoFolio

Nubox acepta archivos CSV con encoding UTF-8 BOM (para que Excel los
abra bien) y separador ';' (estándar latam).

Lógica:
  1. Selecciona vouchers APPROVED + sin batch previo (nubox_status NULL)
  2. Filtra por empresa + rango de fechas
  3. Genera CSV con N filas (una por voucher_line)
  4. Crea row en nubox_export_batches con counters
  5. Crea rows en nubox_export_voucher (join)
  6. Marca cada voucher con nubox_status = 'EXPORTED'

El COO descarga el archivo, lo carga en Nubox, vuelve y marca el batch
como CONFIRMED ingresando los folios devueltos por Nubox (uno por
voucher).
"""
from __future__ import annotations

import csv
import hashlib
from datetime import date
from decimal import Decimal
from io import StringIO
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


_NUBOX_CSV_DELIMITER = ";"  # estándar latam para Excel chileno
_NUBOX_CSV_HEADER = [
    "Fecha",            # YYYY-MM-DD del asiento contable
    "NumComprobante",   # codigo del voucher (CSL-2026-EGR-00001)
    "TipoComprobante",  # mapeo INGRESO/EGRESO/etc → I/E/T/etc según Nubox
    "Glosa",            # primera 200 chars de voucher.glosa
    "LineaNum",         # 1, 2, 3...
    "Cuenta",           # nubox_code de plan_cuentas (mapeo)
    "NombreCuenta",     # plan_cuentas.nombre
    "Debe",             # CLP entero
    "Haber",            # CLP entero
    "CentroCosto",      # area_codigo (3 letras)
    "Proyecto",         # proyecto_codigo (PRJ-EMP-TIPO-NNN)
    "RutContraparte",
    "NombreContraparte",
    "DocumentoTipo",
    "DocumentoFolio",
    "DescripcionLinea",
]

# Mapeo tipo voucher Cehta → tipo voucher Nubox (típico).
# Si el contador externo confirma otra convención, se cambia acá.
_TIPO_NUBOX_MAP = {
    "INGRESO": "I",
    "EGRESO": "E",
    "TRASPASO": "T",
    "COMPRA": "C",
    "VENTA": "V",
    "APERTURA": "A",
    "CIERRE": "Z",
    "REVERSO": "R",
}


class NoVouchersToExportError(Exception):
    """No hay vouchers APPROVED sin batch para esa empresa+fecha."""


async def select_pending_vouchers(
    db: AsyncSession,
    *,
    empresa_codigo: str,
    fecha_desde: date | None,
    fecha_hasta: date | None,
) -> list[dict[str, Any]]:
    """Selecciona vouchers APPROVED sin batch previo, listos para exportar.

    Devuelve una fila por LÍNEA (no por voucher) con todos los datos
    necesarios para generar el CSV. JOIN con plan_cuentas para nubox_code.
    """
    where_parts = [
        "v.empresa_codigo = :empresa",
        # R152UUUUUU — también EXECUTED: un voucher pagado antes del export
        # nunca entraba a ningún batch y su asiento jamás llegaba a Nubox
        # (contabilidad oficial) en silencio. El filtro nubox_status IS NULL
        # ya evita re-exportar los que tienen folio.
        "v.status IN ('APPROVED', 'EXECUTED')",
        "v.nubox_status IS NULL",
    ]
    params: dict[str, Any] = {"empresa": empresa_codigo}

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
                SELECT
                    v.voucher_id,
                    v.codigo                AS voucher_codigo,
                    v.tipo                  AS voucher_tipo,
                    v.fecha_contable,
                    v.glosa,
                    v.contraparte_rut,
                    v.contraparte_nombre,
                    v.doc_tributario_tipo,
                    v.doc_tributario_folio,
                    vl.line_number,
                    vl.cuenta_codigo,
                    vl.proyecto_codigo,
                    vl.area_codigo,
                    vl.debit,
                    vl.credit,
                    vl.descripcion          AS linea_descripcion,
                    pc.nombre               AS cuenta_nombre,
                    COALESCE(pc.nubox_code, vl.cuenta_codigo) AS cuenta_nubox
                FROM core.vouchers v
                INNER JOIN core.voucher_lines vl ON vl.voucher_id = v.voucher_id
                INNER JOIN core.plan_cuentas pc ON pc.codigo = vl.cuenta_codigo
                WHERE {where_sql}
                ORDER BY v.fecha_contable, v.codigo, vl.line_number
                """
            ),
            params,
        )
    ).mappings().all()

    return [dict(r) for r in rows]


def generate_csv(rows: list[dict[str, Any]]) -> str:
    """Genera el contenido CSV. Devuelve string con BOM para Excel."""
    if not rows:
        raise NoVouchersToExportError("No hay vouchers para exportar")

    buf = StringIO()
    # BOM UTF-8 para que Excel lo abra como UTF-8 sin gymnastics
    buf.write("﻿")

    writer = csv.writer(buf, delimiter=_NUBOX_CSV_DELIMITER, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(_NUBOX_CSV_HEADER)

    # R152FFFFFF — Eliminado `.replace(delimiter, ",")` en cada campo.
    # csv.writer con QUOTE_MINIMAL YA escapa el delimitador con comillas
    # dobles. El replace destruía datos reales: una glosa "Pago 50%; saldo"
    # se exportaba como "Pago 50%, saldo" — texto alterado en el asiento
    # que va al sistema contable oficial.
    for r in rows:
        writer.writerow([
            r["fecha_contable"].isoformat() if r["fecha_contable"] else "",
            r["voucher_codigo"],
            _TIPO_NUBOX_MAP.get(r["voucher_tipo"], r["voucher_tipo"]),
            (r["glosa"] or "")[:200],
            r["line_number"],
            r["cuenta_nubox"],
            r["cuenta_nombre"] or "",
            f"{Decimal(r['debit']):.0f}",
            f"{Decimal(r['credit']):.0f}",
            r["area_codigo"] or "",
            r["proyecto_codigo"] or "",
            r["contraparte_rut"] or "",
            r["contraparte_nombre"] or "",
            r["doc_tributario_tipo"] or "",
            r["doc_tributario_folio"] or "",
            r["linea_descripcion"] or "",
        ])

    return buf.getvalue()


def aggregate_batch_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Calcula totales del batch: voucher count + sum debit + sum credit."""
    voucher_ids = {r["voucher_id"] for r in rows}
    total_debit = sum((Decimal(r["debit"]) for r in rows), Decimal(0))
    total_credit = sum((Decimal(r["credit"]) for r in rows), Decimal(0))
    return {
        "voucher_count": len(voucher_ids),
        "voucher_ids": list(voucher_ids),
        "total_debit": total_debit,
        "total_credit": total_credit,
        "line_count": len(rows),
    }


async def create_export_batch(
    db: AsyncSession,
    *,
    empresa_codigo: str,
    fecha_desde: date | None,
    fecha_hasta: date | None,
    csv_content: str,
    summary: dict[str, Any],
    generated_by: str,
) -> int:
    """Persiste el batch + relación con vouchers + marca vouchers como exportados.

    Devuelve batch_id.
    """
    file_bytes = csv_content.encode("utf-8")
    file_hash = hashlib.sha256(file_bytes).hexdigest()
    file_name = (
        f"nubox-{empresa_codigo}-"
        f"{(fecha_desde or date.today()).isoformat()}-"
        f"{(fecha_hasta or date.today()).isoformat()}.csv"
    )

    # Insert batch
    result = await db.execute(
        text(
            """
            INSERT INTO core.nubox_export_batches (
                empresa_codigo, fecha_desde, fecha_hasta,
                voucher_count, total_debit, total_credit,
                file_name, file_format, file_hash, file_size_bytes,
                status, generated_by
            )
            VALUES (
                :empresa, :fd, :fh,
                :vc, :td, :tc,
                :name, 'csv', :h, :sz,
                'GENERATED', CAST(:by AS UUID)
            )
            RETURNING batch_id
            """
        ),
        {
            "empresa": empresa_codigo,
            "fd": fecha_desde,
            "fh": fecha_hasta,
            "vc": summary["voucher_count"],
            "td": summary["total_debit"],
            "tc": summary["total_credit"],
            "name": file_name,
            "h": file_hash,
            "sz": len(file_bytes),
            "by": generated_by,
        },
    )
    batch_id = result.scalar_one()

    # Join rows + marcar vouchers
    for vid in summary["voucher_ids"]:
        await db.execute(
            text(
                "INSERT INTO core.nubox_export_voucher (batch_id, voucher_id) "
                "VALUES (:b, :v)"
            ),
            {"b": batch_id, "v": vid},
        )

    if summary["voucher_ids"]:
        # Bulk update con ANY
        await db.execute(
            text(
                """
                UPDATE core.vouchers
                SET nubox_status = 'EXPORTED',
                    updated_at = now()
                WHERE voucher_id = ANY(CAST(:ids AS BIGINT[]))
                """
            ),
            {"ids": summary["voucher_ids"]},
        )

    return batch_id


async def confirm_batch_with_folios(
    db: AsyncSession,
    *,
    batch_id: int,
    folios: dict[str, str],  # voucher_codigo → folio_nubox
    confirmed_by: str,
) -> int:
    """Marca el batch como CONFIRMED y asigna folios Nubox a cada voucher.

    El COO ingresa el mapeo después de cargar el CSV en Nubox.
    Devuelve cantidad de vouchers actualizados.
    """
    if not folios:
        # Sin folios = batch confirmado pero sin trazabilidad de folios
        # individuales. Se puede actualizar después con PATCH del voucher.
        await db.execute(
            text(
                """
                UPDATE core.nubox_export_batches
                SET status = 'CONFIRMED', confirmed_at = now()
                WHERE batch_id = :b
                """
            ),
            {"b": batch_id},
        )
        return 0

    updated = 0
    for codigo, folio in folios.items():
        res = await db.execute(
            text(
                """
                UPDATE core.vouchers
                SET nubox_folio = :folio,
                    nubox_synced_at = now(),
                    nubox_status = 'SYNCED',
                    -- R152UUUUUU: el estado de sync vive en nubox_status;
                    -- `status` solo avanza APPROVED→SYNCED. Antes pisaba
                    -- EXECUTED→SYNCED: un voucher pagado entre export y
                    -- confirm desaparecía de conciliación (exige EXECUTED)
                    -- y perdía su estado de pago sin traza.
                    status = CASE WHEN status = 'APPROVED'
                                  THEN 'SYNCED' ELSE status END,
                    updated_at = now()
                WHERE codigo = :c AND voucher_id IN (
                    SELECT voucher_id FROM core.nubox_export_voucher
                    WHERE batch_id = :b
                )
                """
            ),
            {"folio": folio, "c": codigo, "b": batch_id},
        )
        updated += res.rowcount

    await db.execute(
        text(
            """
            UPDATE core.nubox_export_batches
            SET status = 'CONFIRMED', confirmed_at = now()
            WHERE batch_id = :b
            """
        ),
        {"b": batch_id},
    )
    return updated
