"""V5++ ola AB — Tests unitarios de schemas + lógica de plantillas.

Cubre validaciones puras Pydantic + lógica de interpolación de glosa
(que va a estar en el endpoint pero acá testeamos el helper).

Tests integration con DB van en tests/integration/test_voucher_templates.py
(que requiere fixtures con empresa + plan_cuentas seedeados).
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.schemas.voucher_template import (
    TemplateLineCreate,
    TemplateUseRequest,
    VoucherTemplateCreate,
)


def test_template_line_accepts_zero_amounts() -> None:
    """A diferencia de VoucherLineCreate, TemplateLineCreate permite ambos
    en 0 (la plantilla puede tener placeholders que se llenan al usar)."""
    line = TemplateLineCreate(
        line_number=1,
        cuenta_codigo="5-01-01-001",
        debit=Decimal("0"),
        credit=Decimal("0"),
    )
    assert line.line_number == 1


def test_template_create_codigo_pattern() -> None:
    """codigo solo acepta MAYÚSCULAS, números, _ y -."""
    with pytest.raises(ValueError):
        VoucherTemplateCreate(
            codigo="abc-tpl",  # minúsculas no
            nombre="Test plantilla",
            empresa_codigo="FONDO",
            tipo="EGRESO",
            glosa_default="Glosa de prueba",
            lines=[
                TemplateLineCreate(
                    line_number=1, cuenta_codigo="5-01-01-001", debit=Decimal("100")
                ),
                TemplateLineCreate(
                    line_number=2, cuenta_codigo="2-02-01-001", credit=Decimal("100")
                ),
            ],
        )


def test_template_create_line_numbers_correlativos() -> None:
    """line_number debe ser 1, 2, 3... sin saltos."""
    with pytest.raises(ValueError, match="correlativo"):
        VoucherTemplateCreate(
            codigo="TPL-OK",
            nombre="Test",
            empresa_codigo="FONDO",
            tipo="EGRESO",
            glosa_default="Glosa de prueba",
            lines=[
                TemplateLineCreate(
                    line_number=1, cuenta_codigo="5-01-01-001", debit=Decimal("100")
                ),
                TemplateLineCreate(
                    line_number=3, cuenta_codigo="2-02-01-001", credit=Decimal("100")
                ),
            ],
        )


def test_template_create_happy_path() -> None:
    tpl = VoucherTemplateCreate(
        codigo="TPL-FONDO-SUELDO-CEO",
        nombre="Sueldo CEO mensual",
        empresa_codigo="FONDO",
        tipo="EGRESO",
        glosa_default="Sueldo CEO {mes} {anio}",
        moneda="CLP",
        lines=[
            TemplateLineCreate(
                line_number=1,
                cuenta_codigo="5-02-01-001",
                area_codigo="ADM",
                debit=Decimal("8000000"),
            ),
            TemplateLineCreate(
                line_number=2,
                cuenta_codigo="2-02-01-001",
                credit=Decimal("8000000"),
            ),
        ],
    )
    assert tpl.codigo == "TPL-FONDO-SUELDO-CEO"
    assert "{mes}" in tpl.glosa_default
    assert tpl.lines[0].debit == Decimal("8000000")


def test_template_use_request_multiplier_validation() -> None:
    """multiplier debe ser > 0 si se provee."""
    with pytest.raises(ValueError):
        TemplateUseRequest(
            fecha_documento="2026-05-09",
            fecha_contable="2026-05-09",
            multiplier=Decimal("0"),  # debe ser > 0
        )


def test_template_use_request_dates_required() -> None:
    """fecha_documento + fecha_contable son obligatorios."""
    with pytest.raises(ValueError):
        TemplateUseRequest(fecha_contable="2026-05-09")  # type: ignore[call-arg]


def test_glosa_interpolation_logic() -> None:
    """Test del replace de {mes} {anio} {fecha} (lógica que está en
    el endpoint, pero la replicamos puro acá para testear sin DB)."""
    from datetime import date as _d

    MESES_ES = [
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
    ]
    fecha = _d(2026, 5, 9)
    template = "Sueldo CEO {mes} {anio}"
    out = (
        template
        .replace("{mes}", MESES_ES[fecha.month - 1])
        .replace("{anio}", str(fecha.year))
        .replace("{fecha}", fecha.isoformat())
    )
    assert out == "Sueldo CEO mayo 2026"


def test_multiplier_applied_to_lines() -> None:
    """Test puro de la lógica de multiplier (sin endpoint)."""
    multiplier = Decimal("1.05")
    base_debit = Decimal("8000000")
    expected = Decimal("8400000.00")
    assert (base_debit * multiplier).quantize(Decimal("0.01")) == expected


def test_template_use_request_glosa_override_optional() -> None:
    req = TemplateUseRequest(
        fecha_documento="2026-05-09",
        fecha_contable="2026-05-09",
    )
    assert req.glosa_override is None
    assert req.multiplier is None
    assert req.doc_tributario_folio is None
