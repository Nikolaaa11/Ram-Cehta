"""Unit tests para `app.services.etl_service`.

No tocan red ni base — sólo helpers puros y validaciones. La parte de DB
real (UPSERT, FK catálogos) se cubre con integration tests cuando estén.
"""
from __future__ import annotations

import io
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest
from openpyxl import Workbook

from app.services.etl_service import (
    RawRow,
    _is_valid_periodo,
    _to_date,
    _to_decimal,
    _validate_and_transform_row,
    check_should_run,
    compute_file_hash,
    compute_natural_key,
    parse_resumen_sheet,
)

# ---------------------------------------------------------------------------
# compute_file_hash
# ---------------------------------------------------------------------------


def test_compute_file_hash_returns_64_hex_chars() -> None:
    h = compute_file_hash(b"hello world")
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)


def test_compute_file_hash_is_deterministic() -> None:
    payload = b"some-bytes-payload-12345"
    assert compute_file_hash(payload) == compute_file_hash(payload)


def test_compute_file_hash_changes_on_input_change() -> None:
    assert compute_file_hash(b"a") != compute_file_hash(b"b")


# ---------------------------------------------------------------------------
# compute_natural_key
# ---------------------------------------------------------------------------


def test_compute_natural_key_is_deterministic() -> None:
    row = {
        "fecha": date(2026, 4, 15),
        "descripcion": "Pago factura X",
        "abono": Decimal("0"),
        "egreso": Decimal("100000.00"),
        "empresa_codigo": "TRONGKAI",
        "banco": "BancoEstado",
    }
    k1 = compute_natural_key(row)
    k2 = compute_natural_key(row)
    assert k1 == k2
    assert len(k1) == 64


def test_compute_natural_key_normalizes_case_and_whitespace() -> None:
    base = {
        "fecha": date(2026, 4, 15),
        "descripcion": "Pago factura X",
        "abono": Decimal("0"),
        "egreso": Decimal("100"),
        "empresa_codigo": "TRONGKAI",
        "banco": "BancoEstado",
    }
    k_base = compute_natural_key(base)
    same_logical = {
        **base,
        "descripcion": "  PAGO FACTURA X  ",
        "empresa_codigo": "trongkai",
        "banco": "bancoestado",
    }
    assert compute_natural_key(same_logical) == k_base


def test_compute_natural_key_changes_on_amount_change() -> None:
    row1 = {
        "fecha": date(2026, 4, 15),
        "descripcion": "Pago",
        "abono": Decimal("0"),
        "egreso": Decimal("100"),
        "empresa_codigo": "T",
        "banco": "B",
    }
    row2 = {**row1, "egreso": Decimal("200")}
    assert compute_natural_key(row1) != compute_natural_key(row2)


# ---------------------------------------------------------------------------
# _to_decimal
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("", None),
        ("  ", None),
        ("100", Decimal("100")),
        ("1234.56", Decimal("1234.56")),
        ("1.234,56", Decimal("1234.56")),  # es-CL
        ("1,234.56", Decimal("1234.56")),  # en-US
        ("1234,56", Decimal("1234.56")),  # solo coma decimal
        (1234.56, Decimal("1234.56")),
        (100, Decimal("100")),
        ("not-a-number", None),
    ],
)
def test_to_decimal(value: object, expected: Decimal | None) -> None:
    assert _to_decimal(value) == expected


# ---------------------------------------------------------------------------
# _to_date
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("", None),
        ("2026-04-15", date(2026, 4, 15)),
        ("15/04/2026", date(2026, 4, 15)),
        ("15-04-2026", date(2026, 4, 15)),
        (date(2026, 4, 15), date(2026, 4, 15)),
        ("not-a-date", None),
    ],
)
def test_to_date(value: object, expected: date | None) -> None:
    assert _to_date(value) == expected


# ---------------------------------------------------------------------------
# _is_valid_periodo
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("periodo", "anio", "expected"),
    [
        ("02_26", 2026, True),
        ("11_25", 2025, True),
        ("02_26", None, True),  # sin anio aún acepta formato válido
        ("13_26", 2026, False),  # mes inválido
        ("00_26", 2026, False),  # mes inválido
        ("02-26", 2026, False),  # separador erróneo
        ("0226", 2026, False),
        ("", 2026, False),
        ("02_27", 2026, False),  # YY inconsistente con anio
    ],
)
def test_is_valid_periodo(periodo: str, anio: int | None, expected: bool) -> None:
    assert _is_valid_periodo(periodo, anio) is expected


# ---------------------------------------------------------------------------
# _validate_and_transform_row
# ---------------------------------------------------------------------------


VALID_EMPRESAS = {"TRONGKAI", "REVTECH", "EVOQUE"}


def _row(**overrides: object) -> RawRow:
    base = {
        "fecha": "2026-04-15",
        "descripcion": "Pago test",
        "abonos": "0",
        "egreso": "100",
        "anio": "2026",
        "periodo": "04_26",
        "empresa": "TRONGKAI",
        "banco": "BancoEstado",
    }
    base.update(overrides)  # type: ignore[arg-type]
    return RawRow(source_row_num=2, data=base)  # type: ignore[arg-type]


def test_valid_row_passes() -> None:
    row, rej = _validate_and_transform_row(_row(), VALID_EMPRESAS)
    assert rej is None
    assert row is not None
    assert row["empresa_codigo"] == "TRONGKAI"
    assert row["fecha"] == date(2026, 4, 15)
    assert row["egreso"] == Decimal("100")
    assert "natural_key" in row
    assert len(row["natural_key"]) == 64


