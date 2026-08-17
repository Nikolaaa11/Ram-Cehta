"""El validador de lenguaje legal, y sobre todo lo que NO tiene que marcar.

La primera versión de este módulo disparaba con 27 de 27 glosas reales de
órdenes de compra. La mitad de este archivo son esas glosas: si alguien vuelve
a ensanchar los patrones, saltan acá antes de llegar a producción.
"""
from __future__ import annotations

import pytest

from app.domain.value_objects.lenguaje_legal import (
    revisar_texto,
    tiene_lenguaje_prohibido,
)


# ──────────────────────────────────────────────────────────────────────
# LO QUE SÍ TIENE QUE MARCAR
# ──────────────────────────────────────────────────────────────────────

PROHIBIDAS = [
    "Ofrecemos una rentabilidad garantizada del 12% anual.",
    "rentabilidad garantizada",
    "Rentabilidad Garantizada del 12%",           # mayúsculas
    "rentabilidad garantizada",                    # sin tilde en el original
    "Garantizamos una rentabilidad de 12% anual sobre el capital.",
    "El fondo asegura la ganancia del partícipe.",
    "utilidades garantizadas para el inversionista",
    "retorno garantizado de 12% anual",
    "Se garantiza un retorno de 12% anual sobre lo enterado.",
    "Somos una administradora general de fondos con años de experiencia.",
    "ADMINISTRADORA GENERAL DE FONDOS",
]


@pytest.mark.parametrize("texto", PROHIBIDAS)
def test_marca_las_expresiones_prohibidas(texto):
    h = revisar_texto(texto)
    assert h, f"tendría que haber saltado: {texto!r}"
    assert tiene_lenguaje_prohibido(texto)


def test_el_hallazgo_dice_que_poner_en_su_lugar():
    # Un aviso que no dice cómo arreglarlo obliga a googlear.
    h = revisar_texto("rentabilidad garantizada del 12%")[0]
    assert "pactado" in h.sugerencia or "respaldado" in h.sugerencia
    assert "18.045" in h.motivo


def test_los_offsets_apuntan_al_texto_original():
    texto = "El fondo ofrece rentabilidad garantizada a sus partícipes."
    h = revisar_texto(texto)[0]
    # Se recorta el ORIGINAL con los offsets del hallazgo: si la normalización
    # cambiara el largo del texto, este assert se rompe.
    assert texto[h.inicio:h.fin].lower().startswith("rentabilidad")
    assert "garantizada" in texto[h.inicio:h.fin].lower()


def test_la_frase_reservada_cita_la_norma_correcta():
    h = revisar_texto("somos administradora general de fondos")[0]
    assert "90" in h.motivo and "20.712" in h.motivo


# ──────────────────────────────────────────────────────────────────────
# LO QUE NO TIENE QUE MARCAR — glosas reales de órdenes de compra
# ──────────────────────────────────────────────────────────────────────
# Éstas son las que hicieron fracasar la primera versión. "garantizar" es el
# verbo más común de una OC chilena y lo que predica casi nunca es un retorno.

GLOSAS_LEGITIMAS = [
    "Garantía de rendimiento del equipo: 500 kg/h según ficha técnica.",
    "Se exige garantía de rendimiento de la bomba centrífuga.",
    "El proveedor garantiza la distribución de los materiales en 48 horas.",
    "Se garantiza el retorno del equipo arrendado al término del contrato.",
    "Tablero de distribución garantizado por 24 meses.",
    "El contratista garantiza una tasa de falla inferior al 1%.",
    "Se asegura la distribución eléctrica en toda la planta.",
    "Se garantiza el capital de trabajo necesario para la obra.",
    "Garantiza el aporte de material según cubicación.",
    "Boleta de garantía por el 5% del valor del contrato.",
    "Incluye 12 meses de garantía del fabricante.",
    "Garantía extendida por 36 meses sobre el motor.",
    "El proveedor garantiza la entrega en obra antes del 30 de septiembre.",
    "Se garantiza la calidad de los materiales conforme a norma chilena.",
    "Garantía de fábrica: 2 años contra defectos de fabricación.",
    "El equipo asegura una producción de 1.200 unidades por turno.",
    "Se solicita garantía de fiel cumplimiento del contrato.",
    "Póliza de garantía por anticipo, 30% del monto.",
    "Garantiza el suministro continuo durante toda la faena.",
    "Instalación de fosa séptica con garantía de estanqueidad.",
]


@pytest.mark.parametrize("glosa", GLOSAS_LEGITIMAS)
def test_no_molesta_con_glosas_legitimas_de_orden_de_compra(glosa):
    h = revisar_texto(glosa)
    assert not h, (
        f"FALSO POSITIVO en una glosa normal de OC: {glosa!r} -> "
        f"{[x.expresion for x in h]}"
    )


def test_retorno_de_un_bien_no_es_retorno_financiero():
    # El caso más fino: "retorno" sin porcentaje ni "anual" es la devolución de
    # una cosa, no un rendimiento.
    assert not revisar_texto("Se garantiza el retorno del andamio al finalizar.")
    assert revisar_texto("Se garantiza un retorno de 12% anual.")


def test_administradora_de_fondos_de_inversion_privados_es_correcto():
    # Es justamente el reemplazo que el módulo sugiere: no puede marcarlo.
    assert not revisar_texto(
        "AFIS es una administradora de fondos de inversión privados."
    )


# ──────────────────────────────────────────────────────────────────────
# Bordes
# ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("vacio", [None, "", "   ", "\n\t "])
def test_texto_vacio_no_explota(vacio):
    assert revisar_texto(vacio) == []
    assert tiene_lenguaje_prohibido(vacio) is False


def test_no_duplica_el_mismo_hallazgo():
    h = revisar_texto("rentabilidad garantizada")
    assert len(h) == 1


def test_varios_hallazgos_salen_en_orden_de_aparicion():
    texto = (
        "Somos administradora general de fondos y ofrecemos "
        "rentabilidad garantizada."
    )
    h = revisar_texto(texto)
    assert len(h) == 2
    assert h[0].inicio < h[1].inicio


def test_un_texto_largo_y_limpio_no_tarda_ni_marca():
    # Sin ventanas de proximidad ni backtracking cuadrático: la primera versión
    # tardaba ~2 s con 32 kB de texto mal formado.
    import time

    texto = "El fondo respalda la operación con un inmueble urbano. " * 2000
    t0 = time.perf_counter()
    h = revisar_texto(texto)
    assert not h
    assert time.perf_counter() - t0 < 1.0
