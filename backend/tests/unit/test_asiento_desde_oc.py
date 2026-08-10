"""El asiento propuesto a partir de una OC, en los cuatro tipos de documento.

Referencia: docs/MEGAPROMPT_VOUCHER_DESDE_OC.md

Estos tests son candados sobre plata, no sobre estilo. Los tres que más importan:

1. `Σdebe == Σhaber` en TODOS los casos, incluido el prorrateo por hitos. Si esto
   se rompe, el trigger de partida doble frena el voucher al salir de DRAFT y el
   operador ve un error que no explica nada.
2. `Σ retención_i == retencion_monto` EXACTO al prorratear. Es el número que se
   entera al SII: un peso de diferencia es una declaración mal hecha.
3. La retención va siempre al PASIVO y nunca al debe. Mandarla a gasto imputa como
   costo propio un impuesto ajeno y descuadra el F29.

Las cifras salen del motor real (`calcular_totales`), no de constantes escritas a
mano: si algún día cambia la aritmética de la retención, estos tests se enteran.
"""

from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import pytest

from app.domain.services.asiento_desde_oc import (
    CUENTA_HONORARIOS_GASTO,
    CUENTA_HONORARIOS_POR_PAGAR,
    CUENTA_IVA_CREDITO,
    CUENTA_PROVEEDORES_POR_PAGAR,
    CUENTA_RETENCION_HONORARIOS,
    TIPOS_CON_CREDITO_FISCAL,
    AsientoPropuesto,
    HitoParcial,
    LineaAsiento,
    MontosOC,
    montos_desde_fila,
    proponer_asiento,
    proponer_asientos_por_hitos,
)
from app.domain.value_objects.retencion import TIPOS_DOCUMENTO, calcular_totales

FECHA_2026 = date(2026, 8, 10)

# El caso que el docstring de `calcular_liquido` usa para explicar por qué el líquido
# sale por resta: 1.000.600 al 15,25 % da 152.591,5 de retención, o sea MEDIO PESO
# exacto, que ROUND_HALF_UP manda a 152.592. Es el monto que rompe cualquier
# implementación que redondee dos veces.
BRUTO_MEDIO_PESO = Decimal("1000600")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _oc(
    tipo: str,
    subtotal: Decimal | str,
    *,
    retencion_porcentaje: Decimal | None = None,
    iva_porcentaje: Decimal | None = None,
    moneda: str = "CLP",
) -> MontosOC:
    """OC de prueba con las cifras que produciría el motor real."""
    totales = calcular_totales(
        tipo,
        Decimal(subtotal),
        iva_porcentaje=iva_porcentaje,
        retencion_porcentaje=retencion_porcentaje,
        fecha_emision=FECHA_2026,
    )
    return MontosOC(
        tipo_documento=tipo,
        neto=totales.total_neto,
        iva=totales.iva,
        total=totales.total,
        retencion_monto=totales.retencion_monto,
        total_a_pagar=totales.total_a_pagar,
        moneda=moneda,
    )


