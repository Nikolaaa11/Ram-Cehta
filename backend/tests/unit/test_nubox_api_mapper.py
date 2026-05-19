"""Unit tests para nubox_api_mapper (Round 124)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.services.nubox_api_mapper import (
    DOC_TRIBUTARIO_TO_DTE,
    NuboxMapperError,
    parse_nubox_emit_response,
    voucher_to_nubox_payload,
)


def _factura_compra_basica():
    voucher = {
        "empresa_codigo": "REVTECH",
        "tipo": "VENTA",
        "doc_tributario_tipo": "FACTURA",
        "doc_tributario_folio": None,
        "fecha_documento": date(2026, 5, 15),
        "fecha_contable": date(2026, 5, 15),
        "glosa": "Servicios prestados a cliente X",
        "moneda": "CLP",
        "contraparte_rut": "77.123.456-7",
        "contraparte_nombre": "CLIENTE SPA",
    }
    lines = [
        {
            "line_number": 1, "cuenta_codigo": "4-1-1-1",
            "descripcion": "Servicio consultoría",
            "debit": Decimal("0"), "credit": Decimal("1000000"),
            "iva_tratamiento": "AFECTO",
        },
        {
            "line_number": 2, "cuenta_codigo": "1-1-2-1",
            "descripcion": "IVA débito",
            "debit": Decimal("190000"), "credit": Decimal("0"),
            "iva_tratamiento": None,
        },
    ]
    return voucher, lines


def test_mapper_factura_afecta_basica():
    voucher, lines = _factura_compra_basica()
    payload = voucher_to_nubox_payload(voucher, lines, sequence=1)

    assert payload["sequence"] == 1
    assert payload["type"]["legalCode"] == "33"  # Factura
    assert payload["client"]["identification"]["value"] == "77.123.456-7"
    assert payload["client"]["identification"]["type"] == 1
    assert payload["client"]["tradeName"] == "CLIENTE SPA"
    assert payload["saleType"]["id"] == 1
    assert payload["paymentForm"]["id"] == 1
    assert len(payload["details"]) >= 1
    # El IVA se agrega como tax al primer detail
    iva_taxes = payload["details"][0].get("taxes", [])
    assert any(t.get("legalCode") == "14" for t in iva_taxes)


def test_mapper_boleta_electronica():
    voucher, lines = _factura_compra_basica()
    voucher["doc_tributario_tipo"] = "BOLETA"
    payload = voucher_to_nubox_payload(voucher, lines)
    assert payload["type"]["legalCode"] == "39"


def test_mapper_nota_credito_requiere_referencia():
    voucher, lines = _factura_compra_basica()
    voucher["doc_tributario_tipo"] = "NOTA_CREDITO"
    voucher["doc_tributario_folio"] = "1234"  # Referencia
    payload = voucher_to_nubox_payload(voucher, lines)
    assert payload["type"]["legalCode"] == "61"
    assert "references" in payload
    assert payload["references"][0]["documentNumber"] == "1234"


def test_mapper_rechaza_tipo_no_soportado():
    voucher, lines = _factura_compra_basica()
    voucher["doc_tributario_tipo"] = "HONORARIOS"  # no soportado por Nubox API
    with pytest.raises(NuboxMapperError, match="no es emitible"):
        voucher_to_nubox_payload(voucher, lines)


def test_mapper_rechaza_sin_rut():
    voucher, lines = _factura_compra_basica()
    voucher["contraparte_rut"] = None
    with pytest.raises(NuboxMapperError, match="contraparte_rut"):
        voucher_to_nubox_payload(voucher, lines)


def test_mapper_rechaza_sin_doc_tributario_tipo():
    voucher, lines = _factura_compra_basica()
    voucher["doc_tributario_tipo"] = None
    with pytest.raises(NuboxMapperError, match="doc_tributario_tipo"):
        voucher_to_nubox_payload(voucher, lines)


def test_mapper_rechaza_lineas_vacias():
    voucher, _ = _factura_compra_basica()
    lines = [
        {
            "line_number": 1, "cuenta_codigo": "X",
            "descripcion": "vacía", "debit": 0, "credit": 0,
        },
    ]
    with pytest.raises(NuboxMapperError, match="Ninguna línea"):
        voucher_to_nubox_payload(voucher, lines)


def test_parse_emit_response_separa_ok_y_errores():
    body = [
        {"id": 100, "sequence": 1, "errors": None},
        {"id": 101, "sequence": 2, "errors": [{"field": "x", "message": "y"}]},
        {"id": 102, "sequence": 3, "errors": None},
    ]
    successful, failed = parse_nubox_emit_response(body)
    assert len(successful) == 2
    assert len(failed) == 1
    assert successful[0]["id"] == 100
    assert failed[0]["id"] == 101


def test_doc_tributario_mapping_completo():
    """Asegura que los 4 tipos comunes mappean correcto."""
    assert DOC_TRIBUTARIO_TO_DTE["FACTURA"] == "33"
    assert DOC_TRIBUTARIO_TO_DTE["BOLETA"] == "39"
    assert DOC_TRIBUTARIO_TO_DTE["NOTA_CREDITO"] == "61"
    assert DOC_TRIBUTARIO_TO_DTE["NOTA_DEBITO"] == "56"


def test_mapper_truncates_glosa_long_descriptions():
    voucher, lines = _factura_compra_basica()
    voucher["contraparte_nombre"] = "X" * 200  # max 100 en Nubox
    voucher["glosa"] = "Y" * 1000  # max 500
    payload = voucher_to_nubox_payload(voucher, lines)
    assert len(payload["client"]["tradeName"]) <= 100
    assert len(payload["comment"]) <= 500
