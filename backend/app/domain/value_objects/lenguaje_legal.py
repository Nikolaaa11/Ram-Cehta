"""Expresiones legalmente prohibidas en el material del fondo.

Ciclo Capital es un Fondo de Inversión Privado (Cap. V Ley 20.712). Hay dos
expresiones que su documentación NO puede usar, y no es una cuestión de estilo:

  · Prometer rentabilidad **garantizada** → art. 61 Ley 18.045 sanciona la
    información falsa o tendenciosa sobre valores de oferta privada.
  · Llamarse **"administradora general de fondos"** → art. 90 Ley 20.712 lo
    reserva para las entidades fiscalizadas por la CMF. AFIS no lo es.

El reemplazo correcto es *respaldado* / *pactado* / *acordado*.

# POR QUÉ ESTE MÓDULO ES TAN ANGOSTO

La primera versión buscaba cualquier palabra de la familia "garantizar" cerca
de vocabulario financiero. La verificación adversarial la corrió contra 27
glosas reales de órdenes de compra y **dispararon las 27**, 20 de ellas con
severidad alta:

    "Garantía de rendimiento del equipo: 500 kg/h según ficha técnica"
    "El proveedor garantiza la distribución de los materiales en 48 horas"
    "Se garantiza el retorno del equipo arrendado al término del contrato"
    "El contratista garantiza una tasa de falla inferior al 1%"

El error de fondo: **`garantizar` es el verbo más común de una orden de compra
chilena**, y lo que predica casi nunca es un retorno. Y las palabras que
parecían financieras —rendimiento, retorno, distribución, capital, tasa— son
también vocabulario de ficha técnica.

Un validador que salta con todo se ignora a la semana, y un validador ignorado
no protege nada. Así que este sólo reconoce lo que es **inequívoco**:

  1. La frase exacta "administradora general de fondos". Cero ambigüedad.
  2. Una palabra de garantía PEGADA a un sustantivo que sólo puede ser
     financiero. Nada de ventanas de proximidad.

Prefiere dejar pasar una redacción dudosa antes que molestar con una legítima.
Lo que no atrape acá lo tiene que atrapar la revisión legal — este módulo es
una red de seguridad, no el abogado.

# DÓNDE SE USA (y dónde NO)

Se usa sobre **material que ve un partícipe o un inversionista**: carta oferta,
fichas del fondo, contratos, textos del sitio.

**NO se usa sobre glosas de órdenes de compra.** Una OC que dice "12 meses de
garantía del fabricante" no tiene ningún riesgo legal, y es la redacción normal.
Enganchar esto ahí es lo que produjo los 27 falsos positivos.

Funciones puras: sin BD, sin ORM, sin efectos. Devuelven hallazgos, no lanzan.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Final

__all__ = [
    "Hallazgo",
    "revisar_texto",
    "tiene_lenguaje_prohibido",
]


@dataclass(frozen=True)
class Hallazgo:
    """Una expresión prohibida encontrada, con qué poner en su lugar.

    `inicio`/`fin` son offsets sobre el texto ORIGINAL (no sobre el
    normalizado), para poder resaltarlo tal cual lo escribió la persona.
    """

    expresion: str
    """Lo que se encontró, tal como aparece en el texto original."""
    motivo: str
    """Por qué no se puede usar, con la norma."""
    sugerencia: str
    """Qué escribir en su lugar. Sin esto, el aviso obliga a googlear."""
    inicio: int
    fin: int


# ---------------------------------------------------------------------------
# Normalización
# ---------------------------------------------------------------------------
# Se compara sobre el texto sin tildes y en minúsculas, pero se REPORTA sobre
# el original. La gente escribe "garantía" y "garantia" indistintamente, y una
# regla que sólo atrape la versión con tilde no atrapa nada.


def _sin_tildes(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto)
        if unicodedata.category(c) != "Mn"
    )


def _normalizar(texto: str) -> str:
    """Minúsculas, sin tildes, espacios colapsados.

    El colapso de espacios es 1:1 en longitud (reemplaza cada espacio raro por
    uno normal, no los elimina), así que los offsets del texto normalizado
    siguen valiendo sobre el original. Si alguna vez se cambia por algo que
    altere el largo, los offsets del `Hallazgo` dejan de apuntar a donde dicen.
    """
    plano = _sin_tildes(texto).lower()
    return re.sub(r"[\s ]", " ", plano)


# ---------------------------------------------------------------------------
# Regla 1 — la frase reservada
# ---------------------------------------------------------------------------
_ADMINISTRADORA_GENERAL: Final = re.compile(
    r"administradora\s+general\s+de\s+fondos"
)

_MOTIVO_AGF: Final = (
    "El art. 90 de la Ley 20.712 reserva la expresión «administradora general "
    "de fondos» para las entidades fiscalizadas por la CMF. AFIS no lo es."
)
_SUGERENCIA_AGF: Final = (
    "Escribir «administradora de fondos de inversión privados», que es lo que "
    "dice su objeto social."
)


# ---------------------------------------------------------------------------
# Regla 2 — promesa de rentabilidad
# ---------------------------------------------------------------------------
# Dos listas MUY cortas, y tienen que aparecer PEGADAS (con a lo sumo un
# artículo o preposición en el medio). Nada de ventanas de N palabras: eso fue
# lo que hizo que "garantiza la distribución de los materiales" saltara.

_GARANTIA: Final = r"(?:garantizad[oa]s?|garantiza(?:mos|n)?|asegurad[oa]s?|asegura(?:mos|n)?)"

# Sustantivos que en castellano comercial chileno NO pueden significar otra
# cosa que un rendimiento financiero. Deliberadamente NO están:
#   · rendimiento  → "garantía de rendimiento del equipo" es una garantía de
#                    performance, la frase estándar de una ficha técnica.
#   · capital      → "capital de trabajo de la obra".
#   · tasa         → "tasa de falla inferior al 1%".
#   · distribucion → tablero de distribución eléctrica.
_RENTA: Final = r"(?:rentabilidad(?:es)?|ganancias?|utilidad(?:es)?|intereses?)"

_NEXO: Final = r"(?:\s+(?:de|del|la|el|los|las|un|una|unos|unas))?\s+"

# «rentabilidad garantizada», «ganancia asegurada», «utilidades garantizadas»
_RENTA_GARANTIA: Final = re.compile(_RENTA + _NEXO + _GARANTIA)
# «garantizamos una rentabilidad», «asegura la ganancia»
_GARANTIA_RENTA: Final = re.compile(_GARANTIA + _NEXO + _RENTA)

# «retorno» es el caso difícil: "se garantiza el retorno del equipo arrendado"
# es legítimo y frecuente. Sólo se marca cuando viene acompañado de un
# porcentaje o de "anual", que es lo que lo vuelve inequívocamente financiero.
_RETORNO_FINANCIERO: Final = re.compile(
    r"(?:"
    + _GARANTIA + _NEXO + r"retornos?(?=[^.]{0,40}?(?:\d+\s*%|anual))"
    + r"|"
    + r"retornos?" + _NEXO + _GARANTIA
    + r")"
)

_MOTIVO_RENTA: Final = (
    "Prometer rentabilidad garantizada es información tendenciosa sobre un "
    "valor de oferta privada (art. 61 Ley 18.045). El fondo respalda la "
    "operación con un inmueble, pero no garantiza el resultado."
)
_SUGERENCIA_RENTA: Final = (
    "Reemplazar por «respaldado», «pactado» o «acordado»: p. ej. «retorno "
    "pactado de 12% anual» en vez de «retorno garantizado de 12% anual»."
)


def revisar_texto(texto: str | None) -> list[Hallazgo]:
    """Expresiones prohibidas en un texto que va a leer un partícipe.

    Devuelve la lista de hallazgos, vacía si está limpio. NUNCA lanza y nunca
    bloquea: quien la llame decide qué hacer. Un falso positivo que impide
    emitir un documento es peor que el aviso que no se leyó.

    Ojo: NO llamar esto sobre glosas de órdenes de compra (ver el docstring del
    módulo).
    """
    if not texto or not texto.strip():
        return []

    plano = _normalizar(texto)
    hallazgos: list[Hallazgo] = []

    for m in _ADMINISTRADORA_GENERAL.finditer(plano):
        hallazgos.append(
            Hallazgo(
                expresion=texto[m.start():m.end()],
                motivo=_MOTIVO_AGF,
                sugerencia=_SUGERENCIA_AGF,
                inicio=m.start(),
                fin=m.end(),
            )
        )

    vistos: set[tuple[int, int]] = set()
    for patron in (_RENTA_GARANTIA, _GARANTIA_RENTA, _RETORNO_FINANCIERO):
        for m in patron.finditer(plano):
            # Dos patrones pueden pisar el mismo tramo («rentabilidad
            # garantizada» matchea en los dos sentidos si el texto se repite):
            # se reporta una sola vez para no duplicar el aviso.
            if (m.start(), m.end()) in vistos:
                continue
            vistos.add((m.start(), m.end()))
            hallazgos.append(
                Hallazgo(
                    expresion=texto[m.start():m.end()],
                    motivo=_MOTIVO_RENTA,
                    sugerencia=_SUGERENCIA_RENTA,
                    inicio=m.start(),
                    fin=m.end(),
                )
            )

    return sorted(hallazgos, key=lambda h: h.inicio)


def tiene_lenguaje_prohibido(texto: str | None) -> bool:
    """Atajo booleano para cuando sólo interesa saber si hay algo que revisar."""
    return bool(revisar_texto(texto))
