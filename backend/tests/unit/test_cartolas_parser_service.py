"""Tests para cartolas_parser_service — funciones puras testeables sin PDFs reales."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.services.cartolas_parser_service import (
    _parse_filas_genericas,
    _parse_fecha_full,
    _parse_monto,
    _extract_periodo,
    build_movimiento_natural_key,
    detect_banco,
    file_hash,
)


class TestDetectBanco:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("Banco Santander Chile S.A. Cartola", "santander"),
            ("BCI Empresas - Cartola Cuenta Corriente", "bci"),
            ("BancoEstado Banca Personas", "banco_estado"),
            ("Banco BICE | Cartola", "bice"),
            ("Banco Itaú Chile", "itau"),
            ("Scotiabank Chile - Cuenta", "scotiabank"),
            ("Banco Security", "security"),
            ("Foo Bar Cartola sin banco", "unknown"),
        ],
    )
    def test_detects_banco(self, text: str, expected: str) -> None:
        assert detect_banco(text) == expected

    def test_case_insensitive(self) -> None:
        assert detect_banco("BANCO SANTANDER CHILE") == "santander"
        assert detect_banco("banco santander chile") == "santander"


class TestParseFecha:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("31/12/2025", date(2025, 12, 31)),
            ("01/01/2026", date(2026, 1, 1)),
            ("31-12-2025", date(2025, 12, 31)),
            ("Movimiento del 15/06/2024 procesado", date(2024, 6, 15)),
        ],
    )
    def test_parses_chilean_format(self, text: str, expected: date) -> None:
        assert _parse_fecha_full(text) == expected

    def test_returns_none_when_no_match(self) -> None:
        assert _parse_fecha_full("texto sin fecha") is None
        assert _parse_fecha_full("") is None


class TestParseMonto:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("$1.234.567", Decimal("1234567")),
            ("1.234.567", Decimal("1234567")),
            ("$ 850.000", Decimal("850000")),
            ("1234567", Decimal("1234567")),
            ("-1.500.000", Decimal("-1500000")),
            ("1.500.000-", Decimal("-1500000")),
            ("$0", Decimal("0")),
        ],
    )
    def test_parses_clp_amount(self, text: str, expected: Decimal) -> None:
        assert _parse_monto(text) == expected

    def test_returns_zero_when_no_match(self) -> None:
        assert _parse_monto("sin monto") == Decimal("0")
        assert _parse_monto("") == Decimal("0")


class TestExtractPeriodo:
    def test_periodo_explicit(self) -> None:
        text = "Período: 01/12/2025 al 31/12/2025"
        desde, hasta = _extract_periodo(text)
        assert desde == date(2025, 12, 1)
        assert hasta == date(2025, 12, 31)

    def test_periodo_with_dash(self) -> None:
        text = "Movimientos 01/12/2025 - 31/12/2025"
        desde, hasta = _extract_periodo(text)
        assert desde == date(2025, 12, 1)
        assert hasta == date(2025, 12, 31)

    def test_periodo_inferred_from_first_last_date(self) -> None:
        text = """
        Movimiento 03/12/2025 abono $100.000
        Movimiento 15/12/2025 pago $50.000
        Movimiento 28/12/2025 transferencia $200.000
        """
        desde, hasta = _extract_periodo(text)
        assert desde == date(2025, 12, 3)
        assert hasta == date(2025, 12, 28)

    def test_no_dates_returns_none(self) -> None:
        desde, hasta = _extract_periodo("Texto sin fechas")
        assert desde is None
        assert hasta is None


class TestParseFilasGenericas:
    def test_simple_movement_line(self) -> None:
        text = "15/12/2025 TRANSFERENCIA RECIBIDA EMPRESA X 1.500.000 5.000.000"
        rows = _parse_filas_genericas(text)
        assert len(rows) == 1
        assert rows[0].fecha == date(2025, 12, 15)
        assert rows[0].abono == Decimal("1500000")
        assert rows[0].egreso == Decimal("0")
        assert rows[0].saldo == Decimal("5000000")
        assert "TRANSFERENCIA RECIBIDA" in rows[0].descripcion

    def test_egreso_line(self) -> None:
        text = "20/12/2025 PAGO PROVEEDOR ACME LTDA 850.000 4.150.000"
        rows = _parse_filas_genericas(text)
        assert len(rows) == 1
        assert rows[0].egreso == Decimal("850000")
        assert rows[0].abono == Decimal("0")

    def test_negative_amount_is_egreso(self) -> None:
        text = "10/12/2025 MOV CON SIGNO NEGATIVO -500.000 4.500.000"
        rows = _parse_filas_genericas(text)
        assert len(rows) == 1
        assert rows[0].egreso == Decimal("500000")

    def test_skips_lines_without_date(self) -> None:
        text = """
        Encabezado del banco
        Cuenta corriente: 12345678
        15/12/2025 TRANSFERENCIA $100.000 $1.000.000
        Pie de página
        """
        rows = _parse_filas_genericas(text)
        assert len(rows) == 1

    def test_multiple_rows(self) -> None:
        text = """
        01/12/2025 ABONO TRANSFERENCIA RECIBIDA 500.000 5.500.000
        15/12/2025 PAGO COMERCIAL XYZ 200.000 5.300.000
        20/12/2025 COMISION MENSUAL 5.000 5.295.000
        """
        rows = _parse_filas_genericas(text)
        assert len(rows) == 3
        assert rows[0].fecha == date(2025, 12, 1)
        assert rows[0].abono == Decimal("500000")
        assert rows[1].egreso == Decimal("200000")
        assert rows[2].egreso == Decimal("5000")

    def test_empty_text_returns_empty(self) -> None:
        assert _parse_filas_genericas("") == []
        assert _parse_filas_genericas("   ") == []


class TestFileHash:
    def test_same_content_same_hash(self) -> None:
        content = b"factura proveedor ACME"
        assert file_hash(content) == file_hash(content)

    def test_different_content_different_hash(self) -> None:
        assert file_hash(b"foo") != file_hash(b"bar")

    def test_returns_64_chars(self) -> None:
        assert len(file_hash(b"x")) == 64  # SHA-256 hex


class TestNaturalKey:
    def test_idempotent(self) -> None:
        key1 = build_movimiento_natural_key(
            empresa_codigo="TRONGKAI",
            fecha=date(2025, 12, 15),
            descripcion="PAGO PROVEEDOR",
            monto=Decimal("1500000"),
            banco="santander",
        )
        key2 = build_movimiento_natural_key(
            empresa_codigo="TRONGKAI",
            fecha=date(2025, 12, 15),
            descripcion="PAGO PROVEEDOR",
            monto=Decimal("1500000"),
            banco="santander",
        )
        assert key1 == key2

    def test_distinct_for_different_inputs(self) -> None:
        base = {
            "empresa_codigo": "TRONGKAI",
            "fecha": date(2025, 12, 15),
            "descripcion": "PAGO",
            "monto": Decimal("1000000"),
            "banco": "santander",
        }
        key_a = build_movimiento_natural_key(**base)
        # Cambiar empresa
        key_b = build_movimiento_natural_key(**{**base, "empresa_codigo": "REVTECH"})
        # Cambiar monto
        key_c = build_movimiento_natural_key(**{**base, "monto": Decimal("999999")})
        # Cambiar banco
        key_d = build_movimiento_natural_key(**{**base, "banco": "bci"})
        assert len({key_a, key_b, key_c, key_d}) == 4
