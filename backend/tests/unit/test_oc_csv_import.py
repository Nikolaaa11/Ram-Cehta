"""V5++ ola AA — Tests unitarios del parser CSV de Órdenes de Compra.

Cubre:
  - Headers con aliases español
  - Agrupación por (empresa_codigo, numero_oc) — dos OCs con mismo
    numero pero distinta empresa son OCs separadas
  - Cálculo del neto = Σ(precio_unitario * cantidad)
  - Validaciones: moneda, proveedor_id, validez_dias, item, descripcion
  - Errores Pydantic: precio_unitario > 0, cantidad > 0
  - to_dict() serializable
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.oc_csv_import_service import parse_csv_to_ocs


CSV_OK = b"""numero_oc;empresa_codigo;fecha_emision;moneda;item;descripcion;precio_unitario;cantidad
OC-001;FONDO;2025-01-15;CLP;1;Insumos oficina;5000;10
OC-001;FONDO;2025-01-15;CLP;2;Cartulinas;1500;20
OC-001;FONDO;2025-01-15;CLP;3;Cuadernos;3000;5
"""


def test_parse_oc_csv_happy_path() -> None:
    ocs, report = parse_csv_to_ocs(CSV_OK)
    assert len(report.errors) == 0, report.errors
    assert report.total_rows == 3
    assert report.total_ocs_intended == 1
    assert len(ocs) == 1

    oc = ocs[0]
    assert oc.numero_oc == "OC-001"
    assert oc.empresa_codigo == "FONDO"
    assert oc.moneda == "CLP"
    assert len(oc.items) == 3
    # neto = 5000*10 + 1500*20 + 3000*5 = 50000 + 30000 + 15000 = 95000
    assert oc.neto == Decimal("95000")


def test_parse_oc_csv_empty() -> None:
    ocs, report = parse_csv_to_ocs(b"")
    assert ocs == []
    assert any("vacío" in e.message.lower() for e in report.errors)


def test_parse_oc_csv_missing_required_column() -> None:
    bad = b"numero_oc;empresa_codigo\nOC-001;FONDO\n"
    _, report = parse_csv_to_ocs(bad)
    assert any("obligatorias faltantes" in e.message for e in report.errors)


def test_parse_oc_csv_groups_por_empresa_y_numero() -> None:
    """Mismo numero_oc en empresas distintas → 2 OCs separadas."""
    raw = b"""numero_oc;empresa_codigo;fecha_emision;item;descripcion;precio_unitario;cantidad
OC-001;FONDO;2025-01-15;1;Item A;5000;10
OC-001;FONDO;2025-01-15;2;Item B;1000;5
OC-001;GP;2025-02-10;1;Item C;3000;3
OC-001;GP;2025-02-10;2;Item D;2000;7
"""
    ocs, report = parse_csv_to_ocs(raw)
    assert len(ocs) == 2, [e.message for e in report.errors]
    assert report.total_ocs_intended == 2
    empresas = {oc.empresa_codigo for oc in ocs}
    assert empresas == {"FONDO", "GP"}


def test_parse_oc_csv_aliases_espanol() -> None:
    raw = b"""numero;empresa;fecha;linea;detalle;precio;cantidad
OC-001;FONDO;15-01-2025;1;Producto A;5000;10
OC-001;FONDO;15-01-2025;2;Producto B;1500;20
"""
    ocs, report = parse_csv_to_ocs(raw)
    assert len(ocs) == 1, [e.message for e in report.errors]
    assert ocs[0].items[0].descripcion == "Producto A"


def test_parse_oc_csv_numero_oc_vacio_skip() -> None:
    raw = b"""numero_oc;empresa_codigo;fecha_emision;item;descripcion;precio_unitario;cantidad
;FONDO;2025-01-15;1;Sin numero;5000;10
OC-002;FONDO;2025-01-15;1;Con numero;5000;10
OC-002;FONDO;2025-01-15;2;Con numero;1000;5
"""
    ocs, report = parse_csv_to_ocs(raw)
    assert len(ocs) == 1
    assert any(
        e.field == "numero_oc" and "vacío" in e.message for e in report.errors
    )


def test_parse_oc_csv_moneda_invalida() -> None:
    raw = b"""numero_oc;empresa_codigo;fecha_emision;moneda;item;descripcion;precio_unitario;cantidad
OC-001;FONDO;2025-01-15;ARS;1;Item;5000;10
"""
    ocs, report = parse_csv_to_ocs(raw)
    assert len(ocs) == 0
    assert any("moneda" in (e.field or "") for e in report.errors)


def test_parse_oc_csv_proveedor_id_invalido() -> None:
    raw = b"""numero_oc;empresa_codigo;fecha_emision;proveedor_id;item;descripcion;precio_unitario;cantidad
