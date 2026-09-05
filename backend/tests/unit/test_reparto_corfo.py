"""Reparto CORFO — los montos mandan, los porcentajes cierran exacto.

Fija la "SEPARACIÓN VALORES" del Excel de Claudia: un gasto se parte entre
Subsidio / Cehta-Ptec / Cehta / Trewaox y la suma tiene que ser el total al
centavo. Los casos con nombre de proveedor son filas REALES del Excel.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.domain.value_objects.reparto_corfo import (
    ESTADO_DESCUADRADO,
    ESTADO_OK,
    ESTADO_SIN_CLASIFICAR,
    FUENTES,
    RepartoInvalidoError,
    escalar_reparto,
    estado_reparto,
    normalizar_montos,
    pct_desde_montos,
    repartir_por_pct,
)

D = Decimal


def _suma(m: dict) -> Decimal:
    return sum(((v or D(0)) for v in m.values()), D(0))


# ── repartir_por_pct ─────────────────────────────────────────────────


def test_default_proyecto_50_20_30_cierra_exacto():
    m = repartir_por_pct("1000001", {"subsidio": 50, "cehta_ptec": 20, "cehta": 30})
    assert m == {
        "subsidio": D("500001.00"),  # 500000.5 HALF_UP
        "cehta_ptec": D("200000.00"),
        "cehta": D("300000.00"),
        "trewaox": D("0.00"),
    }
    assert _suma(m) == D("1000001.00")


def test_residuo_de_redondeo_va_a_la_fuente_mayor():
    m = repartir_por_pct(100, {"subsidio": "33.33", "cehta_ptec": "33.33", "cehta": "33.34"})
    assert m["subsidio"] == D("33.00")
    assert m["cehta_ptec"] == D("33.00")
    assert m["cehta"] == D("34.00")
    assert _suma(m) == D("100.00")


def test_centavos_del_total_los_absorbe_la_fuente_mayor():
    # Fila real: CAMILO SALAZAR ene-2026, total con decimales por conversión UF
    m = repartir_por_pct(
        "5645105.9504", {"subsidio": "35.43", "cehta_ptec": "60.05", "cehta": "4.52"}
    )
    assert _suma(m) == D("5645105.95")
    # los centavos cayeron en cehta_ptec (la mayor), las otras quedaron enteras
    assert m["cehta_ptec"] % 1 == D("0.95")
    assert m["subsidio"] % 1 == 0
    assert m["cehta"] % 1 == 0


def test_cien_por_ciento_una_sola_fuente():
    m = repartir_por_pct("9935822", {"subsidio": 100})
    assert m == {
        "subsidio": D("9935822.00"),
        "cehta_ptec": D("0.00"),
        "cehta": D("0.00"),
        "trewaox": D("0.00"),
    }


def test_empate_de_porcentajes_desempata_por_orden_canonico():
    m = repartir_por_pct(1, {"subsidio": 50, "cehta": 50})
    # 0.5 y 0.5 → HALF_UP da 1 y 1 = 2, residuo -1 → al primero en FUENTES
    assert _suma(m) == D("1.00")
    assert m["subsidio"] == D("0.00")
    assert m["cehta"] == D("1.00")


def test_total_cero_reparte_ceros():
    m = repartir_por_pct(0, {"subsidio": 100})
    assert _suma(m) == D("0")


@pytest.mark.parametrize(
    ("pcts", "fragmento"),
    [
        ({"subsidio": 50, "cehta": 30}, "suman 80%"),
        ({"subsidio": 60, "cehta": 60}, "suman 120%"),
        ({"subsidio": -10, "cehta": 110}, "entre 0 y 100"),
        ({"subsidio": 100, "otra": 0}, "desconocida"),
    ],
)
def test_porcentajes_invalidos_rechazan_con_mensaje(pcts, fragmento):
    with pytest.raises(RepartoInvalidoError) as exc:
        repartir_por_pct(1000, pcts)
    assert fragmento in str(exc.value)


def test_total_negativo_rechaza():
    with pytest.raises(RepartoInvalidoError):
        repartir_por_pct(-5, {"subsidio": 100})


def test_tolerancia_de_un_centesimo_en_la_suma():
    # 33.33 + 33.33 + 33.33 = 99.99 → dentro de la tolerancia, no explota
    m = repartir_por_pct(
        300, {"subsidio": "33.33", "cehta_ptec": "33.33", "cehta": "33.33"}
    )
    assert _suma(m) == D("300.00")


# ── estado_reparto ───────────────────────────────────────────────────


def test_estado_sin_clasificar_cuando_las_cuatro_son_none():
    assert estado_reparto(1000, None) == ESTADO_SIN_CLASIFICAR
    assert estado_reparto(1000, {"subsidio": None, "cehta": None}) == ESTADO_SIN_CLASIFICAR


def test_estado_ok_al_centavo():
    # Fila real: PROYECTA SPA dic-2025
    assert estado_reparto(590777, {"subsidio": 496451, "cehta": 94326}) == ESTADO_OK


def test_estado_descuadrado_por_un_peso():
    assert estado_reparto(590777, {"subsidio": 496451, "cehta": 94325}) == ESTADO_DESCUADRADO


def test_estado_ok_con_total_cero_y_ceros():
    assert estado_reparto(0, {"subsidio": 0}) == ESTADO_OK


# ── normalizar_montos ────────────────────────────────────────────────


def test_normalizar_todo_o_nada():
    assert normalizar_montos({"subsidio": 10}) == {
        "subsidio": D("10.00"),
        "cehta_ptec": D("0.00"),
        "cehta": D("0.00"),
        "trewaox": D("0.00"),
    }
    assert normalizar_montos({}) == {f: None for f in FUENTES}
    assert normalizar_montos({"subsidio": "", "cehta": None}) == {f: None for f in FUENTES}


# ── pct_desde_montos ─────────────────────────────────────────────────


def test_pct_desde_montos_cierra_100_cuando_reparto_ok():
    # Fila real: CAMILO SALAZAR ene-2026 (3 fuentes)
    p = pct_desde_montos(
        "5645105.9504",
        {"subsidio": 2000000, "cehta_ptec": 3390000, "cehta": "255105.9504"},
    )
    assert p is not None
    assert sum(p.values()) == D("100.00")
    assert p["cehta_ptec"] > p["subsidio"] > p["cehta"] > p["trewaox"] == D("0.00")


def test_pct_desde_montos_no_maquilla_un_descuadre():
    p = pct_desde_montos(1000, {"subsidio": 500, "cehta": 400})
    assert p is not None
    assert sum(p.values()) == D("90.00")


def test_pct_desde_montos_none_si_sin_clasificar():
    assert pct_desde_montos(1000, None) is None


def test_ida_y_vuelta_pct_montos_pct_es_estable():
    total = D("1234567.89")
    pcts = {"subsidio": D("47.08"), "cehta_ptec": D("19.09"), "cehta": D("33.83")}
    m = repartir_por_pct(total, pcts)
    assert _suma(m) == total
    p2 = pct_desde_montos(total, m)
    assert p2 is not None and sum(p2.values()) == D("100.00")
    for f in FUENTES:
        assert abs(p2[f] - pcts.get(f, D(0))) <= D("0.01")


# ── escalar_reparto (cambia el total, el reparto se escala exacto) ───


def test_escalar_conserva_proporcion_y_cierra_exacto():
    # PROYECTA SPA: 496.451 / 94.326 sobre 590.777, el total baja a 496.451
    e = escalar_reparto(590777, 496451, {"subsidio": 496451, "cehta": 94326})
    assert _suma(e) == D("496451.00")
    assert e["subsidio"] == D("417185.00")
    assert e["cehta"] == D("79266.00")


def test_escalar_ida_y_vuelta_mueve_a_lo_sumo_un_peso():
    orig = {
        "subsidio": D("496451.00"),
        "cehta_ptec": D("0.00"),
        "cehta": D("94326.00"),
        "trewaox": D("0.00"),
    }
    ida = escalar_reparto(590777, 496451, orig)
    vuelta = escalar_reparto(496451, 590777, ida)
    assert _suma(vuelta) == D("590777.00")
    for f in FUENTES:
        assert abs(vuelta[f] - orig[f]) <= D("1")
    # y el camino viejo (por % a 2 decimales) movía $21: es lo que se evita
    pcts = pct_desde_montos(590777, orig)
    assert pcts is not None
    por_pct = repartir_por_pct(590777, pcts)
    assert abs(por_pct["subsidio"] - orig["subsidio"]) == D("21")


def test_escalar_sin_clasificar_sigue_sin_clasificar():
    assert escalar_reparto(1000, 2000, None) == {f: None for f in FUENTES}


def test_escalar_mismo_total_no_toca():
    m = {"subsidio": 500, "cehta": 500}
    assert escalar_reparto(1000, 1000, m) == normalizar_montos(m)


def test_escalar_descuadrado_rechaza():
    with pytest.raises(RepartoInvalidoError):
        escalar_reparto(1000, 2000, {"subsidio": 500, "cehta": 400})


def test_escalar_desde_cero_rechaza_salvo_a_cero():
    assert _suma(escalar_reparto(0, 0, {"subsidio": 0})) == 0
    with pytest.raises(RepartoInvalidoError):
        escalar_reparto(0, 100, {"subsidio": 0})


# ── paridad con TypeScript (snapshot compartido) ─────────────────────


def test_snapshot_paridad_no_esta_desactualizado():
    """El fixture lo consume también vitest: si el motor cambia y no se
    regenera, este test avisa antes de que el frontend se desincronice."""
    import json
    from pathlib import Path

    ruta = Path(__file__).resolve().parents[1] / "fixtures" / "reparto_corfo_esperado.json"
    data = json.loads(ruta.read_text(encoding="utf-8"))
    assert data["fuentes"] == list(FUENTES)
    assert len(data["casos"]) >= 10

    def s(d):
        return None if d is None else {f: (str(v) if v is not None else None) for f, v in d.items()}

    for c in data["casos"]:
        if "pcts" in c:
            m = repartir_por_pct(c["total"], c["pcts"])
            assert s(m) == c["esperado_montos"], c["nombre"]
            assert estado_reparto(c["total"], m) == c["esperado_estado"], c["nombre"]
            assert s(pct_desde_montos(c["total"], m)) == c["esperado_pcts"], c["nombre"]
        elif "escalar_a" in c:
            e = escalar_reparto(c["total"], c["escalar_a"], c["montos"])
            assert s(e) == c["esperado_escalado"], c["nombre"]
            assert estado_reparto(c["escalar_a"], e) == c["esperado_estado"], c["nombre"]
        else:
            assert s(normalizar_montos(c["montos"])) == c["esperado_normalizados"], c["nombre"]
            assert estado_reparto(c["total"], c["montos"]) == c["esperado_estado"], c["nombre"]
            assert s(pct_desde_montos(c["total"], c["montos"])) == c["esperado_pcts"], c["nombre"]
