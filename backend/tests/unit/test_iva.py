from __future__ import annotations

from decimal import Decimal

import pytest

from app.domain.value_objects.iva import IVA_RATE, calcular_iva, calcular_total_con_iva


def test_iva_rate_is_chilean_standard() -> None:
    assert IVA_RATE == Decimal("0.19")


@pytest.mark.parametrize(
    ("neto", "esperado_iva", "esperado_total"),
    [
        (Decimal("100000"), Decimal("19000"), Decimal("119000")),
        (Decimal("1000000"), Decimal("190000"), Decimal("1190000")),
        (Decimal("1500000"), Decimal("285000"), Decimal("1785000")),
    ],
)
def test_calcular_iva_y_total(neto: Decimal, esperado_iva: Decimal, esperado_total: Decimal) -> None:
    assert calcular_iva(neto) == esperado_iva
    assert calcular_total_con_iva(neto) == esperado_total


def test_rounding_clp() -> None:
    # 123.45 * 0.19 = 23.4555 -> 23 con ROUND_HALF_UP (0.4555 < 0.5)
    assert calcular_iva(Decimal("123.45")) == Decimal("23")