def _repartir(base: Decimal, porcentajes: list[str]) -> list[Decimal]:
    """Hitos como los deja `oc_cuotas._derivar_montos`: residuo del reparto al último.

    Se replica acá a propósito en vez de importar el helper de la API: el motor tiene
    que funcionar con los montos REALES que le van a llegar, incluido el último hito
    que ya viene con el residuo adentro.
    """
    montos = [
        (base * Decimal(p) / Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        for p in porcentajes
    ]
    montos[-1] = montos[-1] + (base - sum(montos, start=Decimal("0")))
    return montos


def _linea(asiento: AsientoPropuesto, concepto: str) -> LineaAsiento:
    coincidencias = [linea for linea in asiento.lineas if linea.concepto == concepto]
    assert len(coincidencias) == 1, f"esperaba una sola línea {concepto}, hay {len(coincidencias)}"
    return coincidencias[0]


def _conceptos(asiento: AsientoPropuesto) -> list[str]:
    return [linea.concepto for linea in asiento.lineas]


def _assert_cuadra(asiento: AsientoPropuesto) -> None:
    debe = sum((linea.debit for linea in asiento.lineas), start=Decimal("0"))
    haber = sum((linea.credit for linea in asiento.lineas), start=Decimal("0"))
    assert debe == haber, f"el asiento no cuadra: debe {debe} vs haber {haber}"
    assert asiento.total_debe == debe
    assert asiento.total_haber == haber
    # El CHECK de `voucher_lines` es debit XOR credit: ninguna línea puede tener las dos
    # ni ninguna de las dos.
    for linea in asiento.lineas:
        assert (linea.debit > 0) != (linea.credit > 0), f"línea {linea.concepto} sin XOR"


# ---------------------------------------------------------------------------
# Los cuatro tipos, OC completa
# ---------------------------------------------------------------------------


def test_honorarios_arma_las_tres_lineas_del_contrato() -> None:
    oc = _oc("HONORARIOS", "3645000")
    asiento = proponer_asiento(oc)

    assert _conceptos(asiento) == ["GASTO", "RETENCION", "POR_PAGAR"]
    gasto, retencion, por_pagar = asiento.lineas

    assert gasto.cuenta_codigo == CUENTA_HONORARIOS_GASTO == "4201-02"
    assert gasto.debit == oc.total  # el gasto es el BRUTO, no el líquido
    assert retencion.cuenta_codigo == CUENTA_RETENCION_HONORARIOS == "2105-04"
    assert retencion.credit == oc.retencion_monto
    assert por_pagar.cuenta_codigo == CUENTA_HONORARIOS_POR_PAGAR == "2102-11"
    assert por_pagar.credit == oc.total_a_pagar

    # Las tres cuentas se conocen: la propuesta se puede guardar tal cual.
    assert asiento.completo is True
    assert asiento.faltantes == ()
    _assert_cuadra(asiento)


def test_honorarios_el_gasto_es_el_bruto_y_lo_que_se_gira_es_el_liquido() -> None:
    # El error clásico: asentar el gasto por el líquido. La empresa gastó el honorario
    # completo; que una parte se la pague al SII en vez de al profesional no lo achica.
    asiento = proponer_asiento(_oc("HONORARIOS", "3645000"))

    assert _linea(asiento, "GASTO").debit == Decimal("3645000")
    assert _linea(asiento, "POR_PAGAR").credit == Decimal("3089137")
    assert _linea(asiento, "RETENCION").credit == Decimal("555863")


def test_la_retencion_va_al_pasivo_y_nunca_al_debe() -> None:
    # Candado sobre el invariante tributario: la retención no es gasto de la empresa,
    # es plata del prestador. Si aparece en el debe, alguien la mandó a resultado.
    for subtotal in ("100000", "3645000", str(BRUTO_MEDIO_PESO)):
        asiento = proponer_asiento(_oc("HONORARIOS", subtotal))
        retencion = _linea(asiento, "RETENCION")
        assert retencion.debit == 0
        assert retencion.credit > 0
        assert retencion.cuenta_codigo is not None
        assert retencion.cuenta_codigo.startswith("2"), "2105-04 es PASIVO"


def test_factura_separa_neto_iva_y_total() -> None:
    asiento = proponer_asiento(_oc("FACTURA", "1000000"))

    assert _conceptos(asiento) == ["GASTO", "IVA_CREDITO", "POR_PAGAR"]
    assert _linea(asiento, "GASTO").debit == Decimal("1000000")
    assert _linea(asiento, "IVA_CREDITO").debit == Decimal("190000")
    assert _linea(asiento, "IVA_CREDITO").cuenta_codigo == CUENTA_IVA_CREDITO == "1113-02"
    assert _linea(asiento, "POR_PAGAR").credit == Decimal("1190000")
    assert _linea(asiento, "POR_PAGAR").cuenta_codigo == CUENTA_PROVEEDORES_POR_PAGAR
    _assert_cuadra(asiento)


def test_boleta_usa_el_mismo_asiento_que_la_factura() -> None:
    # Es lo que manda el contrato §2.1. El reparo tributario (la boleta no da crédito
    # fiscal) está anotado en `TIPOS_CON_CREDITO_FISCAL`; si esa política cambia, este
    # test es el que avisa que cambió.
    assert "BOLETA" in TIPOS_CON_CREDITO_FISCAL
    asiento = proponer_asiento(_oc("BOLETA", "1000000"))
    assert _conceptos(asiento) == ["GASTO", "IVA_CREDITO", "POR_PAGAR"]
    _assert_cuadra(asiento)


def test_factura_exenta_no_lleva_linea_de_iva() -> None:
    asiento = proponer_asiento(_oc("FACTURA_EXENTA", "1000000"))

    assert _conceptos(asiento) == ["GASTO", "POR_PAGAR"]
    assert _linea(asiento, "GASTO").debit == Decimal("1000000")
    assert _linea(asiento, "POR_PAGAR").credit == Decimal("1000000")
    _assert_cuadra(asiento)


def test_la_cuenta_de_gasto_queda_vacia_salvo_en_honorarios() -> None:
    # La OC no guarda `cuenta_codigo`. Proponer una inventada es peor que dejarla en
    # blanco: se guarda mal y nadie lo nota.
    for tipo in ("FACTURA", "BOLETA", "FACTURA_EXENTA"):
        asiento = proponer_asiento(_oc(tipo, "1000000"))
        assert _linea(asiento, "GASTO").cuenta_codigo is None
        assert asiento.completo is False
        assert len(asiento.faltantes) == 1
        assert "GASTO" in asiento.faltantes[0]

    # En honorarios la cuenta es la definición del documento, no una adivinanza.
    assert proponer_asiento(_oc("HONORARIOS", "1000000")).completo is True


def test_las_lineas_de_balance_no_se_marcan_afectas_a_iva() -> None:
    # `nubox_api_mapper` trata `iva_tratamiento in ("AFECTO", None)` como línea de IVA:
    # dejar la retención o el "por pagar" en NULL las haría contar como afectas al
    # exportar. La línea de gasto sí lleva el tratamiento del tipo de documento.
    honorarios = proponer_asiento(_oc("HONORARIOS", "1000000"))
    assert _linea(honorarios, "GASTO").iva_tratamiento == "NO_GRAVADO"
    assert _linea(honorarios, "RETENCION").iva_tratamiento == "NA"
    assert _linea(honorarios, "POR_PAGAR").iva_tratamiento == "NA"

    factura = proponer_asiento(_oc("FACTURA", "1000000"))
    assert _linea(factura, "GASTO").iva_tratamiento == "AFECTO"
    assert _linea(factura, "IVA_CREDITO").iva_tratamiento == "AFECTO"
    assert _linea(factura, "POR_PAGAR").iva_tratamiento == "NA"

    exenta = proponer_asiento(_oc("FACTURA_EXENTA", "1000000"))
    assert _linea(exenta, "GASTO").iva_tratamiento == "EXENTO"


def test_la_tercera_linea_de_honorarios_explica_que_es_editable() -> None:
    # El contrato pide proponer 2102-11 "editable, con la explicación al lado". La nota
    # viaja al frontend como `ayuda` en `LineaVoucherPropuesta`.
    nota = _linea(proponer_asiento(_oc("HONORARIOS", "1000000")), "POR_PAGAR").nota
    assert nota is not None
    assert "banco" in nota.lower()


@pytest.mark.parametrize("tipo", TIPOS_DOCUMENTO)
@pytest.mark.parametrize("subtotal", ["1", "999", "1000000", "1000600", "3645000", "7777777"])
def test_la_partida_doble_cierra_en_todos_los_tipos_y_montos(tipo: str, subtotal: str) -> None:
    _assert_cuadra(proponer_asiento(_oc(tipo, subtotal)))


# ---------------------------------------------------------------------------
# Retención 0 e IVA 0: la línea se OMITE, no se emite en cero
# ---------------------------------------------------------------------------


def test_retencion_cero_omite_la_linea_en_vez_de_emitirla_vacia() -> None:
    # Tasa 0 es legítima (`normalizar_porcentajes` respeta el cero explícito). Una línea
    # con debe y haber en 0 la rechaza el CHECK de `voucher_lines` y el POST entero
    # falla con "debe tener debit O credit", que no explica nada.
    oc = _oc("HONORARIOS", "1000000", retencion_porcentaje=Decimal("0"))
    assert oc.retencion_monto == 0

    asiento = proponer_asiento(oc)
    assert _conceptos(asiento) == ["GASTO", "POR_PAGAR"]
    assert _linea(asiento, "GASTO").debit == Decimal("1000000")
    assert _linea(asiento, "POR_PAGAR").credit == Decimal("1000000")
    _assert_cuadra(asiento)


def test_iva_cero_pactado_en_una_factura_omite_la_linea_de_credito() -> None:
    asiento = proponer_asiento(_oc("FACTURA", "1000000", iva_porcentaje=Decimal("0")))
    assert _conceptos(asiento) == ["GASTO", "POR_PAGAR"]
    _assert_cuadra(asiento)


# ---------------------------------------------------------------------------
# Prorrateo por hitos
# ---------------------------------------------------------------------------


def test_prorrateo_30_70_de_honorarios_cierra_exacto_contra_la_oc() -> None:
    # El caso del contrato §3, con el bruto que fuerza medio peso de retención.
    oc = _oc("HONORARIOS", BRUTO_MEDIO_PESO)
    assert (oc.total, oc.retencion_monto, oc.total_a_pagar) == (
        Decimal("1000600"),
        Decimal("152592"),
        Decimal("848008"),
    )

    montos = _repartir(oc.total_a_pagar, ["30", "70"])
    asientos = proponer_asientos_por_hitos(oc, montos)
    assert len(asientos) == 2

    for asiento in asientos:
        _assert_cuadra(asiento)

    brutos = [_linea(a, "GASTO").debit for a in asientos]
    retenciones = [_linea(a, "RETENCION").credit for a in asientos]
    liquidos = [_linea(a, "POR_PAGAR").credit for a in asientos]

    # Las tres sumas cierran EXACTO. La de la retención es la que se declara al SII.
    assert sum(retenciones) == oc.retencion_monto == Decimal("152592")
    assert sum(liquidos) == oc.total_a_pagar == Decimal("848008")
    assert sum(brutos) == oc.total == Decimal("1000600")

    # Y el líquido de cada hito es exactamente el monto del hito: el asiento no puede
    # contradecir a la transferencia que tesorería va a hacer.
    assert liquidos == montos

    # Valores concretos, para que un cambio de algoritmo no pase inadvertido.
    assert liquidos == [Decimal("254402"), Decimal("593606")]
    assert retenciones == [Decimal("45778"), Decimal("106814")]
    assert brutos == [Decimal("300180"), Decimal("700420")]


def test_prorrateo_de_tres_hitos_con_tercios_tambien_cierra_exacto() -> None:
    # 33,334 / 33,333 / 33,333 es el reparto que manda el navegador y el que más residuo
    # genera. Ni la retención ni el líquido pueden perder un peso por el camino.
    oc = _oc("HONORARIOS", "3645000")
    montos = _repartir(oc.total_a_pagar, ["33.334", "33.333", "33.333"])
    asientos = proponer_asientos_por_hitos(oc, montos)

    assert sum(_linea(a, "RETENCION").credit for a in asientos) == oc.retencion_monto
    assert sum(_linea(a, "POR_PAGAR").credit for a in asientos) == oc.total_a_pagar
    assert sum(_linea(a, "GASTO").debit for a in asientos) == oc.total
    for asiento in asientos:
        _assert_cuadra(asiento)


@pytest.mark.parametrize(
    "reparto",
    [
        ["50", "50"],
        ["30", "70"],
        ["33.334", "33.333", "33.333"],
        ["10", "10", "10", "10", "60"],
        ["1", "99"],
    ],
)
@pytest.mark.parametrize("subtotal", ["1000600", "3645000", "1234567", "7777777"])
def test_ningun_reparto_pierde_ni_gana_un_peso(reparto: list[str], subtotal: str) -> None:
    oc = _oc("HONORARIOS", subtotal)
    asientos = proponer_asientos_por_hitos(oc, _repartir(oc.total_a_pagar, reparto))

    assert sum(_linea(a, "RETENCION").credit for a in asientos) == oc.retencion_monto
    assert sum(_linea(a, "POR_PAGAR").credit for a in asientos) == oc.total_a_pagar
    assert sum(_linea(a, "GASTO").debit for a in asientos) == oc.total
    for asiento in asientos:
        _assert_cuadra(asiento)


def test_el_prorrateo_de_una_factura_reparte_el_iva_sin_perder_un_peso() -> None:
    # El IVA crédito también es una cifra fiscal: lo que se sume en las líneas es lo que
    # se declara en el F29 y lo que se concilia contra el RCV.
    oc = _oc("FACTURA", "1234567")
    asientos = proponer_asientos_por_hitos(oc, _repartir(oc.total_a_pagar, ["30", "70"]))

    assert sum(_linea(a, "IVA_CREDITO").debit for a in asientos) == oc.iva
    assert sum(_linea(a, "GASTO").debit for a in asientos) == oc.neto
    assert sum(_linea(a, "POR_PAGAR").credit for a in asientos) == oc.total
    for asiento in asientos:
        _assert_cuadra(asiento)


def test_un_hito_del_100_por_ciento_da_el_mismo_asiento_que_la_oc_entera() -> None:
    oc = _oc("HONORARIOS", BRUTO_MEDIO_PESO)
    entero = proponer_asiento(oc)
    unico = proponer_asiento(oc, HitoParcial(monto=oc.total_a_pagar))

    assert unico.lineas == entero.lineas
    assert proponer_asientos_por_hitos(oc, [oc.total_a_pagar])[0].lineas == entero.lineas


def test_el_prorrateo_no_copia_las_lineas_de_la_oc_entera() -> None:
    # El bug que este módulo existe para evitar: emitir un voucher por el total en cada
    # cuota, o sea pagar la OC tantas veces como hitos tenga.
    oc = _oc("HONORARIOS", "3645000")
    primero = proponer_asientos_por_hitos(oc, _repartir(oc.total_a_pagar, ["30", "70"]))[0]
    assert _linea(primero, "GASTO").debit < oc.total
    assert _linea(primero, "POR_PAGAR").credit < oc.total_a_pagar


def test_un_hito_suelto_no_puede_exceder_lo_que_la_oc_debe() -> None:
    oc = _oc("HONORARIOS", "1000000")
    with pytest.raises(ValueError, match="no puede pagar más"):
        proponer_asiento(oc, HitoParcial(monto=oc.total_a_pagar + Decimal("1")))
    # Tampoco sumado a los hitos anteriores.
    with pytest.raises(ValueError, match="no puede pagar más"):
        proponer_asiento(
            oc,
            HitoParcial(monto=Decimal("100"), acumulado_previo=oc.total_a_pagar),
        )


def test_un_hito_en_cero_o_negativo_levanta_en_vez_de_emitir_un_voucher_vacio() -> None:
    oc = _oc("HONORARIOS", "1000000")
    for monto in (Decimal("0"), Decimal("-1")):
        with pytest.raises(ValueError, match="voucher de cero"):
            proponer_asiento(oc, HitoParcial(monto=monto))


def test_sin_liquido_no_hay_hitos_que_repartir() -> None:
    # Honorarios con retención del 100 %: el líquido es 0 y no hay nada que transferir.
    # Antes que dividir por cero, se dice qué pasa.
    oc = _oc("HONORARIOS", "1000000", retencion_porcentaje=Decimal("100"))
    assert oc.total_a_pagar == 0
    with pytest.raises(ValueError, match="no hay base"):
        proponer_asiento(oc, HitoParcial(monto=Decimal("1")))


def test_el_prorrateo_exige_todos_los_hitos_y_no_solo_los_pendientes() -> None:
    # `generar-vouchers` sólo emite los hitos PENDIENTE. Si el prorrateo se calculara
    # sobre ese subconjunto, cada hito ignoraría lo repartido antes que él y su retención
    # saldría de una base equivocada.
    oc = _oc("HONORARIOS", "1000000")
    montos = _repartir(oc.total_a_pagar, ["30", "70"])

    with pytest.raises(ValueError, match="TODOS los hitos"):
        proponer_asientos_por_hitos(oc, montos[:1])
    with pytest.raises(ValueError, match="vacía"):
        proponer_asientos_por_hitos(oc, [])


def test_prorrateo_en_moneda_con_centavos_usa_el_paso_de_esa_moneda() -> None:
    # En UF/USD el paso es 0,01 y no 1. Redondear a entero acá borraría los centavos de
    # la OC y el asiento dejaría de cuadrar contra el hito.
    oc = MontosOC(
        tipo_documento="FACTURA_EXENTA",
        neto=Decimal("1000.55"),
        iva=Decimal("0"),
        total=Decimal("1000.55"),
        retencion_monto=Decimal("0"),
        total_a_pagar=Decimal("1000.55"),
        moneda="UF",
    )
    montos = [Decimal("300.17"), Decimal("700.38")]
    asientos = proponer_asientos_por_hitos(oc, montos)
    assert [_linea(a, "POR_PAGAR").credit for a in asientos] == montos
    for asiento in asientos:
        _assert_cuadra(asiento)


# ---------------------------------------------------------------------------
# OC incoherente: se levanta, no se propone un asiento torcido
# ---------------------------------------------------------------------------


def test_una_oc_que_no_cuadra_consigo_misma_no_produce_asiento() -> None:
    # neto + iva != total
    with pytest.raises(ValueError, match="neto"):
        proponer_asiento(
            MontosOC("FACTURA", Decimal("1000"), Decimal("190"), Decimal("9999"),
                     Decimal("0"), Decimal("9999"))
        )

    # total_a_pagar + retención != total
    with pytest.raises(ValueError, match="líquido"):
        proponer_asiento(
            MontosOC("HONORARIOS", Decimal("1000"), Decimal("0"), Decimal("1000"),
                     Decimal("152"), Decimal("1000"))
        )


def test_no_se_propone_credito_fiscal_sobre_un_tipo_que_no_lleva_iva() -> None:
    with pytest.raises(ValueError, match="no lleva IVA"):
        proponer_asiento(
            MontosOC("FACTURA_EXENTA", Decimal("1000"), Decimal("190"), Decimal("1190"),
                     Decimal("0"), Decimal("1190"))
        )


def test_no_se_propone_retencion_sobre_un_tipo_que_no_la_lleva() -> None:
    with pytest.raises(ValueError, match="no lleva retención"):
        proponer_asiento(
            MontosOC("FACTURA", Decimal("1000"), Decimal("190"), Decimal("1190"),
                     Decimal("152"), Decimal("1038"))
        )


def test_tipo_de_documento_desconocido_levanta_nombrando_los_validos() -> None:
    with pytest.raises(ValueError, match="tipo de documento desconocido"):
        proponer_asiento(
            MontosOC("NOTA_CREDITO", Decimal("1000"), Decimal("0"), Decimal("1000"),
                     Decimal("0"), Decimal("1000"))
        )


def test_montos_negativos_no_se_asientan_al_reves() -> None:
    with pytest.raises(ValueError, match="negativos"):
        proponer_asiento(
            MontosOC("FACTURA_EXENTA", Decimal("-1000"), Decimal("0"), Decimal("-1000"),
                     Decimal("0"), Decimal("-1000"))
        )


def test_una_oc_en_cero_no_genera_voucher() -> None:
    with pytest.raises(ValueError, match="sin líneas"):
        proponer_asiento(
            MontosOC("FACTURA_EXENTA", Decimal("0"), Decimal("0"), Decimal("0"),
                     Decimal("0"), Decimal("0"))
        )


# ---------------------------------------------------------------------------
# Lectura de la fila cruda
# ---------------------------------------------------------------------------


def test_montos_desde_fila_convierte_lo_que_devuelve_el_select() -> None:
    fila = {
        "tipo_documento": "HONORARIOS",
        "neto": "3645000",
        "iva": "0",
        "total": "3645000",
        "retencion_monto": "555863",
        "total_a_pagar": "3089137",
        "moneda": "CLP",
    }
    oc = montos_desde_fila(fila)
    assert oc == _oc("HONORARIOS", "3645000")
    _assert_cuadra(proponer_asiento(oc))


def test_montos_desde_fila_dice_que_columna_falta_en_el_select() -> None:
    with pytest.raises(ValueError, match="neto, iva"):
        montos_desde_fila(
            {"tipo_documento": "FACTURA", "total": "1190", "total_a_pagar": "1190"}
        )


def test_montos_desde_fila_trata_null_de_impuestos_como_cero_pero_no_el_total() -> None:
    oc = montos_desde_fila(
        {
            "tipo_documento": "FACTURA_EXENTA",
            "neto": Decimal("1000"),
            "iva": None,
            "total": Decimal("1000"),
            "retencion_monto": None,
            "total_a_pagar": None,
            "moneda": None,
        }
    )
    assert oc.iva == 0
    assert oc.retencion_monto == 0
    assert oc.total_a_pagar == Decimal("1000")  # cae a `total`, como `_base_de_reparto`
    assert oc.moneda == "CLP"

    with pytest.raises(ValueError, match="NULL"):
        montos_desde_fila(
            {
                "tipo_documento": "FACTURA",
                "neto": None,
                "iva": 0,
                "total": Decimal("1000"),
                "retencion_monto": Decimal("0"),
                "total_a_pagar": Decimal("1000"),
            }
        )


def test_montos_desde_fila_exige_las_columnas_de_retencion_aunque_su_valor_sea_null() -> None:
    # Asimetría deliberada: el VALOR puede ser NULL (ventana entre el SQL y el
    # deploy), pero la COLUMNA tiene que venir en la fila.
    #
    # Sin esto, una OC de HONORARIOS cuyo SELECT no traiga las dos columnas
    # degradaba a retención 0 y total_a_pagar = total: las dos validaciones de
    # `_validar_oc` pasan (0 + total == total), el asiento sale de DOS líneas y
    # cuadra la partida doble, así que ninguna red posterior lo frena. El
    # voucher manda a girar el BRUTO — el prestador cobra 15,25% de más y la
    # retención nunca se registra para enterarla al SII.
    with pytest.raises(ValueError, match="retencion_monto, total_a_pagar"):
        montos_desde_fila(
            {
                "tipo_documento": "HONORARIOS",
                "neto": Decimal("1000000"),
                "iva": Decimal("0"),
                "total": Decimal("1000000"),
            }
        )


def test_montos_desde_fila_no_confunde_un_cero_legitimo_con_ausencia() -> None:
    # La trampa del cero falso: con `or`, un total_a_pagar de 0 caería al total y el
    # asiento propondría girar plata que la OC no debe.
    oc = montos_desde_fila(
        {
            "tipo_documento": "HONORARIOS",
            "neto": Decimal("1000"),
            "iva": 0,
            "total": Decimal("1000"),
            "retencion_monto": Decimal("1000"),
            "total_a_pagar": Decimal("0"),
        }
    )
    assert oc.total_a_pagar == 0


def test_el_fallback_de_total_a_pagar_no_tapa_una_oc_de_honorarios_rota() -> None:
    # Si `total_a_pagar` viene NULL en una OC CON retención, caer a `total` daría un
    # líquido igual al bruto. No pasa en silencio: la verificación de la identidad lo
    # levanta antes de armar ninguna línea.
    oc = montos_desde_fila(
        {
            "tipo_documento": "HONORARIOS",
            "neto": Decimal("1000000"),
            "iva": 0,
            "total": Decimal("1000000"),
            "retencion_monto": Decimal("152500"),
            "total_a_pagar": None,
        }
    )
    with pytest.raises(ValueError, match="líquido"):
        proponer_asiento(oc)
