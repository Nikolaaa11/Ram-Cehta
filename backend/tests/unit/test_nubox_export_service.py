"""Tests unitarios del nubox_export_service (sin DB)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.services.nubox_export_service import (
    NoVouchersToExportError,
    aggregate_batch_summary,
    generate_csv,
)


def _row(
    voucher_id: int = 1,
    voucher_codigo: str = "CSL-2026-EGR-00001",
    line_number: int = 1,
    debit: int = 100000,
    credit: int = 0,
    cuenta: str = "3-01-01-01",
    cuenta_nubox: str | None = None,
) -> dict:
    return {
        "voucher_id": voucher_id,
        "voucher_codigo": voucher_codigo,
        "voucher_tipo": "EGRESO",
        "fecha_contable": date(2026, 1, 15),
        "glosa": "Pago factura proveedor",
        "contraparte_rut": "76.123.456-7",
        "contraparte_nombre": "Proveedor Test SpA",
        "doc_tributario_tipo": "FACTURA",
        "doc_tributario_folio": "12345",
        "line_number": line_number,
        "cuenta_codigo": cuenta,
        "proyecto_codigo": "PRJ-CSL-COR-001",
        "area_codigo": "ING",
        "debit": Decimal(debit),
        "credit": Decimal(credit),
        "linea_descripcion": "Servicios consultoría",
        "cuenta_nombre": "Servicios Externos",
        "cuenta_nubox": cuenta_nubox or cuenta,
    }


def test_generate_csv_vacio_falla():
    with pytest.raises(NoVouchersToExportError):
        generate_csv([])


def test_generate_csv_header_correcto():
    out = generate_csv([_row()])
    lines = out.split("\r\n")
    # Header esperado (después del BOM)
    header = lines[0].lstrip("﻿").lstrip("ï»¿")
    assert "Fecha" in header
    assert "NumComprobante" in header
    assert "Cuenta" in header
    assert "Debe" in header
    assert "Haber" in header
    assert "CentroCosto" in header
    assert "Proyecto" in header


def test_generate_csv_separador_punto_coma():
    """Nubox / Excel chileno usa ; como separador estándar."""
    out = generate_csv([_row()])
    assert ";" in out
    # Detalle row
    data_line = out.split("\r\n")[1]
    parts = data_line.split(";")
    assert len(parts) == 16  # 16 columnas


def test_generate_csv_tipo_voucher_mapeado():
    """EGRESO debe mapearse a E para Nubox."""
    out = generate_csv([_row()])
    data_line = out.split("\r\n")[1]
    parts = data_line.split(";")
    # Index 2 = TipoComprobante
    assert parts[2] == "E"


def test_generate_csv_usa_nubox_code():
    """Si la cuenta tiene nubox_code distinto al código interno, se usa el de Nubox."""
    out = generate_csv([_row(cuenta="3-01-01-01", cuenta_nubox="NBX-001")])
    data_line = out.split("\r\n")[1]
    parts = data_line.split(";")
    # Index 5 = Cuenta (debe ser nubox_code)
    assert parts[5] == "NBX-001"


def test_generate_csv_montos_enteros():
    """CLP no tiene decimales — formatear como entero."""
    out = generate_csv([_row(debit=119000, credit=0)])
    data_line = out.split("\r\n")[1]
    parts = data_line.split(";")
    # Index 7 = Debe, Index 8 = Haber
    assert parts[7] == "119000"
    assert parts[8] == "0"


def test_generate_csv_glosa_punto_coma_escapado():
    """Si la glosa tiene ;, debe escaparse SIN alterar el texto.

    R152ZZZZZZ — test actualizado: desde R152FFFFFF el export usa
    csv.writer con QUOTE_MINIMAL (comillas dobles CSV estándar) en vez de
    reemplazar ';' por ',' — el replace destruía datos reales del asiento.
    Un split(';') ingenuo corta adentro de las comillas, así que la
    aserción correcta es parsear con csv.reader (como hace Excel y
    cualquier parser real) y verificar 16 columnas + glosa intacta.
    """
    import csv as _csv
    from io import StringIO as _StringIO

    rows = [_row()]
    rows[0]["glosa"] = "Pago; algo más; etc"
    out = generate_csv(rows)
    parsed = list(_csv.reader(_StringIO(out.lstrip("﻿")), delimiter=";"))
    header, data = parsed[0], parsed[1]
    # 16 columnas siempre, sin que la glosa rompa el parseo
    assert len(header) == 16
    assert len(data) == 16
    # y el texto de la glosa llega INTACTO al sistema contable oficial
    assert data[3] == "Pago; algo más; etc"


def test_generate_csv_nulls_se_renderizan_vacios():
    """Si proyecto_codigo o area_codigo son None, render como string vacío."""
    rows = [_row()]
    rows[0]["proyecto_codigo"] = None
    rows[0]["area_codigo"] = None
    rows[0]["contraparte_rut"] = None
    out = generate_csv(rows)
    data_line = out.split("\r\n")[1]
    parts = data_line.split(";")
    # CentroCosto, Proyecto, RutContraparte → strings vacíos
    assert parts[9] == ""  # CentroCosto
    assert parts[10] == ""  # Proyecto
    assert parts[11] == ""  # RutContraparte


# ---------------------------------------------------------------------
# aggregate_batch_summary
# ---------------------------------------------------------------------


def test_summary_voucher_count_unique():
    """Si hay 3 líneas del mismo voucher + 2 de otro → 2 vouchers únicos."""
    rows = [
        _row(voucher_id=1, line_number=1, debit=100, credit=0),
        _row(voucher_id=1, line_number=2, debit=0, credit=100),
        _row(voucher_id=1, line_number=3, debit=50, credit=50),
        _row(voucher_id=2, line_number=1, debit=200, credit=0),
        _row(voucher_id=2, line_number=2, debit=0, credit=200),
    ]
    summary = aggregate_batch_summary(rows)
    assert summary["voucher_count"] == 2
    assert sorted(summary["voucher_ids"]) == [1, 2]
    assert summary["line_count"] == 5


def test_summary_totales_correctos():
    rows = [
        _row(voucher_id=1, debit=100, credit=0),
        _row(voucher_id=1, debit=0, credit=100),
        _row(voucher_id=2, debit=200, credit=0),
        _row(voucher_id=2, debit=0, credit=200),
    ]
    summary = aggregate_batch_summary(rows)
    assert summary["total_debit"] == Decimal(300)
    assert summary["total_credit"] == Decimal(300)


def test_summary_vacio():
    summary = aggregate_batch_summary([])
    assert summary["voucher_count"] == 0
    assert summary["voucher_ids"] == []
    assert summary["total_debit"] == Decimal(0)
    assert summary["line_count"] == 0
