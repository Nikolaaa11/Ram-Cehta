from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

# IVA chileno. Fuente de verdad única — cambiar aquí y nada más.
IVA_RATE: Decimal = Decimal("0.19")


def _round_clp(value: Decimal) -> Decimal:
    return value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def calcular_iva(neto: Decimal, rate: Decimal = IVA_RATE) -> Decimal:
    """IVA sobre el monto neto, redondeado a peso chileno.

    `rate` es la tasa (0.19, no 19) — permite OC con % distinto al 19%
    estándar (boletas, exentos, casos especiales pactados con el proveedor).
    """
    return _round_clp(neto * rate)


def calcular_total_con_iva(neto: Decimal, rate: Decimal = IVA_RATE) -> Decimal:
    """Neto + IVA, redondeado a peso chileno."""
    return _round_clp(neto + calcular_iva(neto, rate))


def porcentaje_a_tasa(iva_porcentaje: Decimal) -> Decimal:
    """Convierte un porcentaje editable por el operador (19, 0, 12.5) a
    la tasa que espera `calcular_iva` (0.19, 0, 0.125)."""
    return iva_porcentaje / Decimal("100")
