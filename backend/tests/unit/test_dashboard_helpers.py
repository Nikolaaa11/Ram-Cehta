"""Tests para los helpers puros de app.api.v1.dashboard.

Sólo lógica sin DB: delta porcentual, conversión de periodo a fecha,
shift de periodos y saldo acumulado.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.api.v1.dashboard import (
    acumular_saldo,
    calc_delta_pct,
    periodo_to_fecha_inicio,
    shift_periodo,
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
