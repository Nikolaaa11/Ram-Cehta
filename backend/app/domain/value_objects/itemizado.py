"""El itemizado de una OC: cuánto vale cada línea y cuánto suma la columna.

Regla única, y la razón por la que este módulo existe (2026-09-22):

    total_linea = redondeo(cantidad x precio_unitario) al paso de la moneda
    neto (B)    = SUMA de esos total_linea  ← no el redondeo de la suma cruda

Nicolás: "hay OC que no se están sumando bien". Eran dos cosas encadenadas:

 1. `total_linea` NUNCA se guardaba desde la pantalla (sólo el alta por
    correo lo hacía): las 39 OC de producción tenían la columna en NULL, así
    que la ficha mostraba "$0" en cada línea y el total abajo correcto.
 2. El neto se guardaba como la suma CRUDA de `cantidad x precio` (con
    decimales), mientras el PDF imprimía cada línea redondeada. Sumar la
    columna impresa daba otra cosa que el neto impreso: en
    OC0059-PAN001-Comercializadora los Canelos, $336.377 contra $336.387.

Sumar primero y redondear después NO es equivalente a redondear cada línea y
sumar: es la diferencia entre lo que el documento dice y lo que cualquiera
obtiene sumando la columna con una calculadora. En un documento que se firma
y se manda al proveedor, manda la columna. Por eso el neto se define como la
suma de las líneas YA redondeadas, y así el papel siempre cuadra.

En CLP el paso es $1 (no existe el centavo); en UF y USD, 0,01.
"""
from __future__ import annotations

from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.domain.value_objects.iva import paso_de_moneda

__all__ = ["subtotal_itemizado", "total_linea"]


def _dec(valor: Any, por_defecto: str = "0") -> Decimal:
    if valor is None:
        return Decimal(por_defecto)
    return valor if isinstance(valor, Decimal) else Decimal(str(valor))


# Precisión con la que la BD guarda cada campo (core.ordenes_compra_detalle:
# precio_unitario NUMERIC(18,2), cantidad NUMERIC(18,4)). Se multiplica con
# estos valores y no con los que llegan: si el formulario manda 0,33333 de
# cantidad, la BD guarda 0,3333 y el importe tiene que salir de ESE número o
# el PDF imprime una multiplicación que no da.
_PASO_PRECIO = Decimal("0.01")
_PASO_CANTIDAD = Decimal("0.0001")


def total_linea(
    cantidad: Any, precio_unitario: Any, moneda: str | None = "CLP"
) -> Decimal:
    """Importe de UNA línea, redondeado al paso de la moneda (ROUND_HALF_UP).

    Acepta negativos: una línea de descuento es un importe negativo y se
    redondea igual (-0,5 va a -1, simétrico).
    """
    c = _dec(cantidad, "1").quantize(_PASO_CANTIDAD, rounding=ROUND_HALF_UP)
    p = _dec(precio_unitario).quantize(_PASO_PRECIO, rounding=ROUND_HALF_UP)
    return (c * p).quantize(paso_de_moneda(moneda), rounding=ROUND_HALF_UP)


def subtotal_itemizado(items: Iterable[Any], moneda: str | None = "CLP") -> Decimal:
    """El neto (B): la suma de las líneas ya redondeadas.

    `items` puede traer objetos con atributos `cantidad`/`precio_unitario`
    (schemas y filas del ORM) o diccionarios con esas claves.
    """
    total = Decimal("0")
    for it in items:
        if isinstance(it, dict):
            cantidad, precio = it.get("cantidad"), it.get("precio_unitario")
        else:
            cantidad = getattr(it, "cantidad", None)
            precio = getattr(it, "precio_unitario", None)
        total += total_linea(cantidad, precio, moneda)
    return total