def test_empty_fecha_is_rejected() -> None:
    _, rej = _validate_and_transform_row(_row(fecha=None), VALID_EMPRESAS)
    assert rej is not None
    assert "fecha" in rej.reason.lower()


def test_invalid_fecha_is_rejected() -> None:
    _, rej = _validate_and_transform_row(_row(fecha="potato"), VALID_EMPRESAS)
    assert rej is not None
    assert "fecha" in rej.reason.lower()


def test_empresa_inexistente_is_rejected() -> None:
    _, rej = _validate_and_transform_row(
        _row(empresa="NOEXISTE"), VALID_EMPRESAS
    )
    assert rej is not None
    assert "no existe" in rej.reason.lower()


def test_empresa_vacia_is_rejected() -> None:
    _, rej = _validate_and_transform_row(_row(empresa=""), VALID_EMPRESAS)
    assert rej is not None
    assert "empresa" in rej.reason.lower()


def test_periodo_invalido_is_rejected() -> None:
    _, rej = _validate_and_transform_row(
        _row(periodo="04-2026"), VALID_EMPRESAS
    )
    assert rej is not None
    assert "periodo" in rej.reason.lower()


def test_periodo_inconsistente_con_anio_is_rejected() -> None:
    _, rej = _validate_and_transform_row(
        _row(periodo="04_27", anio="2026"), VALID_EMPRESAS
    )
    assert rej is not None
    assert "periodo" in rej.reason.lower()


def test_abono_y_egreso_simultaneos_is_rejected() -> None:
    _, rej = _validate_and_transform_row(
        _row(abonos="50", egreso="100"), VALID_EMPRESAS
    )
    assert rej is not None
    assert "abono" in rej.reason.lower()
    assert "egreso" in rej.reason.lower()


def test_real_proyectado_normalizes() -> None:
    row, _ = _validate_and_transform_row(
        _row(real_proyectado="real"), VALID_EMPRESAS
    )
    assert row is not None
    assert row["real_proyectado"] == "Real"

    row2, _ = _validate_and_transform_row(
        _row(real_proyectado="Proyectado"), VALID_EMPRESAS
    )
    assert row2 is not None
    assert row2["real_proyectado"] == "Proyectado"

    row3, _ = _validate_and_transform_row(
        _row(real_proyectado="otro"), VALID_EMPRESAS
    )
    assert row3 is not None
    assert row3["real_proyectado"] is None


# ---------------------------------------------------------------------------
# parse_resumen_sheet
# ---------------------------------------------------------------------------


def _build_sample_xlsx() -> bytes:
    """Construye un xlsx mínimo con hoja Resumen para tests."""
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "Resumen"
    ws.append(
        [
            "Hipervinculo",
            "Fecha",
            "Descripcion",
            "Abonos",
            "Egreso",
            "Saldo Contable",
            "Saldo Cehta",
            "Saldo Corfo",
            "Concepto General",
            "Concepto Detallado",
            "Tipo Egreso",
            "Fuentes",
            "Proyecto",
            "Banco",
            "Real/Proyectado",
            "Año",
            "Periodo",
            "Empresa",
            "IVA Crédito",
            "IVA Débito",
        ]
    )
    ws.append(
        [
            "https://x",
            "2026-04-15",
            "Pago factura A",
            0,
            100000,
            500000,
            None,
            None,
            "Operacionales",
            "Servicios",
            "Operativo",
            "Corporativo",
            "Proyecto X",
            "BancoEstado",
            "Real",
            2026,
            "04_26",
            "TRONGKAI",
            19000,
            0,
        ]
    )
    # Fila vacía — debe ignorarse
    ws.append([None] * 20)
    # Fila con fecha rota
    ws.append(
        [
            None,
            "fecha-rota",
            "Test rejected",
            0,
            50,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            2026,
            "04_26",
            "TRONGKAI",
            None,
            None,
        ]
    )
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_resumen_sheet_basic() -> None:
    content = _build_sample_xlsx()
    raw_rows, _ = parse_resumen_sheet(content)
    # 2 filas con datos (la vacía no cuenta)
    assert len(raw_rows) == 2
    first = raw_rows[0]
    assert first.data.get("descripcion") == "Pago factura A"
    assert first.data.get("empresa") == "TRONGKAI"
    assert first.data.get("periodo") == "04_26"
    assert first.data.get("hipervinculo") == "https://x"


def test_parse_resumen_handles_missing_sheet_gracefully() -> None:
    """Si no hay hoja 'Resumen' exacto, toma la primera disponible (fallback)."""
    wb = Workbook()
    ws = wb.active
    assert ws is not None
    ws.title = "OtroNombre"
    ws.append(["Fecha", "Empresa", "Periodo", "Egreso", "Año"])
    ws.append(["2026-04-15", "TRONGKAI", "04_26", 100, 2026])
    buf = io.BytesIO()
    wb.save(buf)
    raw_rows, _ = parse_resumen_sheet(buf.getvalue())
    assert len(raw_rows) == 1


# ---------------------------------------------------------------------------
# check_should_run (idempotencia por hash)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_should_run_returns_true_if_no_previous_run() -> None:
    db = MagicMock()
    db.scalar = AsyncMock(return_value=None)
    assert await check_should_run(db, "abc123") is True


@pytest.mark.asyncio
async def test_check_should_run_returns_false_when_hash_matches() -> None:
    db = MagicMock()
    db.scalar = AsyncMock(return_value="abc123")
    assert await check_should_run(db, "abc123") is False


@pytest.mark.asyncio
async def test_check_should_run_returns_true_when_hash_differs() -> None:
    db = MagicMock()
    db.scalar = AsyncMock(return_value="oldhash")
    assert await check_should_run(db, "newhash") is True
