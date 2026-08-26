"""Extracción de OC con IA — las tres quejas del equipo, fijadas como tests.

    1. "no se puede poner unidades"
    2. "no se puede quitar el IVA por boleta de honorarios"
    3. "el cálculo de valores no me cuadra"

Cada una tenía una causa concreta en `_build_oc_suggestion`, y cada una tiene
acá el test que impide que vuelva.

Los `fields` de entrada son lo que devuelve la IA tras leer el documento: se
prueban formas realistas —con la unidad ausente, con el total de línea que no
cuadra, con una línea faltante— porque son las que rompen en producción, no
las bien formadas.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.api.v1.ordenes_compra_extract import (
    _build_oc_suggestion,
    _detectar_tipo_documento,
    _iva_sugerido,
    _retencion_sugerida,
)


def _fields(**extra) -> dict:
    """Un documento leído por la IA, mínimamente completo."""
    base = {
        "proveedor_rut": "76.913.376-3",
        "proveedor_nombre": "CONSULTORA GHR SPA",
        "fecha_emision": "2026-08-20",
        "moneda": "CLP",
        "neto": 2500000,
        "iva": 475000,
        "total": 2975000,
        "items": [
            {"descripcion": "Retiro de residuos", "cantidad": 50,
             "unidad": "Ton", "precio_unitario": 40000, "total": 2000000},
            {"descripcion": "Análisis de muestras", "cantidad": 1,
             "unidad": "Gl", "precio_unitario": 500000, "total": 500000},
        ],
    }
    base.update(extra)
    return base


# ──────────────────────────────────────────────────────────────────────
# Queja 1 — unidades
# ──────────────────────────────────────────────────────────────────────


def test_las_unidades_del_documento_llegan_a_la_sugerencia():
    """El campo existía en la BD, en el schema del POST y en el PDF, pero NO
    en el camino de IA: toda OC creada así nacía con la unidad en NULL."""
    s = _build_oc_suggestion(_fields(), "TECMAVIDA")
    assert [i.unidad for i in s.items] == ["Ton", "Gl"]


def test_sin_unidad_en_el_documento_queda_vacia_y_no_se_inventa():
    f = _fields(items=[
        {"descripcion": "Servicio", "cantidad": 1, "precio_unitario": 100000},
    ])
    s = _build_oc_suggestion(f, "TECMAVIDA")
    assert s.items[0].unidad == ""


def test_la_unidad_se_recorta_al_largo_de_la_columna():
    # `core.ordenes_compra_detalle.unidad` es varchar(20): pasarse haría
    # fallar el INSERT recién al confirmar, con un 500 opaco.
    f = _fields(items=[
        {"descripcion": "X", "cantidad": 1, "precio_unitario": 1,
         "unidad": "U" * 50},
    ])
    s = _build_oc_suggestion(f, "TECMAVIDA")
    assert len(s.items[0].unidad) == 20


# ──────────────────────────────────────────────────────────────────────
# Queja 2 — boleta de honorarios sin IVA
# ──────────────────────────────────────────────────────────────────────


def test_una_boleta_de_honorarios_se_detecta_y_no_lleva_iva():
    f = _fields(
        tipo_documento=None,
        neto=3645000, iva=0, total=3645000,
        observaciones="Boleta de honorarios por asesoría en prevención",
    )
    s = _build_oc_suggestion(f, "TECMAVIDA")
    assert s.tipo_documento == "HONORARIOS"
    assert s.iva_porcentaje == "0"
    assert Decimal(s.retencion_porcentaje) > 0
    assert "honorarios" in s.tipo_documento_motivo.lower()


def test_el_tipo_declarado_por_la_ia_manda_sobre_la_heuristica():
    s = _build_oc_suggestion(_fields(tipo_documento="FACTURA_EXENTA"), "TECMAVIDA")
    assert s.tipo_documento == "FACTURA_EXENTA"
    assert s.iva_porcentaje == "0"


def test_un_documento_sin_iva_se_marca_exento():
    f = _fields(neto=500000, iva=0, total=500000, observaciones="Venta exenta")
    s = _build_oc_suggestion(f, "TECMAVIDA")
    assert s.tipo_documento == "FACTURA_EXENTA"
    assert s.iva_porcentaje == "0"


def test_el_caso_normal_sigue_siendo_factura_afecta():
    s = _build_oc_suggestion(_fields(), "TECMAVIDA")
    assert s.tipo_documento == "FACTURA"
    assert s.iva_porcentaje == "19"
    assert s.retencion_porcentaje == "0"


def test_la_sugerencia_dice_POR_QUE_eligio_ese_tipo():
    # Una decisión tributaria tomada por una IA sin decir en qué se basó no
    # se puede revisar, y ésta define si se retiene 15,25 %.
    for f in (_fields(), _fields(observaciones="boleta de honorarios")):
        s = _build_oc_suggestion(f, "TECMAVIDA")
        assert s.tipo_documento_motivo.strip()


@pytest.mark.parametrize("moneda,esperado", [("CLP", "19"), ("UF", "19"),
                                             ("USD", "0"), ("EUR", "0")])
def test_el_iva_sugerido_respeta_la_regla_de_la_moneda(moneda, esperado):
    # La UF SÍ lleva IVA; el dólar no. Es la misma regla del servidor: si la
    # sugerencia difiriera, el operador vería cambiar el número al guardar.
    assert _iva_sugerido("FACTURA", moneda) == esperado


def test_la_retencion_solo_aplica_a_honorarios():
    assert _retencion_sugerida("FACTURA", date(2026, 8, 20)) == "0"
    assert Decimal(_retencion_sugerida("HONORARIOS", date(2026, 8, 20))) > 0


def test_la_retencion_sale_de_la_escala_del_ano():
    # Invariante 5: una OC de 2026 lleva 15,25 % aunque el SII suba la tasa.
    assert _retencion_sugerida("HONORARIOS", date(2026, 6, 1)) == "15.25"


# ──────────────────────────────────────────────────────────────────────
# Queja 3 — los cálculos no cuadran
# ──────────────────────────────────────────────────────────────────────


def test_cuando_el_documento_y_las_lineas_coinciden_no_hay_aviso():
    s = _build_oc_suggestion(_fields(), "TECMAVIDA")
    assert s.conciliacion.difieren is False
    assert s.conciliacion.neto_items == "2500000"
    assert s.conciliacion.neto_documento == "2500000"


def test_una_linea_faltante_se_avisa_en_vez_de_pasar_en_silencio():
    """El caso que originó la queja.

    La IA lee el neto del pie del documento Y las líneas. Si se saltó una
    línea de una cotización larga, la OC sale por menos que el documento y
    antes no había ninguna señal: el frontend descartaba el neto del
    encabezado y nadie comparaba.
    """
    f = _fields(neto=3000000)  # el documento dice 3.000.000; las líneas suman 2.500.000
    s = _build_oc_suggestion(f, "TECMAVIDA")
    assert s.conciliacion.difieren is True
    assert s.conciliacion.neto_documento == "3000000"
    assert s.conciliacion.neto_items == "2500000"
    assert s.conciliacion.diferencia == "500000"


def test_una_linea_cuyo_total_no_es_cantidad_por_precio_se_marca():
    f = _fields(items=[
        # 50 × 40.000 = 2.000.000, pero el documento dice 2.100.000.
        {"descripcion": "Retiro de residuos", "cantidad": 50,
         "unidad": "Ton", "precio_unitario": 40000, "total": 2100000},
    ], neto=2100000)
    s = _build_oc_suggestion(f, "TECMAVIDA")
    d = s.conciliacion.lineas_descuadradas
    assert len(d) == 1
    assert d[0]["documento"] == "2100000"
    assert d[0]["calculado"] == "2000000"


def test_un_redondeo_de_un_peso_no_dispara_el_aviso():
    # Casi ningún documento chileno cierra al centavo cuando hay cantidades
    # fraccionarias. Un aviso que salta siempre se ignora a la semana.
    f = _fields(neto=2500001)
    s = _build_oc_suggestion(f, "TECMAVIDA")
    assert s.conciliacion.difieren is False


def test_una_cantidad_de_cero_NO_se_convierte_en_uno():
    """La trampa del cero falso, que cambiaba el total sin avisar.

    Era `_parse_amount(...) or Decimal("1")`: una cantidad 0 —que es un dato
    legítimo, p. ej. un ítem que se cotiza pero no se pide— pasaba a 1 y la
    línea sumaba plata que nadie pidió.
    """
    f = _fields(items=[
        {"descripcion": "Ítem cotizado no solicitado", "cantidad": 0,
         "precio_unitario": 100000, "total": 0},
    ], neto=0)
    s = _build_oc_suggestion(f, "TECMAVIDA")
    assert s.items[0].cantidad == "0"
    assert s.conciliacion.neto_items == "0"


def test_un_precio_de_cero_sobrevive():
    # `if price else "0"` daba el mismo texto por casualidad, pero la
    # intención importa: un ítem bonificado tiene precio 0 a propósito.
    f = _fields(items=[
        {"descripcion": "Bonificación", "cantidad": 1, "precio_unitario": 0},
    ], neto=0)
    s = _build_oc_suggestion(f, "TECMAVIDA")
    assert s.items[0].precio_unitario == "0"


def test_sin_neto_en_el_documento_no_se_inventa_un_descuadre():
    f = _fields()
    del f["neto"]
    s = _build_oc_suggestion(f, "TECMAVIDA")
    assert s.conciliacion.neto_documento is None
    assert s.conciliacion.difieren is False


# ──────────────────────────────────────────────────────────────────────
# Bordes de la detección de tipo
# ──────────────────────────────────────────────────────────────────────


def test_detectar_tipo_nunca_devuelve_un_token_invalido():
    from app.api.v1.ordenes_compra_extract import _TIPOS_DOCUMENTO_VALIDOS

    entradas = [
        {},
        {"tipo_documento": "CUALQUIER COSA"},
        {"tipo_documento": 123},
        {"items": "no soy una lista"},
        {"neto": None, "total": None, "iva": None},
    ]
    for f in entradas:
        tipo, motivo = _detectar_tipo_documento(f)
        assert tipo in _TIPOS_DOCUMENTO_VALIDOS
        assert motivo


def test_la_palabra_honorarios_en_una_linea_tambien_cuenta():
    f = _fields(items=[
        {"descripcion": "Honorarios profesionales agosto", "cantidad": 1,
         "precio_unitario": 1000000},
    ], iva=0, neto=1000000, total=1000000)
    tipo, _ = _detectar_tipo_documento(f)
    assert tipo == "HONORARIOS"
