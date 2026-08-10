from __future__ import annotations

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import pytest

from app.domain.value_objects.retencion import (
    ESCALA_RETENCION_HONORARIOS,
    IVA_PORCENTAJE_GENERAL,
    IVA_TRATAMIENTO_POR_TIPO,
    TIPOS_DOCUMENTO,
    TotalesOC,
    bruto_desde_liquido,
    calcular_liquido,
    calcular_retencion,
    calcular_totales,
    iva_tratamiento,
    normalizar_porcentajes,
    porcentaje_a_tasa,
    porcentaje_retencion_por_fecha,
)

# Porcentaje (lo que guarda la OC y ve el operador) vs tasa (lo que comen las
# primitivas). Los tests los escriben separados a propósito: si algún día alguien
# cambia la convención de una función, este archivo no compila en vez de calcular
# 100 veces de más.
PCT_2026 = Decimal("15.25")
TASA_2026 = Decimal("0.1525")

TODAS_LAS_TASAS = [
    Decimal("0.1375"),
    Decimal("0.1450"),
    Decimal("0.1525"),
    Decimal("0.1600"),
    Decimal("0.1700"),
]


def test_porcentaje_a_tasa_es_el_puente_entre_las_dos_unidades() -> None:
    assert porcentaje_a_tasa(PCT_2026) == TASA_2026


# ---------------------------------------------------------------------------
# Escala de tasas por año (fallback del `core.tax_config`)
# ---------------------------------------------------------------------------


def test_escala_es_la_del_art_74_n2_segun_ley_21133() -> None:
    # El SUPER_PROMPT_MAESTRO decía 13,75 % y lo etiquetaba "tabla 2026": ésa es
    # la tasa de 2024. La escala real es la de la Ley 21.133.
    escala_de_la_ley = (
        (date(2024, 1, 1), Decimal("13.75")),
        (date(2025, 1, 1), Decimal("14.50")),
        (date(2026, 1, 1), Decimal("15.25")),
        (date(2027, 1, 1), Decimal("16.00")),
        (date(2028, 1, 1), Decimal("17.00")),
    )
    assert ESCALA_RETENCION_HONORARIOS == escala_de_la_ley


@pytest.mark.parametrize(
    ("fecha", "esperado"),
    [
        (date(2024, 6, 30), Decimal("13.75")),
        (date(2025, 6, 30), Decimal("14.50")),
        (date(2026, 6, 30), Decimal("15.25")),
        (date(2027, 6, 30), Decimal("16.00")),
        (date(2028, 6, 30), Decimal("17.00")),
    ],
)
def test_porcentaje_por_fecha_para_cada_anio(fecha: date, esperado: Decimal) -> None:
    assert porcentaje_retencion_por_fecha(fecha) == esperado


@pytest.mark.parametrize(
    ("fecha", "esperado"),
    [
        (date(2024, 1, 1), Decimal("13.75")),
        (date(2025, 12, 31), Decimal("14.50")),
        (date(2026, 1, 1), Decimal("15.25")),
        (date(2026, 12, 31), Decimal("15.25")),
        (date(2027, 1, 1), Decimal("16.00")),
    ],
)
def test_la_tasa_cambia_exactamente_el_1_de_enero(fecha: date, esperado: Decimal) -> None:
    """Una OC emitida el 31/12 retiene con la tasa del año que termina."""
    assert porcentaje_retencion_por_fecha(fecha) == esperado


def test_la_escala_se_extiende_hacia_adelante() -> None:
    # 17 % es la tasa de régimen permanente, no un tope que caduca en 2028.
    assert porcentaje_retencion_por_fecha(date(2035, 3, 1)) == Decimal("17.00")


def test_la_escala_no_extrapola_hacia_atras() -> None:
    # Antes de 2024 la ley traía otros valores. Devolver 13,75 % sería inventar
    # un dato tributario; preferimos que reviente y lo resuelva una persona.
    with pytest.raises(ValueError, match="escala documentada arranca"):
        porcentaje_retencion_por_fecha(date(2023, 12, 31))


def test_porcentaje_por_fecha_sin_fecha_usa_hoy() -> None:
    assert porcentaje_retencion_por_fecha() == porcentaje_retencion_por_fecha(date.today())


