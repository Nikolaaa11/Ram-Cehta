"""Tests para los helpers puros del CEO Dashboard (V3 fase 3+4).

Sólo lógica sin DB: health score, trend y heatmap color mapping.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.api.v1.dashboard import (
    color_for_score,
    compute_health_score,
    trend_from_flujo,
)


class TestComputeHealthScore:
    def test_empresa_perfecta(self) -> None:
        assert (
            compute_health_score(
                saldo_contable=Decimal("100000000"),
                flujo_neto_30d=Decimal("5000000"),
                f29_vencidas=0,
                f29_proximas=0,
                oc_pendientes=2,
            )
            == 100
        )

    def test_f29_vencidas_descontadas(self) -> None:
        # 1 vencida = -25
        assert (
            compute_health_score(
                Decimal("100000000"), Decimal("0"), 1, 0, 0
            )
            == 75
        )

    def test_f29_vencidas_capeado(self) -> None:
        # 5 vencidas → cap a -50
        assert (
            compute_health_score(
                Decimal("100000000"), Decimal("0"), 5, 0, 0
            )
            == 50
        )

    def test_f29_proximas_solo_si_no_hay_vencidas(self) -> None:
        # Si hay vencidas, las próximas no se descuentan (ya descontaron)
        score_sin_vencidas = compute_health_score(
            Decimal("100000000"), Decimal("0"), 0, 2, 0
        )
        score_con_vencidas = compute_health_score(
            Decimal("100000000"), Decimal("0"), 1, 2, 0
        )
        assert score_sin_vencidas == 90  # -10 por 2 próximas
        assert score_con_vencidas == 75  # -25 por la vencida, próximas no se suman

    def test_flujo_negativo_descontado(self) -> None:
        assert (
            compute_health_score(
                Decimal("100000000"), Decimal("-100000"), 0, 0, 0
            )
            == 80
        )

    def test_saldo_no_positivo_descontado(self) -> None:
        assert (
            compute_health_score(Decimal("0"), Decimal("0"), 0, 0, 0)
            == 75
        )
        assert (
            compute_health_score(Decimal("-100"), Decimal("0"), 0, 0, 0)
            == 75
        )

    def test_oc_pendientes_grandes(self) -> None:
        # >10 OCs es señal de carga operativa
        assert (
            compute_health_score(
                Decimal("100000000"), Decimal("0"), 0, 0, 11
            )
            == 90
        )

    def test_score_no_negativo(self) -> None:
        # Combinación catastrófica
        score = compute_health_score(
            saldo_contable=Decimal("-1"),
            flujo_neto_30d=Decimal("-1"),
            f29_vencidas=10,
            f29_proximas=10,
            oc_pendientes=50,
        )
        assert score == 0

    def test_score_no_supera_100(self) -> None:
        score = compute_health_score(
            Decimal("999999999"), Decimal("999999"), 0, 0, 0
        )
        assert score == 100


class TestTrendFromFlujo:
    def test_flujo_positivo(self) -> None:
        assert trend_from_flujo(Decimal("100")) == "up"

    def test_flujo_negativo(self) -> None:
        assert trend_from_flujo(Decimal("-100")) == "down"

    def test_flujo_cero(self) -> None:
        assert trend_from_flujo(Decimal("0")) == "flat"


class TestColorForScore:
    @pytest.mark.parametrize("v", [80, 90, 100])
    def test_green(self, v: int) -> None:
        assert color_for_score(v) == "green"

    @pytest.mark.parametrize("v", [60, 65, 79])
    def test_yellow(self, v: int) -> None:
        assert color_for_score(v) == "yellow"

    @pytest.mark.parametrize("v", [0, 30, 59])
    def test_red(self, v: int) -> None:
        assert color_for_score(v) == "red"
