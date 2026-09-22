"""La columna de la OC tiene que sumar el neto. Siempre.

Caso real que originó esto: OC0059-PAN001-Comercializadora los Canelos
(19 líneas con precios unitarios con decimales). La columna impresa sumaba
$336.377 y el neto decía $336.387.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.domain.value_objects.itemizado import subtotal_itemizado, total_linea

# Las 19 líneas reales de la OC 96 (cantidad, precio_unitario).
OC96 = [
    (2, "67142.86"), (1, "54453.76"), (1, "4873.95"), (1, "1680.67"),
    (19, "420.17"), (3, "4201.68"), (6, "546.22"), (10, "2268.91"),
    (13, "2268.91"), (5, "8235.29"), (8, "294.12"), (1, "2100.84"),
    (1, "420.17"), (2, "294.12"), (1, "1680.67"), (1, "420.17"),
    (20, "84.03"), (6, "1596.64"), (6, "840.34"),
]


def _items(pares):
    return [{"cantidad": Decimal(str(c)), "precio_unitario": Decimal(p)} for c, p in pares]


@pytest.mark.parametrize(
    ("cantidad", "precio", "moneda", "esperado"),
    [
        (2, "67142.86", "CLP", "134286"),      # 134285,72 → 134.286
        (19, "420.17", "CLP", "7983"),         # 7983,23
        (1, "0.5", "CLP", "1"),                # medio peso sube (HALF_UP)
        (1, "-0.5", "CLP", "-1"),              # descuento: simétrico
        (1, "-500000", "CLP", "-500000"),      # línea de descuento entera
        (3, "1.005", "UF", "3.02"),            # UF: dos decimales
        (2, "10.125", "USD", "20.25"),
        (7, 0, "CLP", "0"),                    # ítem bonificado
    ],
)
def test_total_linea_redondea_al_paso_de_la_moneda(cantidad, precio, moneda, esperado):
    assert total_linea(cantidad, precio, moneda) == Decimal(esperado)


def test_en_clp_ninguna_linea_queda_con_centavos():
    for it in _items(OC96):
        v = total_linea(it["cantidad"], it["precio_unitario"], "CLP")
        assert v == v.to_integral_value(), v


def test_el_neto_es_la_suma_de_la_columna_impresa():
    """Es el bug de la OC 96: sumar y redondear no es redondear y sumar."""
    items = _items(OC96)
    neto = subtotal_itemizado(items, "CLP")
    columna = sum(total_linea(i["cantidad"], i["precio_unitario"], "CLP") for i in items)
    assert neto == columna == Decimal("336387")

    crudo = sum(i["cantidad"] * i["precio_unitario"] for i in items)
    assert crudo == Decimal("336386.60")  # la suma cruda NO es el neto


def test_el_neto_de_la_oc_37_deja_de_tener_centavos():
    """OC0041: neto 544.873,99 en pesos. Con la regla nueva es un entero."""
    items = _items([(1, "544873.99")])
    assert subtotal_itemizado(items, "CLP") == Decimal("544874")


def test_acepta_objetos_ademas_de_dicts():
    class _It:
        def __init__(self, c, p):
            self.cantidad, self.precio_unitario = Decimal(str(c)), Decimal(p)

    assert subtotal_itemizado([_It(2, "100.4"), _It(1, "0.6")], "CLP") == Decimal("202")


def test_itemizado_vacio_es_cero():
    assert subtotal_itemizado([], "CLP") == Decimal("0")


def test_una_linea_sin_cantidad_cuenta_como_una():
    assert total_linea(None, "1500", "CLP") == Decimal("1500")


# ──────────────────────────────────────────────────────────────────────
# Lo que se persiste y lo que se imprime
# ──────────────────────────────────────────────────────────────────────


def test_el_schema_de_creacion_usa_la_suma_de_la_columna():
    """El neto que se guarda es el que suma la columna, no la suma cruda."""
    from datetime import date

    from app.schemas.orden_compra import OrdenCompraCreate

    oc = OrdenCompraCreate(
        numero_oc="OC-PRUEBA-1",
        empresa_codigo="PANIMAVIDA",
        fecha_emision=date(2026, 9, 22),
        moneda="CLP",
        items=[
            {"item": i + 1, "descripcion": f"linea {i + 1}",
             "cantidad": Decimal(str(c)), "precio_unitario": Decimal(p)}
            for i, (c, p) in enumerate(OC96)
        ],
    )
    assert oc.neto == Decimal("336387")
    assert oc.iva_calculado == Decimal("63914")
    assert oc.total_calculado == Decimal("400301")


def test_el_pdf_redondea_los_importes_en_vez_de_truncarlos():
    from app.services.oc_pdf_v2_service import _fmt_clp

    assert _fmt_clp(Decimal("134285.72")) == "$134.286"   # antes: $134.285
    assert _fmt_clp(Decimal("336386.60")) == "$336.387"
    assert _fmt_clp(Decimal("-1680.60")) == "-$1.681"
    assert _fmt_clp(Decimal("7983")) == "$7.983"
    assert _fmt_clp(None) == "$0"


def test_el_pdf_muestra_los_decimales_del_precio_unitario():
    from app.services.oc_pdf_v2_service import _fmt_clp_unitario, _formatear_precio_unitario

    # Con decimales, para que cantidad x precio cuadre con la línea.
    assert _fmt_clp_unitario(Decimal("67142.86")) == "$67.142,86"
    assert _fmt_clp_unitario(Decimal("420.17")) == "$420,17"
    # Un precio entero se imprime como siempre.
    assert _fmt_clp_unitario(Decimal("600000")) == "$600.000"
    # Fuera de CLP manda el formato de la moneda.
    assert _formatear_precio_unitario(Decimal("10.5"), "UF") == "UF 10,50"


def test_la_columna_impresa_de_la_oc_96_suma_el_neto_impreso():
    """La prueba que reproduce el reclamo: sumar lo que dice el papel."""
    from app.services.oc_pdf_v2_service import _fmt_clp

    def a_numero(texto: str) -> int:
        return int(texto.replace("$", "").replace(".", ""))

    columna = sum(
        a_numero(_fmt_clp(total_linea(c, p, "CLP"))) for c, p in OC96
    )
    neto = subtotal_itemizado(_items(OC96), "CLP")
    assert columna == a_numero(_fmt_clp(neto)) == 336387
