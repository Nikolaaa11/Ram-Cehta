"""OCR Cartolas Bancarias — parser puro de PDFs digitales.

Diseñado para cartolas en formato estándar de bancos chilenos:
  - Santander
  - BCI
  - BancoEstado
  - Bice
  - Itaú
  - Scotiabank

Estrategia:
  1. Extrae texto del PDF con pypdf (sin OCR, solo PDFs digitales)
  2. Detecta banco por keywords del header
  3. Aplica parser específico del banco para extraer movimientos
  4. Devuelve lista de filas normalizadas

Si el PDF es escaneado (imagen), pypdf devuelve texto vacío. En ese caso
el caller debe usar Claude vision como fallback (no implementado acá —
fase futura).

Tests unitarios cubren las heurísticas puras sin necesidad de PDFs reales.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from io import BytesIO
from typing import Any


# ============================================================================
# Tipos de output
# ============================================================================


@dataclass
class CartolaRow:
    """Una fila normalizada de movimiento bancario."""

    fecha: date
    descripcion: str
    abono: Decimal = Decimal("0")
    egreso: Decimal = Decimal("0")
    saldo: Decimal | None = None
    documento: str | None = None  # nro de transacción, cheque, etc.


@dataclass
class CartolaParseResult:
    """Output del parse_cartola_pdf — incluye metadata + filas."""

    banco: str  # 'santander', 'bci', 'banco_estado', 'bice', 'itau', 'scotiabank', 'unknown'
    periodo_desde: date | None
    periodo_hasta: date | None
    rows: list[CartolaRow] = field(default_factory=list)
    raw_text: str = ""  # primer 5000 chars para debug
    is_scanned: bool = False  # True si pypdf no extrajo texto
    error: str | None = None


# ============================================================================
# Detección de banco — heurísticas por keywords del header
# ============================================================================


_BANCO_PATTERNS: dict[str, list[str]] = {
    "santander": ["santander chile", "banco santander"],
    "bci": ["banco de credito e inversiones", "bci.cl", "bci empresas"],
    "banco_estado": ["bancoestado", "banco del estado", "banco estado"],
    "bice": ["banco bice", "bice.cl"],
    "itau": ["banco itau", "itaú chile", "itau chile"],
    "scotiabank": ["scotiabank chile", "scotia"],
    "security": ["banco security"],
    "internacional": ["banco internacional"],
    "consorcio": ["banco consorcio"],
    "falabella": ["banco falabella"],
}


def detect_banco(text: str) -> str:
    """Detecta el banco por keywords en el texto del PDF (case-insensitive).

    Devuelve el código normalizado del banco o 'unknown' si no matchea.
    """
    lower = text.lower()
    for banco, patterns in _BANCO_PATTERNS.items():
        for pat in patterns:
            if pat in lower:
                return banco
    return "unknown"


# ============================================================================
# Parsers por banco — heurísticas regex sobre texto extraído
# ============================================================================


# Fecha estándar chilena: 31/12/2025 o 31-12-2025
_FECHA_RE = re.compile(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})")
# Fecha corta (asumimos año actual): 31/12 → 31/12/{anio_inferido}
_FECHA_CORTA_RE = re.compile(r"(\d{1,2})[/-](\d{1,2})\b")

# R152FFFFFF — Monto chileno con soporte de centavos.
# Formatos: $1.234.567,89 | 1.234.567 | 1234567 | 99,50 | 450.000,00
# Captura parte entera (grupo 1) + decimales opcionales (grupo 2).
# El regex anterior truncaba ",89" y convertía "99,50" en 0 — perdía
# todo monto con decimales (UF, USD, comisiones bancarias).
_MONTO_RE = re.compile(
    r"-?\$?\s?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?\b"
)


def _parse_fecha_full(text: str) -> date | None:
    """Parsea DD/MM/YYYY (formato chileno) o devuelve None."""
    m = _FECHA_RE.search(text)
    if not m:
        return None
    try:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return date(y, mo, d)
    except (ValueError, TypeError):
        return None


def _parse_monto(text: str) -> Decimal:
    """Parsea un monto CLP/UF/USD del texto, incluyendo centavos.

    R152FFFFFF — Soporta formato chileno completo:
      "1.234.567,89" → Decimal("1234567.89")
      "99,50"        → Decimal("99.50")  (antes daba 0 → fila descartada)
      "1.234.567"    → Decimal("1234567")
    """
    cleaned = text.strip()
    is_negative = cleaned.startswith("-") or cleaned.endswith("-")
    m = _MONTO_RE.search(cleaned)
    if not m:
        return Decimal("0")
    # Grupo 1 = parte entera (con puntos de miles), grupo 2 = decimales.
    entero = m.group(1).replace(".", "")
    decimales = m.group(2)
    num_str = f"{entero}.{decimales}" if decimales else entero
    try:
        v = Decimal(num_str)
        return -v if is_negative else v
    except Exception:  # noqa: BLE001
        return Decimal("0")


def _extract_periodo(text: str) -> tuple[date | None, date | None]:
    """Extrae periodo_desde / periodo_hasta del header de la cartola.

    Patrones típicos:
      - "Período: 01/12/2025 al 31/12/2025"
      - "Desde 01-Dic-2025 Hasta 31-Dic-2025"
      - "Mes: Diciembre 2025" (devuelve mes completo)

    Si no encuentra fechas explícitas, devuelve (None, None) — el caller
    puede inferir el periodo de las filas mismas.
    """
    # Patrón 1: "01/12/2025" + " al " + "31/12/2025"
    m = re.search(
        r"(\d{1,2}[/-]\d{1,2}[/-]\d{4})\s+(?:al|hasta|a|-)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{4})",
        text,
        re.IGNORECASE,
    )
    if m:
        return _parse_fecha_full(m.group(1)), _parse_fecha_full(m.group(2))

    # Patrón 2: tomamos primera y última fecha que aparece en el texto
    fechas_found = [
        date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        for m in _FECHA_RE.finditer(text)
        if 1 <= int(m.group(2)) <= 12 and 1 <= int(m.group(1)) <= 31
    ]
    if not fechas_found:
        return None, None
    return min(fechas_found), max(fechas_found)


# ----------------------------------------------------------------------------
# Parser genérico — funciona como fallback para bancos desconocidos
# ----------------------------------------------------------------------------


def _parse_filas_genericas(text: str) -> list[CartolaRow]:
    """Parser heurístico que busca líneas con formato:
       FECHA   DESCRIPCION    [DOCUMENTO]   MONTO   SALDO

    Asume que cada fila tiene una fecha al inicio. Filas sin fecha se ignoran.

    Para distinguir abono vs egreso:
      - Si el monto está precedido por `-` → egreso
      - Si la línea tiene keywords como "transferencia recibida", "abono" → abono
      - Si tiene "pago", "transferencia enviada", "comisión" → egreso
      - Si no se puede determinar, asumimos egreso (más conservador para
        conciliación — los falsos positivos los corrige el contador).
    """
    out: list[CartolaRow] = []
    abono_keywords = (
        "abono",
        "transferencia recibida",
        "deposito",
        "depósito",
        "interes ganado",
        "remesa",
        "ingreso",
        "credito",
        "crédito",
    )
    egreso_keywords = (
        "pago",
        "transferencia enviada",
        "transferencia a",
        "comision",
        "comisión",
        "iva",
        "impuesto",
        "cargo",
        "debito",
        "débito",
        "giro",
        "cheque pagado",
    )

    for line in text.split("\n"):
        line = line.strip()
        if not line or len(line) < 15:
            continue

        # Buscar fecha en posición 0-12 (primer token)
        date_match = _FECHA_RE.match(line)
        if not date_match:
            continue
        fecha = date(
            int(date_match.group(3)),
            int(date_match.group(2)),
            int(date_match.group(1)),
        )

        # Restante de la línea = descripción + montos
        rest = line[date_match.end() :].strip()

        # Buscar todos los montos en la línea
        montos = list(_MONTO_RE.finditer(rest))
        if not montos:
            continue

        # Heurística: típicamente las cartolas tienen 2-3 montos por fila:
        #   - movimiento (abono o egreso)
        #   - saldo
        # Si solo hay 1 monto, es el movimiento (sin saldo)
        # Si hay 2+, el último es el saldo, el penúltimo es el movimiento
        monto_str = montos[-2].group(0) if len(montos) >= 2 else montos[-1].group(0)
        saldo_str = montos[-1].group(0) if len(montos) >= 2 else None
        # Descripción = todo antes del primer monto
        desc = rest[: montos[0].start()].strip()

        monto_val = _parse_monto(monto_str)
        saldo_val = _parse_monto(saldo_str) if saldo_str else None

        # Clasificar abono vs egreso
        desc_lower = desc.lower()
        is_abono = any(k in desc_lower for k in abono_keywords)
        is_egreso = any(k in desc_lower for k in egreso_keywords)
        # Si el monto es negativo, override a egreso
        if monto_val < 0:
            is_egreso = True
            is_abono = False
            monto_val = abs(monto_val)

        if is_abono and not is_egreso:
            row = CartolaRow(
                fecha=fecha, descripcion=desc[:200],
                abono=monto_val, egreso=Decimal("0"),
                saldo=saldo_val,
            )
        else:
            # Default: egreso (más conservador — el conciliador puede corregir)
            row = CartolaRow(
                fecha=fecha, descripcion=desc[:200],
                abono=Decimal("0"), egreso=monto_val,
                saldo=saldo_val,
            )
        out.append(row)

    return out


# ============================================================================
# Entry point
# ============================================================================


def parse_cartola_pdf(content: bytes) -> CartolaParseResult:
    """Parsea un PDF de cartola bancaria. Función pura — testeable.

    Devuelve `CartolaParseResult` con metadata + filas extraídas.
    Si el PDF es escaneado (texto vacío), devuelve `is_scanned=True` y
    deja `rows` vacío para que el caller pueda usar Claude vision.
    """
    try:
        from pypdf import PdfReader
    except ImportError:
        return CartolaParseResult(
            banco="unknown",
            periodo_desde=None,
            periodo_hasta=None,
            error="pypdf no instalado",
        )

    try:
        reader = PdfReader(BytesIO(content))
        full_text = ""
        for page in reader.pages:
            full_text += page.extract_text() + "\n"
    except Exception as exc:  # noqa: BLE001
        return CartolaParseResult(
            banco="unknown",
            periodo_desde=None,
            periodo_hasta=None,
            error=f"PdfReader falló: {exc}",
        )

    text_clean = full_text.strip()
    if not text_clean or len(text_clean) < 50:
        # PDF probablemente escaneado o vacío
        return CartolaParseResult(
            banco="unknown",
            periodo_desde=None,
            periodo_hasta=None,
            is_scanned=True,
            raw_text=text_clean[:5000],
            error="PDF parece escaneado (sin texto extraíble)",
        )

    banco = detect_banco(text_clean)
    periodo_desde, periodo_hasta = _extract_periodo(text_clean)
    rows = _parse_filas_genericas(text_clean)

    return CartolaParseResult(
        banco=banco,
        periodo_desde=periodo_desde,
        periodo_hasta=periodo_hasta,
        rows=rows,
        raw_text=text_clean[:5000],
        is_scanned=False,
    )


def file_hash(content: bytes) -> str:
    """Hash SHA-256 de los bytes del archivo. Para idempotencia del sync."""
    return hashlib.sha256(content).hexdigest()


def build_movimiento_natural_key(
    *,
    empresa_codigo: str,
    fecha: date,
    descripcion: str,
    monto: Decimal,
    banco: str,
) -> str:
    """Construye la natural_key para core.movimientos.

    Misma fila importada desde el mismo PDF dos veces → mismo natural_key
    → ON CONFLICT DO NOTHING evita duplicar.
    """
    raw = f"cartola|{empresa_codigo}|{fecha.isoformat()}|{banco}|{descripcion[:80]}|{monto}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def serialize_rows_for_log(rows: list[CartolaRow]) -> list[dict[str, Any]]:
    """Serializa rows a JSON-friendly para logs / audit. Sample first 5."""
    return [
        {
            "fecha": r.fecha.isoformat(),
            "descripcion": r.descripcion[:80],
            "abono": str(r.abono),
            "egreso": str(r.egreso),
        }
        for r in rows[:5]
    ]