def test_devuelve_porcentaje_y_no_tasa() -> None:
    # Si alguna vez devolviera 0.1525, la OC guardaría 0,15 % de retención.
    assert porcentaje_retencion_por_fecha(date(2026, 6, 1)) > Decimal("1")


# ---------------------------------------------------------------------------
# Retención y líquido
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("bruto", "tasa", "esperado"),
    [
        (Decimal("1000000"), TASA_2026, Decimal("152500")),
        (Decimal("1000000"), Decimal("0.1375"), Decimal("137500")),
        (Decimal("1000000"), Decimal("0.17"), Decimal("170000")),
        (Decimal("500000"), TASA_2026, Decimal("76250")),
    ],
)
def test_calcular_retencion(bruto: Decimal, tasa: Decimal, esperado: Decimal) -> None:
    assert calcular_retencion(bruto, tasa) == esperado
    assert calcular_liquido(bruto, tasa) == bruto - esperado


def test_retencion_redondea_half_up_a_peso() -> None:
    # 1.000.600 al 15,25 % = 152.591,5 exacto -> HALF_UP sube a 152.592.
    assert calcular_retencion(Decimal("1000600"), TASA_2026) == Decimal("152592")


def test_identidad_de_redondeo_con_medio_peso() -> None:
    """El caso que rompe si se redondean las dos cifras por separado."""
    bruto = Decimal("1000600")
    retencion = calcular_retencion(bruto, TASA_2026)
    liquido = calcular_liquido(bruto, TASA_2026)

    assert retencion == Decimal("152592")
    assert liquido == Decimal("848008")
    assert liquido + retencion == bruto

    # Si el líquido se calculara con fórmula propia daría 848.009 y la suma se
    # iría un peso arriba del bruto. Este assert existe para que el día que
    # alguien "simplifique" `calcular_liquido`, el test le explique por qué no.
    ingenuo = (bruto * (Decimal("1") - TASA_2026)).quantize(
        Decimal("1"), rounding=ROUND_HALF_UP
    )
    assert ingenuo == Decimal("848009")
    assert ingenuo != liquido


@pytest.mark.parametrize("tasa", TODAS_LAS_TASAS)
def test_identidad_cierra_para_todo_monto(tasa: Decimal) -> None:
    # Barrido chico pero denso: cualquier resto de redondeo aparece acá.
    for bruto_int in range(999_950, 1_000_050):
        bruto = Decimal(bruto_int)
        assert calcular_liquido(bruto, tasa) + calcular_retencion(bruto, tasa) == bruto


def test_identidad_cierra_tambien_con_decimales() -> None:
    # Moneda extranjera: el bruto trae decimales y el líquido los arrastra.
    bruto = Decimal("1000000.50")
    assert calcular_liquido(bruto, TASA_2026) + calcular_retencion(bruto, TASA_2026) == bruto


# ---------------------------------------------------------------------------
# Gross-up
# ---------------------------------------------------------------------------


def test_gross_up_del_caso_del_contrato() -> None:
    # "Te pago $1.000.000" casi siempre es el LÍQUIDO: el bruto es 1.179.941.
    assert bruto_desde_liquido(Decimal("1000000"), TASA_2026) == Decimal("1179941")


def test_gross_up_ida_y_vuelta_cierra_exacto() -> None:
    """`líquido -> bruto -> líquido` vuelve al mismo peso para montos enteros."""
    for liquido_int in (1, 999, 100_000, 847_500, 1_000_000, 3_333_333):
        liquido = Decimal(liquido_int)
        bruto = bruto_desde_liquido(liquido, TASA_2026)
        assert calcular_liquido(bruto, TASA_2026) == liquido


@pytest.mark.parametrize("tasa", TODAS_LAS_TASAS)
def test_gross_up_ida_y_vuelta_para_toda_la_escala(tasa: Decimal) -> None:
    for liquido_int in range(1, 400):
        liquido = Decimal(liquido_int)
        assert calcular_liquido(bruto_desde_liquido(liquido, tasa), tasa) == liquido


