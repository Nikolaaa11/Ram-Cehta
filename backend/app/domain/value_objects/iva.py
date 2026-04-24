from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

# IVA chileno. Fuente de verdad única — cambiar aquí y nada más.
IVA_RATE: Decimal = Decimal("0.19")


def _round_clp(value: Decimal) -> Decimal:
    return value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def calcular_iva(neto: Decimal) -> Decimal:
    """IVA sobre el monto neto, redondeado a peso chileno."""
    return _round_clp(neto * IVA_RATE)


def calcular_total_con_iva(neto: Decimal) -> Decimal:
    """Neto + IVA, redondeado a peso chileno."""
    return _round_clp(neto + calcular_iva(neto))
