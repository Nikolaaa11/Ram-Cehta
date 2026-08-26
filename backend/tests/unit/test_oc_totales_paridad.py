"""Paridad backend↔frontend de los totales de una OC.

Lee el MISMO snapshot que `frontend/lib/__tests__/oc-totales-paridad.test.ts`
(`tests/fixtures/oc_totales_esperado.json`). Si alguien toca una de las dos
implementaciones y no la otra, una de las dos suites falla.

Por qué existe: las dos pantallas de IA calculaban su vista previa con
`moneda === "CLP" ? neto * 0.19 : 0` mientras este backend aplica IVA también
a la UF. Una OC en UF mostraba IVA 0 en pantalla y salía con 19 % en el PDF —
el "los cálculos no me cuadran" que reportó el equipo. Corregir el literal del
frontend no alcanzaba: vuelve a divergir en el próximo cambio.

Este lado del candado tiene una función extra: como el snapshot se GENERA
desde `_derivar_totales_oc`, si no se regenerara nunca este test pasaría
siempre. Por eso además verifica que el fixture esté al día — si alguien
cambia una regla y no corre el generador, acá salta.

Regenerar:  python scripts/gen_snapshot_totales_oc.py
"""
from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

import pytest

from app.api.v1.ordenes_compra import _derivar_totales_oc

_FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "oc_totales_esperado.json"

_SNAPSHOT = json.loads(_FIXTURE.read_text(encoding="utf-8"))
_CASOS = _SNAPSHOT["casos"]


def test_el_fixture_existe_y_cubre_lo_que_importa():
    # Si el archivo se mueve o se vacía, este test avisa en vez de que los
    # parametrizados de abajo pasen trivialmente sobre 0 casos.
    assert len(_CASOS) >= 15, "el snapshot quedó demasiado corto"
    # Los tres que cubren las quejas que originaron todo esto.
    assert "uf_factura_19" in _CASOS, "falta el caso del IVA en UF"
    assert "clp_honorarios_1525" in _CASOS, "falta el caso de la retención"
    assert "clp_neto_con_centavos" in _CASOS, "falta el caso del peso sin centavos"


@pytest.mark.parametrize("nombre", sorted(_CASOS))
def test_el_backend_sigue_produciendo_el_snapshot(nombre):
    """Si alguien cambia una regla y no regenera el fixture, salta acá.

    Es la mitad del candado que evita que el frontend quede espejando una
    regla que el backend ya no aplica.
    """
    caso = _CASOS[nombre]
    e = caso["entrada"]
    d = _derivar_totales_oc(
        neto=Decimal(e["neto"]),
        moneda=e["moneda"],
        tipo_documento=e["tipo_documento"],
        iva_porcentaje=Decimal(e["iva_porcentaje"]),
        retencion_porcentaje=Decimal(e["retencion_porcentaje"]),
    )
    obtenido = {k: str(v) for k, v in d.items()}
    assert obtenido == caso["esperado"], (
        f"{nombre}: el backend cambió y el fixture quedó viejo. "
        "Corré `python scripts/gen_snapshot_totales_oc.py` y revisá que el "
        "frontend siga pasando."
    )


@pytest.mark.parametrize("nombre", sorted(_CASOS))
def test_las_identidades_de_plata_cierran(nombre):
    esperado = _CASOS[nombre]["esperado"]
    neto = Decimal(esperado["neto"])
    iva = Decimal(esperado["iva"])
    total = Decimal(esperado["total"])
    retencion = Decimal(esperado["retencion_monto"])
    a_pagar = Decimal(esperado["total_a_pagar"])

    assert total == neto + iva, f"{nombre}: total != neto + iva"
    # El líquido sale por RESTA, así que esto cierra exacto siempre. Si
    # alguien lo cambiara por un segundo cálculo independiente, acá salta.
    assert a_pagar + retencion == total, f"{nombre}: líquido + retención != total"


def test_el_peso_nunca_guarda_centavos():
    for nombre, caso in _CASOS.items():
        if caso["entrada"]["moneda"] != "CLP":
            continue
        for clave in ("neto", "iva", "total", "retencion_monto", "total_a_pagar"):
            valor = Decimal(caso["esperado"][clave])
            assert valor == valor.to_integral_value(), (
                f"{nombre}.{clave} = {valor} tiene centavos, y el peso no los tiene"
            )


def test_la_uf_conserva_los_suyos():
    # El error que el arreglo de la UF podría haber introducido: redondear el
    # IVA en UF a la unidad entera pierde casi $40.000 por UF.
    uf = _CASOS["uf_factura_decimales"]["esperado"]
    assert uf["iva"] == "23.46", "el IVA en UF perdió sus centavos"


def test_una_boleta_de_honorarios_no_lleva_iva():
    # La segunda queja del equipo, fijada como propiedad.
    h = _CASOS["clp_honorarios_1525"]["esperado"]
    assert h["iva"] == "0"
    # Y el porcentaje persistido dice la verdad: una fila con `iva_porcentaje
    # = 19` e `iva = 0` haría que el PDF imprimiera "IVA 19% ....... 0".
    assert h["iva_porcentaje"] == "0"
    assert Decimal(h["retencion_monto"]) > 0