def test_gross_up_al_reves_no_es_reversible_y_esta_bien() -> None:
    """`bruto -> líquido -> bruto` puede devolver otro bruto. Es esperable.

    1.200.003 y 1.200.004 pagan los dos 1.017.003 líquidos, así que desde el
    líquido no hay forma de saber cuál era el original. El dato contractual es el
    bruto: es lo que se firma y la base de la boleta de honorarios.
    """
    assert calcular_liquido(Decimal("1200003"), TASA_2026) == Decimal("1017003")
    assert calcular_liquido(Decimal("1200004"), TASA_2026) == Decimal("1017003")
    assert bruto_desde_liquido(Decimal("1017003"), TASA_2026) == Decimal("1200004")


# ---------------------------------------------------------------------------
# Bordes de la tasa y errores de unidad
# ---------------------------------------------------------------------------


def test_tasa_cero_no_retiene_nada() -> None:
    bruto = Decimal("1000000")
    assert calcular_retencion(bruto, Decimal("0")) == Decimal("0")
    assert calcular_liquido(bruto, Decimal("0")) == bruto
    # Sin retención, el gross-up es la identidad.
    assert bruto_desde_liquido(bruto, Decimal("0")) == bruto


def test_tasa_cien_por_ciento_se_lleva_todo() -> None:
    bruto = Decimal("1000000")
    assert calcular_retencion(bruto, Decimal("1")) == bruto
    assert calcular_liquido(bruto, Decimal("1")) == Decimal("0")


def test_gross_up_con_tasa_cien_por_ciento_no_existe() -> None:
    with pytest.raises(ValueError, match="no existe un bruto finito"):
        bruto_desde_liquido(Decimal("1000000"), Decimal("1"))


@pytest.mark.parametrize("funcion", [calcular_retencion, calcular_liquido, bruto_desde_liquido])
def test_pasar_el_porcentaje_en_lugar_de_la_tasa_revienta(funcion: object) -> None:
    """15.25 donde va 0.1525 retendría 1525 %. Tiene que gritar, no calcular."""
    with pytest.raises(ValueError, match="porcentaje_a_tasa"):
        funcion(Decimal("1000000"), PCT_2026)  # type: ignore[operator]


@pytest.mark.parametrize("tasa", [Decimal("-0.0001"), Decimal("-0.1525")])
def test_tasa_negativa_revienta(tasa: Decimal) -> None:
    with pytest.raises(ValueError, match="no puede ser negativa"):
        calcular_retencion(Decimal("1000000"), tasa)


# ---------------------------------------------------------------------------
# Los cuatro tipos de documento
# ---------------------------------------------------------------------------


def test_tokens_son_los_del_catalogo_sii() -> None:
    # Nada de BOLETA_HONORARIOS ni FACTURA_EXENTA_ELECTRONICA: el mapeo
    # OC -> voucher.doc_tributario_tipo es la identidad.
    assert TIPOS_DOCUMENTO == ("FACTURA", "FACTURA_EXENTA", "BOLETA", "HONORARIOS")


def test_iva_general_es_porcentaje_no_tasa() -> None:
    diecinueve_por_ciento = Decimal("19.00")
    assert IVA_PORCENTAJE_GENERAL == diecinueve_por_ciento


@pytest.mark.parametrize(
    ("tipo", "esperado"),
    [
        ("FACTURA", "AFECTO"),
        ("BOLETA", "AFECTO"),
        ("FACTURA_EXENTA", "EXENTO"),
        ("HONORARIOS", "NO_GRAVADO"),
    ],
)
def test_iva_tratamiento_por_tipo(tipo: str, esperado: str) -> None:
    # Exento no es afecto al 0 %: se declaran en líneas distintas del F29 y del RCV.
    assert iva_tratamiento(tipo) == esperado
    assert IVA_TRATAMIENTO_POR_TIPO[tipo] == esperado


