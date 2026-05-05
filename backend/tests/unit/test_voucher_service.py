"""Tests unitarios de la lógica pura de vouchers (sin DB).

Cubre:
  - validate_imputacion_triple
  - validate_corfo_eligibility
  - calculate_threshold_aplicado
  - calculate_iva_split
  - VoucherCreate Pydantic validators (partida doble + COMPRA/VENTA + REVERSO)
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.schemas.voucher import VoucherCreate, VoucherLineCreate
from app.services.voucher_service import (
    calculate_iva_split,
    calculate_threshold_aplicado,
    validate_corfo_eligibility,
    validate_imputacion_triple,
)


# ---------------------------------------------------------------------
# validate_imputacion_triple
# ---------------------------------------------------------------------


def test_imputacion_triple_completa_ok():
    errors = validate_imputacion_triple(
        line_number=1,
        cuenta_codigo="3-01-01-01",
        proyecto_codigo="PRJ-CSL-COR-001",
        area_codigo="ING",
        es_balance_puro=False,
    )
    assert errors == []


def test_imputacion_triple_balance_puro_acepta_proyecto_area_null():
    """Cuenta de balance puro (banco, IVA, retenciones) puede tener proyecto/area NULL."""
    errors = validate_imputacion_triple(
        line_number=2,
        cuenta_codigo="1-01-01-04",  # Banco BCI
        proyecto_codigo=None,
        area_codigo=None,
        es_balance_puro=True,
    )
    assert errors == []


def test_imputacion_triple_gasto_sin_proyecto_falla():
    errors = validate_imputacion_triple(
        line_number=3,
        cuenta_codigo="3-01-01-01",
        proyecto_codigo=None,
        area_codigo="ING",
        es_balance_puro=False,
    )
    assert len(errors) == 1
    assert errors[0].field == "proyecto_codigo"


def test_imputacion_triple_gasto_sin_area_falla():
    errors = validate_imputacion_triple(
        line_number=4,
        cuenta_codigo="3-01-01-01",
        proyecto_codigo="PRJ-CSL-COR-001",
        area_codigo=None,
        es_balance_puro=False,
    )
    assert len(errors) == 1
    assert errors[0].field == "area_codigo"


# ---------------------------------------------------------------------
# validate_corfo_eligibility
# ---------------------------------------------------------------------


def test_corfo_no_corfo_proyecto_acepta_cualquier_cuenta():
    err = validate_corfo_eligibility(
        cuenta_corfo_elegible=False,
        cuenta_tipo_gasto_corfo=None,
        proyecto_es_corfo=False,
        proyecto_eligible_types=[],
    )
    assert err is None


def test_corfo_proyecto_corfo_cuenta_no_elegible_falla():
    err = validate_corfo_eligibility(
        cuenta_corfo_elegible=False,
        cuenta_tipo_gasto_corfo=None,
        proyecto_es_corfo=True,
        proyecto_eligible_types=["RRHH", "OPERACION"],
    )
    assert err is not None
    assert "no está marcada como CORFO-elegible" in err


def test_corfo_proyecto_corfo_tipo_gasto_no_aceptado_falla():
    err = validate_corfo_eligibility(
        cuenta_corfo_elegible=True,
        cuenta_tipo_gasto_corfo="INVERSION",
        proyecto_es_corfo=True,
        proyecto_eligible_types=["RRHH", "OPERACION"],
    )
    assert err is not None
    assert "INVERSION" in err
    assert "RRHH" in err  # menciona los aceptados


def test_corfo_match_completo_ok():
    err = validate_corfo_eligibility(
        cuenta_corfo_elegible=True,
        cuenta_tipo_gasto_corfo="RRHH",
        proyecto_es_corfo=True,
        proyecto_eligible_types=["RRHH", "OPERACION", "INVERSION", "GASTOS_GENERALES"],
    )
    assert err is None


# ---------------------------------------------------------------------
# calculate_threshold_aplicado
# ---------------------------------------------------------------------


def test_threshold_gasto_bajo_no_aplica():
    assert calculate_threshold_aplicado(
        total_amount=Decimal("4999999"),
        es_activacion=False,
    ) is False


def test_threshold_gasto_exacto_aplica():
    assert calculate_threshold_aplicado(
        total_amount=Decimal("5000000"),
        es_activacion=False,
    ) is True


def test_threshold_activo_fijo_alto_aplica():
    """Caso reparaciones $100M+ del prompt."""
    assert calculate_threshold_aplicado(
        total_amount=Decimal("100000000"),
        es_activacion=True,
    ) is True


def test_threshold_activo_fijo_15M_no_aplica():
    """$15M activo fijo está bajo el umbral de 20M, NO aplica reforzado.
    El gasto-equivalente de 15M sí aplicaría (umbral 5M), por eso es importante
    que el caller pase es_activacion correcto.
    """
    assert calculate_threshold_aplicado(
        total_amount=Decimal("15000000"),
        es_activacion=True,
    ) is False


# ---------------------------------------------------------------------
# calculate_iva_split
# ---------------------------------------------------------------------


def test_iva_afecto_119000_split_correcto():
    neto, iva = calculate_iva_split(
        monto_bruto=Decimal("119000"),
        iva_tratamiento="AFECTO",
    )
    assert neto == Decimal("100000.00")
    assert iva == Decimal("19000.00")


def test_iva_exento_no_genera_iva():
    neto, iva = calculate_iva_split(
        monto_bruto=Decimal("100000"),
        iva_tratamiento="EXENTO",
    )
    assert neto == Decimal("100000")
    assert iva == Decimal("0")


def test_iva_no_gravado_no_genera_iva():
    neto, iva = calculate_iva_split(
        monto_bruto=Decimal("50000"),
        iva_tratamiento="NO_GRAVADO",
    )
    assert iva == Decimal("0")
    assert neto == Decimal("50000")


# ---------------------------------------------------------------------
# Pydantic validators de VoucherCreate
# ---------------------------------------------------------------------


def _line(n: int, debit: int = 0, credit: int = 0) -> VoucherLineCreate:
    return VoucherLineCreate(
        line_number=n,
        cuenta_codigo=f"3-01-{n:02d}-01",
        proyecto_codigo="PRJ-CSL-COR-001",
        area_codigo="ING",
        debit=Decimal(debit),
        credit=Decimal(credit),
    )


def _base_voucher(**overrides) -> dict:
    return {
        "empresa_codigo": "CSL",
        "tipo": "EGRESO",
        "fecha_documento": date(2026, 1, 15),
        "fecha_contable": date(2026, 1, 15),
        "glosa": "Pago factura proveedor de prueba",
        "lines": [
            _line(1, debit=100000),
            _line(2, credit=100000),
        ],
        **overrides,
    }


def test_voucher_create_partida_doble_ok():
    """100k debe / 100k haber → cuadra."""
    v = VoucherCreate(**_base_voucher(status="PENDING"))
    assert sum(line.debit for line in v.lines) == sum(
        line.credit for line in v.lines
    )


def test_voucher_create_descuadrado_pending_falla():
    """100k debe / 50k haber → descuadrado, no puede pasar de DRAFT."""
    with pytest.raises(ValidationError) as exc_info:
        VoucherCreate(**_base_voucher(
            status="PENDING",
            lines=[_line(1, debit=100000), _line(2, credit=50000)],
        ))
    assert "descuadrada" in str(exc_info.value).lower()


def test_voucher_create_descuadrado_draft_ok():
    """En DRAFT permite descuadre temporal."""
    v = VoucherCreate(**_base_voucher(
        status="DRAFT",
        lines=[_line(1, debit=100000), _line(2, credit=50000)],
    ))
    assert v.status == "DRAFT"


def test_voucher_create_line_number_no_correlativo_falla():
    """Líneas con line_number 1 y 3 (saltea 2) falla."""
    with pytest.raises(ValidationError) as exc_info:
        VoucherCreate(**_base_voucher(
            lines=[_line(1, debit=100000), _line(3, credit=100000)],
        ))
    assert "correlativo" in str(exc_info.value).lower()


def test_voucher_create_compra_sin_doc_tributario_falla():
    """COMPRA exige doc tributario."""
    with pytest.raises(ValidationError) as exc_info:
        VoucherCreate(**_base_voucher(tipo="COMPRA"))
    assert "doc_tributario" in str(exc_info.value).lower()


def test_voucher_create_compra_con_factura_ok():
    v = VoucherCreate(**_base_voucher(
        tipo="COMPRA",
        doc_tributario_tipo="FACTURA",
        doc_tributario_folio="12345",
    ))
    assert v.tipo == "COMPRA"
    assert v.doc_tributario_folio == "12345"


def test_voucher_create_reverso_sin_reversal_of_falla():
    """REVERSO exige apuntar al voucher original."""
    with pytest.raises(ValidationError) as exc_info:
        VoucherCreate(**_base_voucher(tipo="REVERSO"))
    assert "reversal_of" in str(exc_info.value).lower()


def test_voucher_create_reverso_con_referencia_ok():
    v = VoucherCreate(**_base_voucher(
        tipo="REVERSO",
        reversal_of=42,
    ))
    assert v.reversal_of == 42


def test_voucher_line_debit_y_credit_simultaneo_falla():
    with pytest.raises(ValidationError):
        VoucherLineCreate(
            line_number=1,
            cuenta_codigo="3-01-01-01",
            debit=Decimal("100"),
            credit=Decimal("100"),
        )


def test_voucher_line_ambos_cero_falla():
    with pytest.raises(ValidationError):
        VoucherLineCreate(
            line_number=1,
            cuenta_codigo="3-01-01-01",
            debit=Decimal("0"),
            credit=Decimal("0"),
        )


def test_voucher_line_solo_debit_ok():
    line = VoucherLineCreate(
        line_number=1,
        cuenta_codigo="3-01-01-01",
        debit=Decimal("100"),
        credit=Decimal("0"),
    )
    assert line.debit > 0


def test_voucher_glosa_corta_falla():
    """Glosa < 5 chars rechazada."""
    with pytest.raises(ValidationError):
        VoucherCreate(**_base_voucher(glosa="ok"))
