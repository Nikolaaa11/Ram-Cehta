"""Round 118 — Import manual de RCV desde CSV del SII.

Fallback robusto: si la auto-sync (httpx → SII) falla por cambios del
portal, el operador puede:

  1. Loguear manualmente al portal sii.cl
  2. Ir a RCV → Compras (o Ventas) → Descargar CSV
  3. Subir el CSV vía POST /admin/sii/import-csv/{empresa}

El parser tolera varios formatos comunes de export del SII (cambian
con el tiempo y según el tipo de cuenta del contribuyente).

Detecta los headers por nombre, no por posición — robusto a reordering
de columnas.
"""
from __future__ import annotations

import csv
import io
import logging
import re
from datetime import date, datetime
from typing import Any

log = logging.getLogger(__name__)


# Mapeo de headers comunes del CSV SII → campos de SiiDocumento
HEADER_ALIASES: dict[str, list[str]] = {
    "tipo_dte": [
        "tipo dte", "tipo doc", "tipo documento", "tipo de doc", "type",
        "tipo",
    ],
    "folio": ["folio", "n° folio", "numero folio"],
    "fecha_emision": [
        "fecha emision", "fecha doc", "fecha documento", "fecha", "fch emis",
    ],
    "fecha_recepcion": [
        "fecha recepcion", "fecha recepción", "fch recep",
    ],
    "rut_contraparte": [
        "rut", "rut emisor", "rut receptor", "rut proveedor", "rut cliente",
    ],
    "razon_social": [
        "razon social", "razón social", "nombre",
        "nombre emisor", "nombre receptor",
    ],
    "monto_exento": ["monto exento", "exento", "mnt exe"],
    "monto_neto": ["monto neto", "neto", "mnt neto"],
    "monto_iva": ["monto iva", "iva", "mnt iva"],
    "monto_total": ["monto total", "total", "mnt total"],
    "estado": ["estado", "estado sii", "estado dte"],
}


def _norm_header(h: str) -> str:
    """Normaliza header a key canónico: minúsculas, sin tildes, sin espacios extras."""
    h = (h or "").strip().lower()
    repl = {"á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ñ": "n"}
    for k, v in repl.items():
        h = h.replace(k, v)
    return h


def _resolve_header_map(headers: list[str]) -> dict[str, int]:
    """Devuelve dict {campo_canonico: indice_columna}. None si no encuentra."""
    out: dict[str, int] = {}
    for idx, h in enumerate(headers):
        h_norm = _norm_header(h)
        for canonical, aliases in HEADER_ALIASES.items():
            if canonical in out:
                continue
            if h_norm in [_norm_header(a) for a in aliases]:
                out[canonical] = idx
                break
    return out


def _to_int(s: Any) -> int:
    """1.234.567 / 1,234,567 / 1234567 → 1234567."""
    if s is None or s == "":
        return 0
    if isinstance(s, int | float):
        return int(s)
    cleaned = re.sub(r"[^0-9\-]", "", str(s))
    if not cleaned or cleaned == "-":
        return 0
    try:
        return int(cleaned)
    except ValueError:
        return 0


def _to_date(s: Any) -> date | None:
    """Parsea DD/MM/YYYY o YYYY-MM-DD."""
    if not s:
        return None
    s = str(s).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _to_int_tipo_dte(s: Any) -> int:
    """El CSV puede tener '33' o '33 - Factura electrónica'. Toma los primeros dígitos."""
    if s is None:
        return 0
    m = re.match(r"^\s*(\d+)", str(s))
    return int(m.group(1)) if m else 0


def parse_csv_rcv(
    csv_content: bytes | str,
    *,
    flujo: str,
    periodo_default: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Parsea el CSV del RCV. Devuelve (docs, errors).

    `flujo` se pasa al output (no se detecta — el operador lo elige al subir).
    `periodo_default` se usa si las filas no traen un período obvio.

    El parser tolera:
      - Separador `;` (default del SII) o `,`
      - Encoding cp1252, latin1, utf-8 (auto-detect)
      - Filas vacías intercaladas
      - Headers en cualquier orden
    """
    errors: list[str] = []

    # Decode
    if isinstance(csv_content, bytes):
        for enc in ("utf-8-sig", "cp1252", "latin1"):
            try:
                text_content = csv_content.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            errors.append("No se pudo decodificar el CSV con utf-8/cp1252/latin1")
            return [], errors
    else:
        text_content = csv_content

    # Detect delimiter
    sniffer = csv.Sniffer()
    sample = text_content[:4096]
    try:
        dialect = sniffer.sniff(sample, delimiters=";,|\t")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ";"

    reader = csv.reader(io.StringIO(text_content), delimiter=delimiter)
    try:
        headers = next(reader)
    except StopIteration:
        errors.append("CSV vacío o sin headers")
        return [], errors

    header_map = _resolve_header_map(headers)

    required = {"tipo_dte", "folio", "rut_contraparte", "monto_total"}
    missing = required - set(header_map.keys())
    if missing:
        errors.append(
            f"CSV no tiene columnas requeridas: {sorted(missing)}. "
            f"Headers vistos: {headers}"
        )
        return [], errors

    docs: list[dict[str, Any]] = []
    for line_num, row in enumerate(reader, start=2):
        if not row or all(not (c or "").strip() for c in row):
            continue

        def cell(field: str) -> Any:
            idx = header_map.get(field)
            if idx is None or idx >= len(row):
                return None
            return row[idx]

        try:
            tipo_dte = _to_int_tipo_dte(cell("tipo_dte"))
            folio = str(cell("folio") or "").strip()
            if not tipo_dte or not folio:
                continue  # fila inválida, skip silencioso

            fecha_emision = _to_date(cell("fecha_emision"))
            # Si la fecha es null y no hay período obvio, usar default
            if fecha_emision:
                periodo = f"{fecha_emision.year:04d}-{fecha_emision.month:02d}"
            else:
                periodo = periodo_default

            docs.append({
                "flujo": flujo,
                "tipo_dte": tipo_dte,
                "folio": folio,
                "periodo": periodo,
                "rut_contraparte": str(cell("rut_contraparte") or "").strip(),
                "razon_social_contraparte": (
                    str(cell("razon_social") or "").strip() or None
                ),
                "fecha_emision": fecha_emision,
                "fecha_recepcion": _to_date(cell("fecha_recepcion")),
                "monto_exento": _to_int(cell("monto_exento")),
                "monto_neto": _to_int(cell("monto_neto")),
                "monto_iva": _to_int(cell("monto_iva")),
                "monto_total": _to_int(cell("monto_total")),
                "estado_sii": str(cell("estado") or "").strip() or "REGISTRO",
            })
        except Exception as exc:  # noqa: BLE001 — collect, don't fail
            errors.append(f"Línea {line_num}: {exc}")

    return docs, errors
