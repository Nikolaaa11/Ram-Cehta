from __future__ import annotations

import pytest

from app.domain.value_objects.periodo import Periodo


def test_parse_periodo_valido() -> None:
    p = Periodo.parse("02_26")
    assert p.mes == 2
    assert p.anio == 26
    assert p.anio_completo == 2026
    assert str(p) == "02_26"


@pytest.mark.parametrize("raw", ["2_26", "13_25", "00_26", "abcd", ""])
def test_parse_periodo_invalido(raw: str) -> None:
    with pytest.raises(ValueError, match="Período inválido"):
        Periodo.parse(raw)
