"""Tests para los helpers puros de app.api.v1.dashboard.

Sólo lógica sin DB: delta porcentual, conversión de periodo a fecha,
shift de periodos y saldo acumulado.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.api.v1.dashboard import (
    MAX_MESES_RANGO,
    acumular_saldo,
    calc_delta_pct,
    periodo_to_fecha_inicio,
    periodos_en_rango,
    rango_fechas,
    shift_periodo,
    ventanas_comparables,
)


# ---------------------------------------------------------------------
# calc_delta_pct
# ---------------------------------------------------------------------
class TestCalcDeltaPct:
    def test_crecimiento_positivo(self) -> None:
        assert calc_delta_pct(Decimal("150"), Decimal("100")) == 50.0

    def test_decrecimiento(self) -> None:
        assert calc_delta_pct(Decimal("50"), Decimal("100")) == -50.0

    def test_sin_cambio(self) -> None:
        assert calc_delta_pct(Decimal("100"), Decimal("100")) == 0.0

    def test_anterior_cero_y_actual_cero(self) -> None:
        # NULL safety: ambos cero => 0.0, no NaN
        assert calc_delta_pct(Decimal("0"), Decimal("0")) == 0.0

    def test_anterior_cero_y_actual_positivo(self) -> None:
        # crecimiento desde cero — convención: 100%
        assert calc_delta_pct(Decimal("500"), Decimal("0")) == 100.0

    def test_anterior_none_safe(self) -> None:
        # type-wise sólo recibimos Decimal, pero la función debe ser robusta
        assert calc_delta_pct(Decimal("100"), None) == 100.0  # type: ignore[arg-type]

    def test_actual_none_safe(self) -> None:
        assert calc_delta_pct(None, Decimal("100")) == -100.0  # type: ignore[arg-type]

    def test_redondeo_a_dos_decimales(self) -> None:
        # 33.333...% -> 33.33
        assert calc_delta_pct(Decimal("400"), Decimal("300")) == 33.33


# ---------------------------------------------------------------------
# periodo_to_fecha_inicio
# ---------------------------------------------------------------------
class TestPeriodoToFechaInicio:
    def test_periodo_estandar(self) -> None:
        assert periodo_to_fecha_inicio("04_26") == date(2026, 4, 1)

    def test_enero(self) -> None:
        assert periodo_to_fecha_inicio("01_25") == date(2025, 1, 1)

    def test_diciembre(self) -> None:
        assert periodo_to_fecha_inicio("12_24") == date(2024, 12, 1)

    def test_periodo_invalido_lanza(self) -> None:
        with pytest.raises(ValueError):
            periodo_to_fecha_inicio("13_26")


# ---------------------------------------------------------------------
# shift_periodo
# ---------------------------------------------------------------------
class TestShiftPeriodo:
    def test_un_mes_atras(self) -> None:
        assert shift_periodo("04_26", -1) == "03_26"

    def test_un_mes_adelante(self) -> None:
        assert shift_periodo("04_26", 1) == "05_26"

    def test_cruza_anio_atras(self) -> None:
        # enero 2026 - 1 mes = diciembre 2025
        assert shift_periodo("01_26", -1) == "12_25"

    def test_cruza_anio_adelante(self) -> None:
        # diciembre 2025 + 1 mes = enero 2026
        assert shift_periodo("12_25", 1) == "01_26"

    def test_doce_meses_atras(self) -> None:
        assert shift_periodo("04_26", -12) == "04_25"


# ---------------------------------------------------------------------
# acumular_saldo
# ---------------------------------------------------------------------
class TestAcumularSaldo:
    def test_lista_vacia(self) -> None:
        assert acumular_saldo([]) == []

    def test_un_punto(self) -> None:
        assert acumular_saldo([(Decimal("100"), Decimal("30"))]) == [Decimal("70")]

    def test_acumulado_creciente(self) -> None:
        pares = [
            (Decimal("100"), Decimal("0")),
            (Decimal("50"), Decimal("0")),
            (Decimal("0"), Decimal("30")),
        ]
        assert acumular_saldo(pares) == [
            Decimal("100"),
            Decimal("150"),
            Decimal("120"),
        ]

    def test_con_saldo_inicial(self) -> None:
        pares = [(Decimal("10"), Decimal("0"))]
        assert acumular_saldo(pares, saldo_inicial=Decimal("1000")) == [Decimal("1010")]

    def test_none_se_trata_como_cero(self) -> None:
        # Robustez: si una row trae NULL en abono o egreso no debe romper
        pares = [(None, Decimal("50")), (Decimal("100"), None)]  # type: ignore[list-item]
        assert acumular_saldo(pares) == [Decimal("-50"), Decimal("50")]


# ---------------------------------------------------------------------
# R152kk — rango de período del dashboard (?from=YYYY-MM&to=YYYY-MM)
# ---------------------------------------------------------------------
class TestPeriodosEnRango:
    def test_rango_simple(self) -> None:
        assert periodos_en_rango("2026-01", "2026-03") == ["01_26", "02_26", "03_26"]

    def test_mismo_mes(self) -> None:
        assert periodos_en_rango("2026-08", "2026-08") == ["08_26"]

    def test_cruza_anio(self) -> None:
        assert periodos_en_rango("2025-11", "2026-02") == [
            "11_25",
            "12_25",
            "01_26",
            "02_26",
        ]

    def test_invertido_se_ordena(self) -> None:
        # El usuario puede tipear "desde" mayor que "hasta" en el custom range.
        assert periodos_en_rango("2026-03", "2026-01") == ["01_26", "02_26", "03_26"]

    def test_rango_gigante_se_recorta_a_los_ultimos_n(self) -> None:
        out = periodos_en_rango("2015-01", "2026-08")
        assert out is not None
        assert len(out) == MAX_MESES_RANGO
        assert out[-1] == "08_26"  # conserva el extremo reciente

    @pytest.mark.parametrize(
        "desde,hasta",
        [
            (None, "2026-02"),
            ("2026-02", None),
            ("2026-13", "2026-02"),  # mes inexistente
            ("26-02", "2026-03"),  # año de 2 dígitos
            ("", ""),
            ("basura", "2026-03"),
        ],
    )
    def test_entradas_invalidas_devuelven_none(
        self, desde: str | None, hasta: str | None
    ) -> None:
        # None = "no hay rango usable" → el endpoint cae a su default.
        assert periodos_en_rango(desde, hasta) is None


class TestVentanasComparables:
    def test_ventana_anterior_del_mismo_largo(self) -> None:
        actual, previo = ventanas_comparables("2026-06", "2026-08")
        assert actual == ["06_26", "07_26", "08_26"]
        assert previo == ["03_26", "04_26", "05_26"]

    def test_un_mes_compara_contra_el_anterior(self) -> None:
        actual, previo = ventanas_comparables("2026-01", "2026-01")
        assert actual == ["01_26"]
        assert previo == ["12_25"]

    def test_sin_rango_usa_mes_actual(self) -> None:
        actual, previo = ventanas_comparables(None, None)
        assert len(actual) == 1
        assert len(previo) == 1
        assert previo[0] == shift_periodo(actual[0], -1)


class TestRangoFechas:
    def test_fin_es_exclusivo_primer_dia_del_mes_siguiente(self) -> None:
        assert rango_fechas("2026-01", "2026-03") == (date(2026, 1, 1), date(2026, 4, 1))

    def test_diciembre_cruza_a_enero(self) -> None:
        assert rango_fechas("2025-12", "2025-12") == (date(2025, 12, 1), date(2026, 1, 1))

    def test_sin_rango_valido_devuelve_none(self) -> None:
        assert rango_fechas(None, "2026-03") is None