@pytest.mark.parametrize(
    ("tipo", "iva_pct", "ret_pct", "esperado"),
    [
        (
            "FACTURA",
            Decimal("19"),
            None,
            TotalesOC(
                total_neto=Decimal("1000000"),
                iva=Decimal("190000"),
                total=Decimal("1190000"),
                retencion_monto=Decimal("0"),
                total_a_pagar=Decimal("1190000"),
            ),
        ),
        (
            "BOLETA",
            Decimal("19"),
            None,
            TotalesOC(
                total_neto=Decimal("1000000"),
                iva=Decimal("190000"),
                total=Decimal("1190000"),
                retencion_monto=Decimal("0"),
                total_a_pagar=Decimal("1190000"),
            ),
        ),
        (
            "FACTURA_EXENTA",
            None,
            None,
            TotalesOC(
                total_neto=Decimal("1000000"),
                iva=Decimal("0"),
                total=Decimal("1000000"),
                retencion_monto=Decimal("0"),
                total_a_pagar=Decimal("1000000"),
            ),
        ),
        (
            "HONORARIOS",
            None,
            PCT_2026,
            TotalesOC(
                total_neto=Decimal("1000000"),
                iva=Decimal("0"),
                total=Decimal("1000000"),
                retencion_monto=Decimal("152500"),
                total_a_pagar=Decimal("847500"),
            ),
        ),
    ],
)
def test_calcular_totales_los_cuatro_tipos(
    tipo: str, iva_pct: Decimal | None, ret_pct: Decimal | None, esperado: TotalesOC
) -> None:
    assert calcular_totales(tipo, Decimal("1000000"), iva_pct, ret_pct) == esperado


def test_total_conserva_su_semantica_historica() -> None:
    """`total = total_neto + iva` en los cuatro tipos; `total_a_pagar` va al lado."""
    for tipo in TIPOS_DOCUMENTO:
        ret = PCT_2026 if tipo == "HONORARIOS" else None
        t = calcular_totales(tipo, Decimal("1000000"), retencion_porcentaje=ret)
        assert t.total == t.total_neto + t.iva
        assert t.total_a_pagar + t.retencion_monto == t.total


def test_solo_honorarios_separa_total_de_total_a_pagar() -> None:
    for tipo in ("FACTURA", "BOLETA", "FACTURA_EXENTA"):
        t = calcular_totales(tipo, Decimal("1000000"))
        assert t.total_a_pagar == t.total
        assert t.retencion_monto == Decimal("0")

    honorarios = calcular_totales("HONORARIOS", Decimal("1000000"), retencion_porcentaje=PCT_2026)
    assert honorarios.total_a_pagar < honorarios.total


def test_totales_se_desempaquetan_en_el_orden_del_contrato() -> None:
    total_neto, iva, total, retencion_monto, total_a_pagar = calcular_totales(
        "HONORARIOS", Decimal("1000000"), retencion_porcentaje=PCT_2026
    )
    assert (total_neto, iva, total, retencion_monto, total_a_pagar) == (
        Decimal("1000000"),
        Decimal("0"),
        Decimal("1000000"),
        Decimal("152500"),
        Decimal("847500"),
    )


def test_iva_redondea_half_up_dentro_de_los_totales() -> None:
    # 100.050 al 19 % = 19.009,5 exacto -> 19.010.
    t = calcular_totales("FACTURA", Decimal("100050"), Decimal("19"))
    assert t.iva == Decimal("19010")
    assert t.total == Decimal("119060")


def test_subtotal_no_se_redondea() -> None:
    # El neto llega como lo dejó la suma de las líneas; tocarlo sería cambiar el
    # itemizado a espaldas del operador.
    t = calcular_totales("FACTURA_EXENTA", Decimal("100000.40"))
    assert t.total_neto == Decimal("100000.40")
    assert t.total == Decimal("100000.40")


def test_identidad_cierra_en_honorarios_con_medio_peso() -> None:
    t = calcular_totales("HONORARIOS", Decimal("1000600"), retencion_porcentaje=PCT_2026)
    assert t.retencion_monto == Decimal("152592")
    assert t.total_a_pagar == Decimal("848008")
    assert t.total_a_pagar + t.retencion_monto == t.total


# ---------------------------------------------------------------------------
# Coherencia: qué se pisa y qué se rechaza
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("tipo", ["FACTURA_EXENTA", "HONORARIOS"])
def test_iva_se_pisa_a_cero_en_exentas_y_honorarios(tipo: str) -> None:
    """Dejar un 19 viejo al cambiar el tipo es un descuido: se corrige, no se rechaza."""
    ret = PCT_2026 if tipo == "HONORARIOS" else None
    t = calcular_totales(tipo, Decimal("1000000"), Decimal("19"), ret)
    assert t.iva == Decimal("0")
    assert t.total == Decimal("1000000")

    iva_efectivo, _ = normalizar_porcentajes(tipo, Decimal("19"), ret)
    assert iva_efectivo == Decimal("0")


