"""Unit tests para sii_csv_import (Round 118)."""
from __future__ import annotations

from datetime import date

from app.services.sii_csv_import import parse_csv_rcv


def test_parse_csv_compras_formato_sii_tipico():
    """CSV típico del SII: ';' delimiter, headers en español."""
    csv = (
        "Tipo Doc;Folio;Fecha Emision;RUT;Razon Social;Monto Neto;Monto IVA;Monto Total\n"
        "33;1001;15/04/2026;77.123.456-7;PROVEEDOR UNO SPA;100000;19000;119000\n"
        "39;2001;16/04/2026;76.987.654-3;OTRO PROVEEDOR;50000;0;50000\n"
    )
    docs, errors = parse_csv_rcv(
        csv.encode("utf-8"), flujo="compra", periodo_default="2026-04",
    )
    assert not errors, errors
    assert len(docs) == 2
    assert docs[0]["tipo_dte"] == 33
    assert docs[0]["folio"] == "1001"
    assert docs[0]["fecha_emision"] == date(2026, 4, 15)
    assert docs[0]["monto_total"] == 119000
    assert docs[0]["monto_iva"] == 19000
    assert docs[0]["rut_contraparte"] == "77.123.456-7"
    assert docs[0]["periodo"] == "2026-04"


def test_parse_csv_handles_cp1252_encoding():
    """SII suele exportar con cp1252 (Windows ANSI con tildes)."""
    csv = (
        "Tipo DTE;Folio;Fecha Emisión;RUT;Razón Social;Monto Neto;IVA;Total\n"
        "33;5;01/05/2026;1-9;ÑOQUI SPA;1000;190;1190\n"
    ).encode("cp1252")
    docs, errors = parse_csv_rcv(csv, flujo="compra", periodo_default="2026-05")
    assert not errors
    assert len(docs) == 1
    assert "Ñ" in docs[0]["razon_social_contraparte"] or "OQUI" in docs[0]["razon_social_contraparte"]


def test_parse_csv_tipo_dte_with_label():
    """SII a veces exporta '33 - Factura Electrónica' en vez de '33'."""
    csv = (
        "Tipo;Folio;RUT;Total\n"
        "33 - Factura Electronica;1001;77.000.000-1;119000\n"
    )
    docs, errors = parse_csv_rcv(
        csv.encode(), flujo="venta", periodo_default="2026-04",
    )
    assert not errors
    assert len(docs) == 1
    assert docs[0]["tipo_dte"] == 33


def test_parse_csv_with_comma_delimiter():
    """Algunos exports usan ',' en vez de ';'."""
    csv = (
        "Tipo DTE,Folio,RUT,Total\n"
        "39,1,77.000.000-1,5000\n"
    )
    docs, errors = parse_csv_rcv(
        csv.encode(), flujo="compra", periodo_default="2026-04",
    )
    assert not errors
    assert len(docs) == 1
    assert docs[0]["tipo_dte"] == 39


def test_parse_csv_skips_empty_rows():
    csv = (
        "Tipo DTE;Folio;RUT;Total\n"
        "33;1;77.000.000-1;100\n"
        ";;;\n"
        "\n"
        "33;2;77.000.000-2;200\n"
    )
    docs, errors = parse_csv_rcv(
        csv.encode(), flujo="venta", periodo_default="2026-04",
    )
    assert len(docs) == 2


def test_parse_csv_missing_required_columns():
    csv = "Foo;Bar;Baz\nx;y;z\n"
    docs, errors = parse_csv_rcv(
        csv.encode(), flujo="compra", periodo_default="2026-04",
    )
    assert docs == []
    assert errors and "tipo_dte" in errors[0]


def test_parse_csv_montos_con_puntos_de_miles():
    """SII formatea '1.234.567' como string."""
    csv = (
        "Tipo;Folio;RUT;Monto Neto;Monto IVA;Monto Total\n"
        "33;1;1-1;1.000.000;190.000;1.190.000\n"
    )
    docs, errors = parse_csv_rcv(
        csv.encode(), flujo="compra", periodo_default="2026-04",
    )
    assert not errors
    assert docs[0]["monto_neto"] == 1_000_000
    assert docs[0]["monto_total"] == 1_190_000


def test_parse_csv_empty():
    docs, errors = parse_csv_rcv(b"", flujo="compra", periodo_default="2026-04")
    assert docs == []
    assert errors
