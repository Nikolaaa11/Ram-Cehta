"""V5++ ola Y — Bulk import de vouchers desde CSV (Excel chileno).

Formato esperado:
    - Separator: `;`  (Excel chileno default)
    - Encoding: UTF-8 (con o sin BOM)
    - Decimales: `,` o `.` (ambos aceptados)
    - Fechas: ISO `YYYY-MM-DD` o chileno `DD-MM-YYYY` o `DD/MM/YYYY`

Estructura: una fila = una LÍNEA del voucher. Las filas con el mismo
`voucher_ref` (cualquier identificador único en el archivo, ej. número
correlativo del usuario) se agrupan en un solo voucher con sus líneas.

Columnas (case-insensitive, normalizadas a snake_case):

  Header (igual en todas las filas del mismo voucher_ref):
    voucher_ref                — STRING obligatorio, agrupa filas
    empresa_codigo             — código empresa (FONDO, GP, etc)
    tipo                       — INGRESO|EGRESO|TRASPASO|COMPRA|VENTA|...
    fecha_documento            — fecha emisión doc
    fecha_contable             — fecha contable (período)
    glosa                      — texto descriptivo
    contraparte_rut            — opcional
    contraparte_nombre         — opcional
    doc_tributario_tipo        — opcional
    doc_tributario_folio       — opcional

  Líneas:
    line_number                — int >=1, correlativo dentro del voucher
    cuenta_codigo              — código del plan de cuentas
    proyecto_codigo            — opcional
    area_codigo                — opcional
    debit                      — monto debe (default 0)
    credit                     — monto haber (default 0)
    descripcion                — opcional

Output: report con vouchers creados + errores (best-effort por voucher,
no por línea — un voucher con error no se inserta, pero los demás sí).

Todos los vouchers se crean en `DRAFT` (descuadre permitido). El user
puede revisar y submit manualmente, o usar /vouchers/bulk-approve después.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from pydantic import ValidationError

from app.schemas.voucher import VoucherCreate, VoucherLineCreate

# Aliases aceptados (case-insensitive). Permite headers en español o variantes.
COLUMN_ALIASES: dict[str, str] = {
    "voucher_ref": "voucher_ref",
    "ref": "voucher_ref",
    "referencia": "voucher_ref",
    "numero": "voucher_ref",
    "n": "voucher_ref",
    "empresa_codigo": "empresa_codigo",
    "empresa": "empresa_codigo",
    "tipo": "tipo",
    "fecha_documento": "fecha_documento",
    "fecha_doc": "fecha_documento",
    "fecha_contable": "fecha_contable",
    "fecha": "fecha_contable",
    "glosa": "glosa",
    "descripcion_voucher": "glosa",
    "contraparte_rut": "contraparte_rut",
    "rut": "contraparte_rut",
    "contraparte_nombre": "contraparte_nombre",
    "contraparte": "contraparte_nombre",
    "doc_tributario_tipo": "doc_tributario_tipo",
    "tipo_documento": "doc_tributario_tipo",
    "doc_tributario_folio": "doc_tributario_folio",
    "folio": "doc_tributario_folio",
    "line_number": "line_number",
    "linea": "line_number",
    "cuenta_codigo": "cuenta_codigo",
    "cuenta": "cuenta_codigo",
    "proyecto_codigo": "proyecto_codigo",
    "proyecto": "proyecto_codigo",
    "area_codigo": "area_codigo",
    "area": "area_codigo",
    "debit": "debit",
    "debe": "debit",
    "credit": "credit",
    "haber": "credit",
    "descripcion": "descripcion",
    "detalle": "descripcion",
}


@dataclass
class CsvImportError:
    voucher_ref: str | None
    row: int  # 1-indexed (incluyendo header)
    field: str | None
    message: str


@dataclass
class CsvImportReport:
    """Resumen post-procesamiento del CSV."""

    total_rows: int = 0
    total_vouchers_intended: int = 0
    vouchers_created: list[dict[str, Any]] = field(default_factory=list)
    errors: list[CsvImportError] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_rows": self.total_rows,
            "total_vouchers_intended": self.total_vouchers_intended,
            "vouchers_created_count": len(self.vouchers_created),
            "errors_count": len(self.errors),
            "vouchers_created": self.vouchers_created,
            "errors": [
                {
                    "voucher_ref": e.voucher_ref,
                    "row": e.row,
                    "field": e.field,
                    "message": e.message,
                }
                for e in self.errors
            ],
        }


def _normalize_header(name: str) -> str:
    return name.strip().lower().replace(" ", "_").replace("-", "_")


def _parse_date(s: str) -> date:
    """Parse ISO o chileno DD-MM-YYYY / DD/MM/YYYY."""
    s = s.strip()
    if not s:
        raise ValueError("vacío")
    # ISO
    try:
        return date.fromisoformat(s)
    except ValueError:
        pass
    # Chileno con separadores varios
    for sep in ("-", "/", "."):
        if sep in s:
            parts = s.split(sep)
            if len(parts) == 3:
                d, m, y = parts
                if len(y) == 2:
                    y = "20" + y
                try:
                    return date(int(y), int(m), int(d))
                except ValueError:
                    continue
    raise ValueError(f"formato fecha inválido: {s!r} (usar YYYY-MM-DD)")


def _parse_decimal(s: str) -> Decimal:
    """Parse decimal aceptando ',' o '.'. Vacío → 0."""
    s = s.strip()
    if not s:
        return Decimal("0")
    # Si tiene tanto '.' como ',', asumimos que ',' es decimal (formato europeo)
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return Decimal(s)
    except InvalidOperation as exc:
        raise ValueError(f"decimal inválido: {s!r}") from exc


def _decode_csv_bytes(raw: bytes) -> str:
    """Soporta UTF-8 con/sin BOM y latin-1 fallback."""
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1", errors="replace")


def _detect_dialect(sample: str) -> csv.Dialect:
    """Detecta `;` vs `,` (Excel chileno usa `;`)."""
    sniffer = csv.Sniffer()
    try:
        return sniffer.sniff(sample, delimiters=";,\t|")
    except csv.Error:
        # Fallback a `;` si no detecta
        class _Dialect(csv.excel):
            delimiter = ";"

        return _Dialect()


def parse_csv_to_vouchers(
    raw_bytes: bytes,
) -> tuple[list[VoucherCreate], CsvImportReport]:
    """Parsea CSV → lista de VoucherCreate listas para insertar + report.

    NO toca DB. Solo parsea, valida estructura Pydantic, agrupa por voucher_ref.
    El endpoint que usa esto se encarga de validar contra DB (cuentas, empresas)
    e insertar en transacción.
    """
    report = CsvImportReport()
    text = _decode_csv_bytes(raw_bytes)

    if not text.strip():
        report.errors.append(CsvImportError(None, 0, None, "CSV vacío"))
        return [], report

    sample = text[:2048]
    dialect = _detect_dialect(sample)

    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        report.errors.append(
            CsvImportError(None, 1, None, "CSV sin encabezados")
        )
        return [], report

    # Normalizar headers usando aliases
    raw_headers = [_normalize_header(h) for h in reader.fieldnames]
    canonical_headers = [
        COLUMN_ALIASES.get(h, h) for h in raw_headers
    ]
    header_map = dict(zip(raw_headers, canonical_headers))

    # Validar columnas requeridas
    required = {
        "voucher_ref",
        "empresa_codigo",
        "tipo",
        "fecha_documento",
        "fecha_contable",
        "glosa",
        "line_number",
        "cuenta_codigo",
    }
    present = set(canonical_headers)
    missing = required - present
    if missing:
        report.errors.append(
            CsvImportError(
                None,
                1,
                None,
                f"Columnas obligatorias faltantes: {sorted(missing)}",
            )
        )
        return [], report

    # Agrupar filas por voucher_ref
    grouped: dict[str, list[tuple[int, dict[str, str]]]] = {}
    for row_idx, raw_row in enumerate(reader, start=2):  # 2 = primera fila datos
        report.total_rows += 1
        # Re-mapear keys con aliases
        row = {
            header_map.get(_normalize_header(k), _normalize_header(k)): (v or "").strip()
            for k, v in raw_row.items()
            if k is not None
        }
        ref = row.get("voucher_ref", "").strip()
        if not ref:
            report.errors.append(
                CsvImportError(None, row_idx, "voucher_ref", "vacío")
            )
            continue
        grouped.setdefault(ref, []).append((row_idx, row))

    report.total_vouchers_intended = len(grouped)

    # Construir VoucherCreate por grupo
    vouchers: list[VoucherCreate] = []
    for ref, rows in grouped.items():
        try:
            voucher = _build_voucher_from_rows(ref, rows, report)
            if voucher is not None:
                vouchers.append(voucher)
        except Exception as exc:  # noqa: BLE001
            report.errors.append(
                CsvImportError(
                    ref, rows[0][0], None, f"error procesando voucher: {exc}"
                )
            )

    return vouchers, report


def _build_voucher_from_rows(
    ref: str,
    rows: list[tuple[int, dict[str, str]]],
    report: CsvImportReport,
) -> VoucherCreate | None:
    """Construye VoucherCreate desde N filas con mismo voucher_ref."""
    first_row_idx, first_row = rows[0]

    # Header fields — leemos de la primera fila. Si filas siguientes
    # tienen diff value en estos, tomamos la primera (y warneamos).
    try:
        empresa_codigo = first_row["empresa_codigo"]
        tipo = first_row["tipo"].upper()
        fecha_doc = _parse_date(first_row["fecha_documento"])
        fecha_cont = _parse_date(first_row["fecha_contable"])
        glosa = first_row["glosa"]
    except (KeyError, ValueError) as exc:
        report.errors.append(
            CsvImportError(ref, first_row_idx, None, f"header inválido: {exc}")
        )
        return None

    contraparte_rut = first_row.get("contraparte_rut") or None
    contraparte_nombre = first_row.get("contraparte_nombre") or None
    doc_tipo_raw = (first_row.get("doc_tributario_tipo") or "").upper().strip()
    doc_tipo = doc_tipo_raw if doc_tipo_raw else None
    doc_folio = first_row.get("doc_tributario_folio") or None

    # Líneas
    lines: list[VoucherLineCreate] = []
    for row_idx, row in rows:
        try:
            line_number = int(row.get("line_number", "0"))
        except ValueError:
            report.errors.append(
                CsvImportError(ref, row_idx, "line_number", "no es entero")
            )
            return None

        cuenta = row.get("cuenta_codigo", "").strip()
        if not cuenta:
            report.errors.append(
                CsvImportError(ref, row_idx, "cuenta_codigo", "vacío")
            )
            return None

        try:
            debit = _parse_decimal(row.get("debit", "0"))
            credit = _parse_decimal(row.get("credit", "0"))
        except ValueError as exc:
            report.errors.append(
                CsvImportError(ref, row_idx, "debit/credit", str(exc))
            )
            return None

        try:
            line = VoucherLineCreate(
                line_number=line_number,
                cuenta_codigo=cuenta,
                proyecto_codigo=row.get("proyecto_codigo") or None,
                area_codigo=(row.get("area_codigo") or None) or None,
                debit=debit,
                credit=credit,
                descripcion=row.get("descripcion") or None,
            )
        except ValidationError as exc:
            report.errors.append(
                CsvImportError(ref, row_idx, None, f"línea inválida: {exc.errors()[0].get('msg', exc)}")
            )
            return None
        lines.append(line)

    # Ordenar por line_number ascendente
    lines.sort(key=lambda x: x.line_number)

    # Construir VoucherCreate (status=DRAFT por defecto, permite descuadre)
    try:
        return VoucherCreate(
            empresa_codigo=empresa_codigo,
            tipo=tipo,  # type: ignore[arg-type]
            status="DRAFT",
            fecha_documento=fecha_doc,
            fecha_contable=fecha_cont,
            glosa=glosa,
            contraparte_rut=contraparte_rut,
            contraparte_nombre=contraparte_nombre,
            doc_tributario_tipo=doc_tipo,  # type: ignore[arg-type]
            doc_tributario_folio=doc_folio,
            lines=lines,
        )
    except ValidationError as exc:
        msg = exc.errors()[0].get("msg", str(exc))
        report.errors.append(
            CsvImportError(ref, first_row_idx, None, f"voucher inválido: {msg}")
        )
        return None
