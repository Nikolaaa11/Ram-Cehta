"""Los defectos que la verificación adversarial encontró en la primera pasada.

Cada test de acá corresponde a un defecto CONCRETO que existió y se arregló
durante la integración del megaprompt de honorarios/exenta. No son tests de
"funciona la feature" —de eso se ocupa test_retencion.py— sino candados: si
alguien vuelve a introducir uno de estos, salta acá.

Referencia: docs/MEGAPROMPT_OC_HONORARIOS_EXENTA.md
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.api.v1.oc_cuotas import _base_de_reparto
from app.api.v1.ordenes_compra import _iva_porcentaje_efectivo
from app.domain.value_objects.retencion import IVA_PORCENTAJE_GENERAL


# ──────────────────────────────────────────────────────────────────────
# Los hitos de pago se reparten sobre el LÍQUIDO
# ──────────────────────────────────────────────────────────────────────
# Defecto original: `oc_cuotas` derivaba los montos de `oc["total"]` mientras
# el PDF y la pantalla mostraban el líquido. En una OC de honorarios eso le
# transfería al profesional también la retención que la empresa le debe al
# SII — y la empresa la enteraba igual, o sea la pagaba dos veces.


def test_reparto_de_hitos_usa_el_liquido_no_el_bruto():
    oc = {
        "total": Decimal("3645000"),          # honorario BRUTO
        "total_a_pagar": Decimal("3089137"),  # líquido, tras 15,25%
        "retencion_monto": Decimal("555863"),
        "tipo_documento": "HONORARIOS",
    }
    assert _base_de_reparto(oc) == Decimal("3089137")


def test_reparto_no_cambia_en_los_tipos_sin_retencion():
    # Para factura/boleta/exenta total_a_pagar == total, así que este cambio
    # no puede alterar nada de lo que ya existía. Si algún día altera algo,
    # es un bug.
    oc = {
        "total": Decimal("4337550"),
        "total_a_pagar": Decimal("4337550"),
        "retencion_monto": Decimal("0"),
        "tipo_documento": "FACTURA",
    }
    assert _base_de_reparto(oc) == Decimal("4337550")


def test_reparto_cae_al_total_si_la_columna_todavia_no_existe():
    # Ventana entre el SQL y el deploy: mejor repartir como antes que tirar
    # 500 sobre una OC que no tiene nada que ver con honorarios.
    assert _base_de_reparto({"total": Decimal("1000000")}) == Decimal("1000000")
    assert _base_de_reparto(
        {"total": Decimal("1000000"), "total_a_pagar": None}
    ) == Decimal("1000000")


def test_reparto_respeta_un_liquido_de_cero_en_vez_de_confundirlo_con_ausencia():
    # La trampa del cero falso aplicada al reparto: con `or`, un
    # total_a_pagar de 0 caería al total y repartiría plata que no hay.
    oc = {"total": Decimal("500000"), "total_a_pagar": Decimal("0")}
    assert _base_de_reparto(oc) == Decimal("0")


# ──────────────────────────────────────────────────────────────────────
# Volver a un tipo afecto restaura el IVA
# ──────────────────────────────────────────────────────────────────────
# Defecto original: al pasar a HONORARIOS el servidor forzaba
# iva_porcentaje=0 (bien), pero al volver a FACTURA reusaba ese 0 y quedaba
# una factura afecta con 0% de IVA — 19% menos de lo que el proveedor va a
# facturar, e indistinguible de una exenta.


@pytest.mark.parametrize("tipo_sin_iva", ["HONORARIOS", "FACTURA_EXENTA"])
def test_los_tipos_sin_iva_siempre_persisten_cero(tipo_sin_iva):
    assert _iva_porcentaje_efectivo(
        tipo_sin_iva,
        explicito=Decimal("19"),  # aunque el cliente insista
        actual=Decimal("19"),
        tipo_anterior="FACTURA",
    ) == Decimal("0")


@pytest.mark.parametrize("tipo_anterior", ["HONORARIOS", "FACTURA_EXENTA"])
def test_volver_a_factura_restaura_el_iva_general(tipo_anterior):
    assert (
        _iva_porcentaje_efectivo(
            "FACTURA",
            explicito=None,
            actual=Decimal("0"),  # el 0 que el propio servidor había forzado
            tipo_anterior=tipo_anterior,
        )
        == IVA_PORCENTAJE_GENERAL
    )


def test_una_factura_que_sigue_siendo_factura_conserva_su_tasa_pactada():
    # Un IVA distinto del general (caso pactado) no se pisa con el general
    # sólo porque el PATCH no lo mande.
    assert _iva_porcentaje_efectivo(
        "FACTURA",
        explicito=None,
        actual=Decimal("12.5"),
        tipo_anterior="FACTURA",
    ) == Decimal("12.5")


def test_el_iva_explicito_del_cliente_gana_en_un_tipo_afecto():
    assert _iva_porcentaje_efectivo(
        "BOLETA",
        explicito=Decimal("0"),  # cero explícito: es del operador
        actual=Decimal("19"),
        tipo_anterior="BOLETA",
    ) == Decimal("0")


# ──────────────────────────────────────────────────────────────────────
# El peso chileno no tiene centavos
# ──────────────────────────────────────────────────────────────────────
# Defecto original: el gross-up con cantidad ≠ 1 dejaba un `neto` con
# decimales, que se propagaba a total, total_a_pagar, hitos y vouchers.


def test_una_oc_en_pesos_nunca_guarda_centavos():
    from app.api.v1.ordenes_compra import _derivar_totales_oc

    d = _derivar_totales_oc(
        neto=Decimal("1179939.99"),
        moneda="CLP",
        tipo_documento="HONORARIOS",
        iva_porcentaje=Decimal("0"),
        retencion_porcentaje=Decimal("15.25"),
    )
    for clave in ("neto", "total", "total_a_pagar", "retencion_monto", "iva"):
        valor = d[clave]
        assert valor == valor.to_integral_value(), f"{clave} quedó con centavos: {valor}"


def test_en_moneda_extranjera_los_decimales_si_sobreviven():
    # En UF/USD los decimales son significativos: el redondeo a entero es una
    # regla del peso, no del sistema.
    from app.api.v1.ordenes_compra import _derivar_totales_oc

    d = _derivar_totales_oc(
        neto=Decimal("1234.56"),
        moneda="UF",
        tipo_documento="FACTURA",
        iva_porcentaje=Decimal("19"),
        retencion_porcentaje=Decimal("0"),
    )
    assert d["neto"] == Decimal("1234.56")


# ──────────────────────────────────────────────────────────────────────
# La identidad de plata cierra siempre
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "neto",
    ["1", "3", "7", "1000000", "3645000", "1179941", "999999", "12345679"],
)
def test_liquido_mas_retencion_da_exactamente_el_total(neto):
    from app.api.v1.ordenes_compra import _derivar_totales_oc

    d = _derivar_totales_oc(
        neto=Decimal(neto),
        moneda="CLP",
        tipo_documento="HONORARIOS",
        iva_porcentaje=Decimal("0"),
        retencion_porcentaje=Decimal("15.25"),
    )
    assert d["total_a_pagar"] + d["retencion_monto"] == d["total"]
