"""Líneas de descuento en la OC — negativos permitidos, total positivo.

Nicolás pidió poder restar dentro de la OC ("poner números negativos, no me
deja"). La regla que estos tests fijan:

  · `precio_unitario` puede ser NEGATIVO (línea de descuento) o CERO (ítem
    bonificado);
  · `cantidad` sigue siendo > 0 — el descuento va en el precio, y una
    cantidad negativa duplicaría el signo (-precio × -cantidad = cargo);
  · el NETO resultante tiene que ser > 0: una OC cuyo total no es un monto
    a favor del proveedor no es una orden de compra. El rechazo es 422 con
    un mensaje que dice qué pasó, en las TRES capas (schema del POST,
    guard del PUT /items, y defensa en `_derivar_totales_oc`).
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.ordenes_compra import _derivar_totales_oc
from app.schemas.orden_compra import OCDetalleCreate, OrdenCompraCreate


def _item(precio: str, cantidad: str = "1", desc: str = "x") -> dict:
    return {
        "item": 1,
        "descripcion": desc,
        "precio_unitario": Decimal(precio),
        "cantidad": Decimal(cantidad),
    }


def _oc(items: list[dict]) -> OrdenCompraCreate:
    return OrdenCompraCreate(
        numero_oc="OC-TEST",
        empresa_codigo="RHO",
        proveedor_id=1,
        fecha_emision="2026-08-26",
        items=items,
    )


# ──────────────────────────────────────────────────────────────────────
# Lo que AHORA se puede
# ──────────────────────────────────────────────────────────────────────


def test_una_linea_de_descuento_resta_del_neto():
    oc = _oc([
        _item("1000000", desc="Servicio de ingeniería"),
        _item("-150000", desc="Descuento por anticipo"),
    ])
    assert oc.neto == Decimal("850000")


def test_el_descuento_admite_cantidad_mayor_a_uno():
    # "-50.000 × 3" — tres unidades bonificadas.
    oc = _oc([_item("500000"), _item("-50000", "3")])
    assert oc.neto == Decimal("350000")


def test_un_item_bonificado_a_precio_cero_es_valido():
    oc = _oc([_item("800000"), _item("0", desc="Flete sin cargo")])
    assert oc.neto == Decimal("800000")


def test_el_precio_negativo_pasa_el_schema_de_linea():
    it = OCDetalleCreate(**_item("-99999.99"))
    assert it.precio_unitario == Decimal("-99999.99")


# ──────────────────────────────────────────────────────────────────────
# Lo que sigue prohibido, y con qué mensaje
# ──────────────────────────────────────────────────────────────────────


def test_cantidad_negativa_sigue_prohibida():
    # -precio × -cantidad volvería a ser un cargo: el descuento va en el
    # precio, la cantidad es siempre positiva.
    with pytest.raises(ValidationError):
        OCDetalleCreate(**_item("100", "-2"))


def test_cantidad_cero_sigue_prohibida():
    with pytest.raises(ValidationError):
        OCDetalleCreate(**_item("100", "0"))


def test_descuentos_que_superan_los_cargos_rechazan_con_mensaje_claro():
    with pytest.raises(ValidationError) as e:
        _oc([_item("100000"), _item("-150000", desc="Descuento gigante")])
    assert "descuentos" in str(e.value)
    assert "positivo" in str(e.value)


def test_una_oc_de_total_cero_tampoco_es_una_oc():
    with pytest.raises(ValidationError):
        _oc([_item("100000"), _item("-100000")])


@pytest.mark.parametrize("neto", ["0", "-1", "-500000"])
def test_derivar_totales_rechaza_neto_no_positivo(neto):
    """Defensa en profundidad: aunque todos los caminos de la API ya lo
    garantizan, una fila envenenada (alta automática vieja del inbox) no
    puede re-derivar IVA y retención negativos en silencio."""
    with pytest.raises(HTTPException) as e:
        _derivar_totales_oc(
            neto=Decimal(neto),
            moneda="CLP",
            tipo_documento="FACTURA",
            iva_porcentaje=Decimal("19"),
            retencion_porcentaje=Decimal("0"),
        )
    assert e.value.status_code == 422
    assert "descuentos" in e.value.detail


# ──────────────────────────────────────────────────────────────────────
# Los totales derivados con un neto post-descuento
# ──────────────────────────────────────────────────────────────────────


def test_el_iva_corre_sobre_el_neto_ya_descontado():
    oc = _oc([_item("1000000"), _item("-200000")])
    d = _derivar_totales_oc(
        neto=oc.neto,
        moneda="CLP",
        tipo_documento="FACTURA",
        iva_porcentaje=Decimal("19"),
        retencion_porcentaje=Decimal("0"),
    )
    assert d["neto"] == Decimal("800000")
    assert d["iva"] == Decimal("152000")   # 19% del descontado, no del bruto
    assert d["total"] == Decimal("952000")


def test_honorarios_con_descuento_retiene_sobre_el_neto_final():
    oc = _oc([_item("4000000"), _item("-355000", desc="Descuento")])
    d = _derivar_totales_oc(
        neto=oc.neto,
        moneda="CLP",
        tipo_documento="HONORARIOS",
        iva_porcentaje=Decimal("0"),
        retencion_porcentaje=Decimal("15.25"),
    )
    assert d["neto"] == Decimal("3645000")
    assert d["total_a_pagar"] + d["retencion_monto"] == d["total"]


# ──────────────────────────────────────────────────────────────────────
# El PDF imprime el signo (los bugs que encontró el barrido)
# ──────────────────────────────────────────────────────────────────────


def test_fmt_clp_pone_el_signo_antes_del_simbolo():
    from app.services.oc_pdf_v2_service import _fmt_clp

    assert _fmt_clp(Decimal("-500000")) == "-$500.000"


def test_fmt_uf_no_pierde_el_signo_entre_menos_uno_y_cero():
    """El bug real: int("-0") == 0 tragaba el signo y un descuento de media
    UF se imprimía como CARGO de media UF."""
    from app.services.oc_pdf_v2_service import _fmt_uf

    assert _fmt_uf(Decimal("-0.50")) == "-UF 0,50"
    assert _fmt_uf(Decimal("-1.50")) == "-UF 1,50"
    assert _fmt_uf(Decimal("123.45")) == "UF 123,45"


def test_fmt_usd_signo_adelante():
    from app.services.oc_pdf_v2_service import _fmt_usd

    assert _fmt_usd(Decimal("-500")) == "-US$500.00"
    assert _fmt_usd(Decimal("1234.5")) == "US$1,234.50"
