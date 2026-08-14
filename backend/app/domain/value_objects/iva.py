from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

# IVA chileno. Fuente de verdad única — cambiar aquí y nada más.
IVA_RATE: Decimal = Decimal("0.19")


# Unidad mínima de redondeo por moneda. El peso chileno no tiene centavos;
# la UF y el dólar sí, y ahí los decimales son plata de verdad: una OC de
# 123,45 UF al 19% da 23,4555 UF de IVA, y redondear eso a 23 UF pierde casi
# media UF (~$17.000). Las columnas de la BD son NUMERIC(18,2), así que dos
# decimales es exactamente lo que se puede guardar.
PASO_CLP: Decimal = Decimal("1")
PASO_DECIMAL: Decimal = Decimal("0.01")


def paso_de_moneda(moneda: str | None) -> Decimal:
    """Unidad mínima de la moneda. Gemelo de `_paso_redondeo` en oc_cuotas y
    en asiento_desde_oc — las tres tienen que decir lo mismo o el asiento de
    un hito deja de calzar con el monto del hito."""
    return PASO_CLP if (moneda or "CLP").upper() == "CLP" else PASO_DECIMAL


def _round_clp(value: Decimal) -> Decimal:
    return value.quantize(PASO_CLP, rounding=ROUND_HALF_UP)


def calcular_iva(
    neto: Decimal, rate: Decimal = IVA_RATE, paso: Decimal = PASO_CLP
) -> Decimal:
    """IVA sobre el monto neto, redondeado a la unidad mínima de la moneda.

    `rate` es la tasa (0.19, no 19) — permite OC con % distinto al 19%
    estándar (boletas, exentos, casos especiales pactados con el proveedor).

    `paso` por defecto es 1 (peso chileno) para no cambiar el resultado de
    ningún llamador viejo. Quien trabaje en UF o USD tiene que pasar
    `paso_de_moneda(moneda)`, o el IVA sale redondeado a la unidad entera.
    """
    return (neto * rate).quantize(paso, rounding=ROUND_HALF_UP)


def calcular_total_con_iva(
    neto: Decimal, rate: Decimal = IVA_RATE, paso: Decimal = PASO_CLP
) -> Decimal:
    """Neto + IVA, redondeado a la unidad mínima de la moneda."""
    return (neto + calcular_iva(neto, rate, paso)).quantize(
        paso, rounding=ROUND_HALF_UP
    )


def porcentaje_a_tasa(iva_porcentaje: Decimal) -> Decimal:
    """Convierte un porcentaje editable por el operador (19, 0, 12.5) a
    la tasa que espera `calcular_iva` (0.19, 0, 0.125)."""
    return iva_porcentaje / Decimal("100")
