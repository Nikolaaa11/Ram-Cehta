"""V5++ ola AA — Bulk import de Órdenes de Compra desde CSV (Excel chileno).

Mismo patrón que voucher_csv_import_service (ola Y) pero adaptado al schema
de OCs:
  - Header: numero_oc, empresa_codigo, fecha_emision, moneda, forma_pago,
    plazo_pago, observaciones, validez_dias
  - Items: item (line_number), descripcion, precio_unitario, cantidad

Una fila por ITEM. Mismo `numero_oc` agrupa items en una OC.

Output: lista de OrdenCompraCreate listas para insertar + report con
errores por fila.

NO toca DB. El endpoint que use este servicio se encarga de validar
existencia previa de la OC (numero_oc único por empresa) antes de insertar.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from pydantic import ValidationError

from app.schemas.orden_compra import OCDetalleCreate, OrdenCompraCreate
from app.services.voucher_csv_import_service import (
    _decode_csv_bytes,
    _detect_dialect,
    _parse_date,
    _parse_decimal,
)


# Aliases case-insensitive (español + variantes inglés)
COLUMN_ALIASES: dict[str, str] = {
    "numero_oc": "numero_oc",
    "numero": "numero_oc",
    "n_oc": "numero_oc",
    "oc": "numero_oc",
    "empresa_codigo": "empresa_codigo",
    "empresa": "empresa_codigo",
    "proveedor_id": "proveedor_id",
    "proveedor": "proveedor_id",
    "fecha_emision": "fecha_emision",
    "fecha": "fecha_emision",
    "validez_dias": "validez_dias",
    "validez": "validez_dias",
    "moneda": "moneda",
    "forma_pago": "forma_pago",
    "plazo_pago": "plazo_pago",
    "plazo": "plazo_pago",
    "observaciones": "observaciones",
    "obs": "observaciones",
    "item": "item",
    "linea": "item",
    "n_item": "item",
    "descripcion": "descripcion",
    "detalle": "descripcion",
    "producto": "descripcion",
    "precio_unitario": "precio_unitario",
    "precio": "precio_unitario",
    "p_unitario": "precio_unitario",
    "cantidad": "cantidad",
    "qty": "cantidad",
}


@dataclass
class OcCsvImportError:
    numero_oc: str | None
    row: int
    field: str | None
    message: str


@dataclass
class OcCsvImportReport:
    total_rows: int = 0
    total_ocs_intended: int = 0
    ocs_created: list[dict[str, Any]] = field(default_factory=list)
    errors: list[OcCsvImportError] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_rows": self.total_rows,
            "total_ocs_intended": self.total_ocs_intended,
            "ocs_created_count": len(self.ocs_created),
            "errors_count": len(self.errors),
            "ocs_created": self.ocs_created,
            "errors": [
                {
                    "numero_oc": e.numero_oc,
                    "row": e.row,
                    "field": e.field,
                    "message": e.message,
                }
                for e in self.errors
            ],
        }


def _normalize_header(name: str) -> str:
    return name.strip().lower().replace(" ", "_").replace("-", "_")


def parse_csv_to_ocs(
    raw_bytes: bytes,
) -> tuple[list[OrdenCompraCreate], OcCsvImportReport]:
    """Parsea CSV → lista de OrdenCompraCreate listas para insertar + report."""
    report = OcCsvImportReport()
    text = _decode_csv_bytes(raw_bytes)

    if not text.strip():
        report.errors.append(OcCsvImportError(None, 0, None, "CSV vacío"))
        return [], report

    dialect = _detect_dialect(text[:2048])
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        report.errors.append(
            OcCsvImportError(None, 1, None, "CSV sin encabezados")
        )
        return [], report

    raw_headers = [_normalize_header(h) for h in reader.fieldnames]
    canonical_headers = [COLUMN_ALIASES.get(h, h) for h in raw_headers]
    header_map = dict(zip(raw_headers, canonical_headers))

    required = {
        "numero_oc",
        "empresa_codigo",
        "fecha_emision",
        "item",
        "descripcion",
        "precio_unitario",
        "cantidad",
    }
    present = set(canonical_headers)
    missing = required - present
    if missing:
        report.errors.append(
            OcCsvImportError(
                None,
                1,
                None,
                f"Columnas obligatorias faltantes: {sorted(missing)}",
            )
        )
        return [], report

    grouped: dict[str, list[tuple[int, dict[str, str]]]] = {}
    for row_idx, raw_row in enumerate(reader, start=2):
        report.total_rows += 1
        row = {
            header_map.get(_normalize_header(k), _normalize_header(k)): (v or "").strip()
            for k, v in raw_row.items()
            if k is not None
        }
        numero = row.get("numero_oc", "").strip()
        if not numero:
            report.errors.append(
                OcCsvImportError(None, row_idx, "numero_oc", "vacío")
            )
            continue
        # Key combina numero + empresa para no colapsar OCs con mismo
        # número en empresas distintas
        key = f"{row.get('empresa_codigo', '')}|{numero}"
        grouped.setdefault(key, []).append((row_idx, row))

    report.total_ocs_intended = len(grouped)

    ocs: list[OrdenCompraCreate] = []
    for _key, rows in grouped.items():
        try:
            oc = _build_oc_from_rows(rows, report)
            if oc is not None:
                ocs.append(oc)
        except Exception as exc:  # noqa: BLE001
            ref_numero = rows[0][1].get("numero_oc")
            report.errors.append(
                OcCsvImportError(
                    ref_numero, rows[0][0], None, f"error procesando OC: {exc}"
                )
            )

    return ocs, report


def _build_oc_from_rows(
    rows: list[tuple[int, dict[str, str]]],
    report: OcCsvImportReport,
) -> OrdenCompraCreate | None:
    """Construye OrdenCompraCreate desde N filas con mismo numero_oc."""
    first_row_idx, first_row = rows[0]
    numero_oc = first_row.get("numero_oc", "")

    try:
        empresa_codigo = first_row["empresa_codigo"]
        fecha_emision = _parse_date(first_row["fecha_emision"])
    except (KeyError, ValueError) as exc:
        report.errors.append(
            OcCsvImportError(numero_oc, first_row_idx, None, f"header inválido: {exc}")
        )
        return None

    moneda_raw = (first_row.get("moneda") or "CLP").upper().strip()
    if moneda_raw not in ("CLP", "UF", "USD"):
        report.errors.append(
            OcCsvImportError(
                numero_oc,
                first_row_idx,
                "moneda",
                f"moneda inválida: {moneda_raw} (CLP|UF|USD)",
            )
        )
        return None

    proveedor_id_raw = first_row.get("proveedor_id", "").strip()
    proveedor_id: int | None = None
    if proveedor_id_raw:
        try:
            proveedor_id = int(proveedor_id_raw)
        except ValueError:
            report.errors.append(
                OcCsvImportError(
                    numero_oc,
                    first_row_idx,
                    "proveedor_id",
                    f"no es entero: {proveedor_id_raw!r}",
                )
            )
            return None

    validez_raw = first_row.get("validez_dias", "").strip() or "30"
    try:
        validez_dias = int(validez_raw)
    except ValueError:
        report.errors.append(
            OcCsvImportError(
                numero_oc, first_row_idx, "validez_dias", f"no es entero: {validez_raw!r}"
            )
        )
        return None

    items: list[OCDetalleCreate] = []
    neto_total = Decimal("0")
    for row_idx, row in rows:
        try:
            item_num = int(row.get("item", "0"))
        except ValueError:
            report.errors.append(
                OcCsvImportError(numero_oc, row_idx, "item", "no es entero")
            )
            return None

        descripcion = row.get("descripcion", "").strip()
        if not descripcion:
            report.errors.append(
                OcCsvImportError(numero_oc, row_idx, "descripcion", "vacío")
            )
            return None

        try:
            precio = _parse_decimal(row.get("precio_unitario", "0"))
            cantidad = _parse_decimal(row.get("cantidad", "0"))
        except ValueError as exc:
            report.errors.append(
                OcCsvImportError(numero_oc, row_idx, "precio/cantidad", str(exc))
            )
            return None

        try:
            item_obj = OCDetalleCreate(
                item=item_num,
                descripcion=descripcion,
                precio_unitario=precio,
                cantidad=cantidad,
            )
        except ValidationError as exc:
            msg = exc.errors()[0].get("msg", str(exc))
            report.errors.append(
                OcCsvImportError(numero_oc, row_idx, None, f"item inválido: {msg}")
            )
            return None
        items.append(item_obj)
        neto_total += precio * cantidad

    items.sort(key=lambda x: x.item)

    try:
        return OrdenCompraCreate(
            numero_oc=numero_oc,
            empresa_codigo=empresa_codigo,
            proveedor_id=proveedor_id,
            fecha_emision=fecha_emision,
            validez_dias=validez_dias,
            moneda=moneda_raw,  # type: ignore[arg-type]
            neto=neto_total,
            forma_pago=first_row.get("forma_pago") or None,
            plazo_pago=first_row.get("plazo_pago") or None,
            observaciones=first_row.get("observaciones") or None,
            items=items,
        )
    except ValidationError as exc:
        msg = exc.errors()[0].get("msg", str(exc))
        report.errors.append(
            OcCsvImportError(numero_oc, first_row_idx, None, f"OC inválida: {msg}")
        )
        return None


# Re-export para tests que reusan helpers
__all__ = [
    "OcCsvImportError",
    "OcCsvImportReport",
    "parse_csv_to_ocs",
]