OC-001;FONDO;2025-01-15;abc;1;Item;5000;10
"""
    _, report = parse_csv_to_ocs(raw)
    assert any("proveedor_id" in (e.field or "") for e in report.errors)


def test_parse_oc_csv_validez_invalido() -> None:
    raw = b"""numero_oc;empresa_codigo;fecha_emision;validez_dias;item;descripcion;precio_unitario;cantidad
OC-001;FONDO;2025-01-15;abc;1;Item;5000;10
"""
    _, report = parse_csv_to_ocs(raw)
    assert any("validez_dias" in (e.field or "") for e in report.errors)


def test_parse_oc_csv_descripcion_vacia() -> None:
    raw = b"""numero_oc;empresa_codigo;fecha_emision;item;descripcion;precio_unitario;cantidad
OC-001;FONDO;2025-01-15;1;;5000;10
"""
    _, report = parse_csv_to_ocs(raw)
    assert any(e.field == "descripcion" for e in report.errors)


def test_parse_oc_csv_precio_negativo_rechazado() -> None:
    """Pydantic OCDetalleCreate rechaza precio_unitario <= 0."""
    raw = b"""numero_oc;empresa_codigo;fecha_emision;item;descripcion;precio_unitario;cantidad
OC-001;FONDO;2025-01-15;1;Item bad;0;10
"""
    ocs, report = parse_csv_to_ocs(raw)
    assert len(ocs) == 0
    assert len(report.errors) > 0


def test_parse_oc_csv_decimal_europeo() -> None:
    """Decimales con `,` deben parsear OK."""
    raw = b"""numero_oc;empresa_codigo;fecha_emision;item;descripcion;precio_unitario;cantidad
OC-001;FONDO;2025-01-15;1;Item;1000,50;2
OC-001;FONDO;2025-01-15;2;Item dos;500,25;4
"""
    ocs, report = parse_csv_to_ocs(raw)
    assert len(ocs) == 1, [e.message for e in report.errors]
    # neto = 1000.50*2 + 500.25*4 = 2001 + 2001 = 4002
    assert ocs[0].neto == Decimal("4002.00")


def test_parse_oc_csv_neto_calculado_correctamente() -> None:
    """El neto se calcula como Σ precio*cantidad."""
    raw = b"""numero_oc;empresa_codigo;fecha_emision;item;descripcion;precio_unitario;cantidad
OC-002;FONDO;2025-01-15;1;A;100;3
OC-002;FONDO;2025-01-15;2;B;50;4
OC-002;FONDO;2025-01-15;3;C;200;1
"""
    ocs, report = parse_csv_to_ocs(raw)
    assert len(ocs) == 1, [e.message for e in report.errors]
    # 100*3 + 50*4 + 200*1 = 300 + 200 + 200 = 700
    assert ocs[0].neto == Decimal("700")


def test_parse_oc_csv_with_bom() -> None:
    raw = b"\xef\xbb\xbf" + CSV_OK
    ocs, report = parse_csv_to_ocs(raw)
    assert len(ocs) == 1
    assert len(report.errors) == 0


def test_parse_oc_csv_separator_comma() -> None:
    raw = b"""numero_oc,empresa_codigo,fecha_emision,item,descripcion,precio_unitario,cantidad
OC-001,FONDO,2025-01-15,1,Item A,5000,10
OC-001,FONDO,2025-01-15,2,Item B,1000,5
"""
    ocs, report = parse_csv_to_ocs(raw)
    assert len(ocs) == 1, [e.message for e in report.errors]


def test_parse_oc_csv_proveedor_id_opcional() -> None:
    """proveedor_id es opcional — se parsea como int si está, None si vacío."""
    raw = b"""numero_oc;empresa_codigo;fecha_emision;proveedor_id;item;descripcion;precio_unitario;cantidad
OC-001;FONDO;2025-01-15;42;1;Item;5000;10
"""
    ocs, report = parse_csv_to_ocs(raw)
    assert len(ocs) == 1, [e.message for e in report.errors]
    assert ocs[0].proveedor_id == 42


def test_report_to_dict_serializable() -> None:
    ocs, report = parse_csv_to_ocs(CSV_OK)
    d = report.to_dict()
    assert d["total_ocs_intended"] == 1
    assert d["ocs_created_count"] == 0  # nada insertado todavía
    assert d["errors_count"] == 0
    assert isinstance(d["errors"], list)
