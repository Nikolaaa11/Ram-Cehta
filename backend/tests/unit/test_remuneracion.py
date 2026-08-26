"""Motor de remuneraciones — calibrado contra el libro REAL del contador.

Los golden tests no son inventados: reproducen líneas del libro de
remuneraciones de MCG Consultores (AFIS, abril 2026) que está cargado en
`core.libro_remuneraciones_lineas`. Si el motor no reproduce al contador,
el motor está mal — no al revés.

De ese libro se descifró: IMM $539.000, UTM abril $69.889, SIS 1,62 %,
reforma 0,1+0,9 %, mutual AFIS 2,63 %, comisión AFP 1,44 %.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.domain.value_objects.remuneracion import (
    TRAMOS_IMPUESTO_UTM,
    EntradaLiquidacion,
    ParametroFaltanteError,
    ParametrosMes,
    calcular_liquidacion,
    gratificacion_art50,
    impuesto_unico,
    valor_hora_extra,
)

UTM_ABRIL_2026 = Decimal("69889")


def _params(**kw) -> ParametrosMes:
    base = dict(
        periodo="2026-04",
        uf=Decimal("39000"),
        utm=UTM_ABRIL_2026,
        ingreso_minimo=Decimal("539000"),
        comisiones_afp={"CAPITAL": Decimal("1.44"), "MODELO": Decimal("0.58")},
        asignacion_familiar=(
            (Decimal("620251"), Decimal("22007")),
            (Decimal("905941"), Decimal("13505")),
            (Decimal("1412957"), Decimal("4267")),
            (None, Decimal("0")),
        ),
    )
    base.update(kw)
    return ParametrosMes(**base)


# ──────────────────────────────────────────────────────────────────────
# GOLDEN MAESTRO — la línea completa de Claudia Gotschlich (libro MCG)
# ──────────────────────────────────────────────────────────────────────


def test_la_linea_real_de_claudia_cierra_exacta():
    """Sueldo 1.986.646, Fonasa, AFP 1,44 %, indefinida, 30 días.

    Cada número de este test está COPIADO del libro de MCG, no calculado a
    mano. Si alguno deja de cuadrar, el motor dejó de reproducir al contador.
    """
    r = calcular_liquidacion(
        EntradaLiquidacion(
            sueldo_base=Decimal("1986646"),
            afp="Capital",
            salud_sistema="FONASA",
            mutual_pct_override=Decimal("2.63"),  # mutual de AFIS
        ),
        _params(),
    )
    assert r.gratificacion == Decimal("213354")
    assert r.total_imponible == Decimal("2200000")
    assert r.total_previsionales == Decimal("418880")
    assert r.base_tributable == Decimal("1781120")
    assert r.impuesto_unico == Decimal("33504.74")
    assert r.total_descuentos == Decimal("452385")
    assert r.liquido == Decimal("1747615")
    # Aportes del empleador, también del libro:
    assert r.afc_empleador == Decimal("52800")
    assert r.sis == Decimal("35640")
    assert r.reforma_cuenta_individual == Decimal("2200")
    assert r.reforma_seguro_social == Decimal("19800")
    assert r.mutual == Decimal("57860")


def test_el_impuesto_de_benjamin_cierra_al_centavo():
    # Segunda línea real del libro: base tributable 1.035.744 → 3.689,70.
    assert impuesto_unico(Decimal("1035744"), UTM_ABRIL_2026) == Decimal("3689.70")


# ──────────────────────────────────────────────────────────────────────
# Impuesto único
# ──────────────────────────────────────────────────────────────────────


def test_bajo_13_5_utm_es_exento():
    assert impuesto_unico(Decimal("500000"), UTM_ABRIL_2026) == Decimal("0.00")
    assert impuesto_unico(Decimal("0"), UTM_ABRIL_2026) == Decimal("0.00")


def test_el_impuesto_es_continuo_en_cada_borde_de_tramo():
    """La rebaja se DERIVA por continuidad; esto verifica que de verdad lo es.

    Un peso más de base no puede saltar el impuesto: en cada límite de tramo,
    calcular con la tasa de abajo y la de arriba da lo mismo.
    """
    utm = UTM_ABRIL_2026
    for limite, _ in TRAMOS_IMPUESTO_UTM[:-1]:
        base = (limite * utm).quantize(Decimal("0.01"))
        antes = impuesto_unico(base - Decimal("1"), utm)
        despues = impuesto_unico(base + Decimal("1"), utm)
        assert abs(despues - antes) < Decimal("1"), (
            f"salto de ${despues - antes} en el límite de {limite} UTM"
        )


def test_el_impuesto_nunca_es_negativo_ni_super_al_40_por_ciento():
    utm = UTM_ABRIL_2026
    for base in ("1", "1000000", "5000000", "10000000", "50000000"):
        imp = impuesto_unico(Decimal(base), utm)
        assert Decimal("0") <= imp < Decimal(base) * Decimal("0.40")


def test_sin_utm_no_se_adivina():
    with pytest.raises(ParametroFaltanteError, match="UTM"):
        impuesto_unico(Decimal("1000000"), Decimal("0"))


# ──────────────────────────────────────────────────────────────────────
# Gratificación y horas extra
# ──────────────────────────────────────────────────────────────────────


def test_gratificacion_tope_con_el_imm_del_libro():
    # 4,75 × 539.000 / 12 = 213.354,17 → 213.354: EXACTO lo que paga MCG.
    assert gratificacion_art50(Decimal("2000000"), Decimal("539000")) == Decimal("213354")


def test_gratificacion_25_por_ciento_cuando_no_llega_al_tope():
    assert gratificacion_art50(Decimal("600000"), Decimal("539000")) == Decimal("150000")


def test_hora_extra_con_la_jornada_de_42_de_la_ley_21561():
    # Desde abril 2026 la jornada es 42 h: el factor SUBE respecto del clásico
    # de 45 h. Usar el factor viejo paga de menos.
    v42 = valor_hora_extra(Decimal("1000000"), Decimal("42"))
    v45 = valor_hora_extra(Decimal("1000000"), Decimal("45"))
    assert v42 == Decimal("8333")
    assert v45 == Decimal("7778")
    assert v42 > v45


# ──────────────────────────────────────────────────────────────────────
# Las identidades cierran SIEMPRE (propiedad, no ejemplo)
# ──────────────────────────────────────────────────────────────────────

_CASOS_PROPIEDAD = [
    dict(sueldo_base=Decimal("529000"), afp="Modelo", cargas_familiares=2,
         colacion=Decimal("60000"), movilizacion=Decimal("50000")),
    dict(sueldo_base=Decimal("1500000"), afp="Capital", horas_extra=Decimal("10")),
    dict(sueldo_base=Decimal("4786646"), afp="Capital",
         salud_sistema="ISAPRE", isapre_plan_uf=Decimal("5.2")),
    dict(sueldo_base=Decimal("9000000"), afp="Capital"),  # supera el tope
    dict(sueldo_base=Decimal("800000"), afp="Modelo", tipo_contrato="PLAZO_FIJO"),
    dict(sueldo_base=Decimal("2000000"), afp="Capital", dias_trabajados=Decimal("15")),
    dict(sueldo_base=Decimal("1200000"), afp="Modelo", apv_mensual=Decimal("100000"),
         anticipos=Decimal("200000")),
]


@pytest.mark.parametrize("caso", _CASOS_PROPIEDAD)
def test_identidades(caso):
    r = calcular_liquidacion(EntradaLiquidacion(**caso), _params())
    assert r.total_haberes == r.total_imponible + r.total_no_imponible
    assert r.liquido == r.total_haberes - r.total_descuentos
    assert r.costo_empresa == r.total_haberes + r.total_aportes_empleador
    assert r.base_cotizaciones <= r.total_imponible
    assert r.base_tributable >= 0
    # Todo en pesos enteros salvo el impuesto (2 decimales, como MCG).
    for campo in ("liquido", "total_haberes", "total_descuentos", "sis", "mutual"):
        v = getattr(r, campo)
        assert v == v.to_integral_value(), f"{campo} con centavos: {v}"


def test_el_tope_imponible_topa():
    r = calcular_liquidacion(
        EntradaLiquidacion(sueldo_base=Decimal("9000000"), afp="Capital",
                           gratificacion_tipo="NINGUNA"),
        _params(),
    )
    assert r.base_cotizaciones == Decimal("87.8") * Decimal("39000")
    assert any("tope" in a for a in r.advertencias)


def test_plazo_fijo_no_descuenta_afc_al_trabajador():
    r = calcular_liquidacion(
        EntradaLiquidacion(sueldo_base=Decimal("800000"), afp="Modelo",
                           tipo_contrato="PLAZO_FIJO"),
        _params(),
    )
    assert r.afc_trabajador == 0
    # Y el empleador paga el 3,0 % completo.
    assert r.afc_empleador == (r.base_afc * Decimal("3.0") / 100).quantize(Decimal("1"))


def test_asignacion_familiar_por_tramo():
    r = calcular_liquidacion(
        EntradaLiquidacion(sueldo_base=Decimal("450000"), afp="Modelo",
                           gratificacion_tipo="NINGUNA", cargas_familiares=2),
        _params(),
    )
    assert r.asignacion_familiar == Decimal("44014")  # tramo A × 2
    # Renta alta → tramo D, $0, con aviso.
    r2 = calcular_liquidacion(
        EntradaLiquidacion(sueldo_base=Decimal("3000000"), afp="Capital",
                           cargas_familiares=1),
        _params(),
    )
    assert r2.asignacion_familiar == 0
    assert any("tramo D" in a for a in r2.advertencias)


# ──────────────────────────────────────────────────────────────────────
# El motor se niega antes que adivinar
# ──────────────────────────────────────────────────────────────────────


def test_sin_uf_se_niega():
    with pytest.raises(ParametroFaltanteError, match="UF"):
        calcular_liquidacion(
            EntradaLiquidacion(sueldo_base=Decimal("1000000"), afp="Capital"),
            _params(uf=None),
        )


def test_sin_afp_se_niega():
    with pytest.raises(ParametroFaltanteError, match="AFP"):
        calcular_liquidacion(
            EntradaLiquidacion(sueldo_base=Decimal("1000000"), afp=None),
            _params(),
        )


def test_afp_sin_comision_cargada_se_niega_y_dice_donde():
    with pytest.raises(ParametroFaltanteError, match="Previred"):
        calcular_liquidacion(
            EntradaLiquidacion(sueldo_base=Decimal("1000000"), afp="Cuprum"),
            _params(),
        )


def test_cargas_sin_tramos_se_niega():
    with pytest.raises(ParametroFaltanteError, match="asignación"):
        calcular_liquidacion(
            EntradaLiquidacion(sueldo_base=Decimal("500000"), afp="Modelo",
                               cargas_familiares=1),
            _params(asignacion_familiar=()),
        )


def test_isapre_con_plan_bajo_el_7_por_ciento_cobra_el_legal():
    r = calcular_liquidacion(
        EntradaLiquidacion(sueldo_base=Decimal("2000000"), afp="Capital",
                           salud_sistema="ISAPRE", isapre_plan_uf=Decimal("0.5")),
        _params(),
    )
    assert r.salud_adicional_isapre == 0
    assert any("7 %" in a for a in r.advertencias)