@pytest.mark.parametrize("tipo", ["FACTURA", "BOLETA"])
def test_retencion_en_documento_afecto_se_rechaza(tipo: str) -> None:
    """Mandar retención en una factura afecta no es un descuido: es una afirmación falsa."""
    with pytest.raises(ValueError, match="no lleva retención"):
        calcular_totales(tipo, Decimal("1000000"), Decimal("19"), PCT_2026)


@pytest.mark.parametrize("tipo", ["FACTURA", "BOLETA", "FACTURA_EXENTA"])
def test_retencion_cero_explicita_no_molesta_donde_no_hay_retencion(tipo: str) -> None:
    t = calcular_totales(tipo, Decimal("1000000"), retencion_porcentaje=Decimal("0"))
    assert t.retencion_monto == Decimal("0")


def test_tipo_de_documento_desconocido_revienta() -> None:
    with pytest.raises(ValueError, match="Tipo de documento desconocido"):
        calcular_totales("BOLETA_HONORARIOS", Decimal("1000000"))


@pytest.mark.parametrize("porcentaje", [Decimal("-0.01"), Decimal("100.01")])
def test_porcentaje_fuera_de_rango_revienta(porcentaje: Decimal) -> None:
    with pytest.raises(ValueError, match="entre 0 y 100"):
        calcular_totales("HONORARIOS", Decimal("1000000"), retencion_porcentaje=porcentaje)


# ---------------------------------------------------------------------------
# El cero NO es ausencia (§3.4 — la trampa del cero falso)
# ---------------------------------------------------------------------------


def test_iva_cero_explicito_no_cae_al_default_de_19() -> None:
    t = calcular_totales("FACTURA", Decimal("1000000"), iva_porcentaje=Decimal("0"))
    assert t.iva == Decimal("0")
    assert t.total == Decimal("1000000")


def test_iva_none_si_cae_al_default_de_19() -> None:
    t = calcular_totales("FACTURA", Decimal("1000000"), iva_porcentaje=None)
    assert t.iva == Decimal("190000")


def test_retencion_cero_explicita_en_honorarios_no_cae_a_la_tasa_vigente() -> None:
    """Una OC de honorarios con retención 0 retiene 0, no 15,25 %."""
    t = calcular_totales("HONORARIOS", Decimal("1000000"), retencion_porcentaje=Decimal("0"))
    assert t.retencion_monto == Decimal("0")
    assert t.total_a_pagar == t.total


def test_retencion_none_en_honorarios_cae_a_la_tasa_de_la_fecha() -> None:
    t = calcular_totales(
        "HONORARIOS",
        Decimal("1000000"),
        retencion_porcentaje=None,
        fecha_emision=date(2027, 3, 1),
    )
    # Fecha 2027 -> 16 %, no la de 2026. La tasa la fija la fecha de emisión.
    assert t.retencion_monto == Decimal("160000")
    assert t.total_a_pagar == Decimal("840000")


@pytest.mark.parametrize(
    ("fecha", "esperado"),
    [
        (date(2024, 5, 1), Decimal("13.75")),
        (date(2025, 5, 1), Decimal("14.50")),
        (date(2026, 5, 1), Decimal("15.25")),
        (date(2027, 5, 1), Decimal("16.00")),
        (date(2028, 5, 1), Decimal("17.00")),
    ],
)
def test_normalizar_porcentajes_toma_la_tasa_del_anio_de_emision(
    fecha: date, esperado: Decimal
) -> None:
    iva_pct, ret_pct = normalizar_porcentajes("HONORARIOS", fecha_emision=fecha)
    assert iva_pct == Decimal("0")
    assert ret_pct == esperado


def test_normalizar_porcentajes_respeta_el_snapshot_de_la_oc() -> None:
    """Invariante 5: si la OC ya guardó 15,25 %, no se re-deriva por la fecha."""
    _, ret_pct = normalizar_porcentajes(
        "HONORARIOS", retencion_porcentaje=PCT_2026, fecha_emision=date(2028, 5, 1)
    )
    assert ret_pct == PCT_2026
