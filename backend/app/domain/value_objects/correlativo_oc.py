"""Sugerencia del próximo número de orden de compra.

# POR QUÉ NO HAY UN FORMATO ÚNICO

Cada empresa numera sus OC a su manera, y ninguna coincide con otra. Esto es
lo que hay en producción hoy:

    PANIMAVIDA   OC0051-PAN001-E_Retamal Modulo Sanitario   contador ADELANTE
    TECMAVIDA    OC-T&E-0004                                contador AL FINAL
    EVOQUE       OC-EE.ADM.0015                             contador al final
    DTE          OC-2026-020                                ojo: 2026 es AÑO
    REVTECH      OC-100
    CICLO        0C-2                                       (con cero, no O)

Un formato impuesto desde el código rompería la numeración de las seis. Y
adivinar mal el contador es peor que no sugerir nada: el número ES la
identidad del documento, y el invariante de la plataforma es correlativo sin
saltos.

Así que esto NO inventa un formato: **aprende del que la empresa ya usa**.

# CÓMO ELIGE CUÁL ES EL CONTADOR

El caso difícil es DTE (`OC-2026-020`), donde hay dos grupos de dígitos y el
primero es un año. Tomar "el primero" rompe DTE; tomar "el último" rompe
PANIMAVIDA. La respuesta sale de comparar los dos números más recientes: el
grupo que CAMBIÓ entre uno y otro es el contador. Es la definición literal de
lo que hace un correlativo.

Con un solo número cargado no hay con qué comparar y se usa el último grupo,
que es la convención más común. Con ninguno, se arranca en 0001 con el
`oc_prefix` de la empresa.

Funciones puras: sin BD, sin ORM. Reciben la lista de números y devuelven una
sugerencia. Nunca lanzan — si no pueden deducir nada devuelven None y la
pantalla deja el campo vacío para que la persona escriba.
"""
from __future__ import annotations

import contextlib
import re
from dataclasses import dataclass
from typing import Final

__all__ = [
    "Sugerencia",
    "siguiente_numero_oc",
]

#: Grupos de dígitos consecutivos. Se conserva la posición para poder
#: reemplazar exactamente ese tramo y no otro igual que aparezca antes.
_DIGITOS: Final = re.compile(r"\d+")

#: Separadores ESTRUCTURALES de un correlativo. Se usan para recortar la cola
#: heredada hasta un borde limpio: de `-PAN001-E_Retamal ` queremos
#: `-PAN001-`, no media descripción de la OC anterior.
#:
#: Ni `_` ni el espacio entran acá, aunque parezcan separadores: con `_` la
#: cola se cortaba DENTRO de "E_Retamal" y quedaba `-PAN001-E_`, que no es un
#: borde de nada.
_SEPARADORES: Final = "-./"


@dataclass(frozen=True)
class Sugerencia:
    """El número propuesto y de dónde salió.

    `motivo` se muestra en la pantalla: una sugerencia que no explica su
    origen se acepta a ciegas, y acá lo que se acepta a ciegas es la
    identidad de un documento tributario.
    """

    numero: str
    motivo: str
    #: El número del que se dedujo. None cuando la empresa no tenía ninguno.
    base: str | None = None


def _grupos(texto: str) -> list[re.Match[str]]:
    return list(_DIGITOS.finditer(texto))


def _indice_del_contador(actual: str, anterior: str | None) -> int | None:
    """Cuál de los grupos de dígitos es el correlativo.

    Devuelve el índice dentro de `_grupos(actual)`, o None si `actual` no
    tiene dígitos.

    La regla: el grupo que CAMBIÓ entre los dos números más recientes. Es lo
    que distingue un contador de un año o de un código de centro de costo,
    que se repiten. Sin un segundo número con qué comparar, el último grupo.
    """
    ga = _grupos(actual)
    if not ga:
        return None
    if anterior:
        gp = _grupos(anterior)
        # Se comparan por posición desde el final: `OC0051-PAN001-...` y
        # `OC0050-PAN001-...` tienen los mismos dos grupos, y el que difiere
        # es el primero. Comparar desde el final tolera colas de largo
        # distinto (una descripción más larga en una de las dos).
        for i in range(min(len(ga), len(gp))):
            if ga[i].group() != gp[i].group():
                return i
    return len(ga) - 1


def _cola_comun(actual: str, anterior: str, desde: int) -> str:
    """Qué parte de lo que sigue al contador se conserva.

    En PANIMAVIDA, tras el contador viene `-PAN001-` (fijo, hay que
    conservarlo) y después la descripción de esa OC puntual (variable, hay que
    tirarla — arrastrarla haría que la OC nueva se llame como la anterior).

    Se toma el prefijo común de las dos colas y se recorta hasta el último
    separador, para no cortar una palabra por la mitad.
    """
    ca, cp = actual[desde:], anterior[desde:]
    n = 0
    while n < min(len(ca), len(cp)) and ca[n] == cp[n]:
        n += 1
    comun = ca[:n]
    # Recortar hasta el último separador: `-PAN001-E_Retamal ` -> `-PAN001-`.
    corte = max((comun.rfind(s) for s in _SEPARADORES), default=-1)
    return comun[: corte + 1] if corte >= 0 else comun


def _esqueleto_hasta(numero: str, idx: int) -> str | None:
    """La forma del número hasta el contador, con las cifras borradas.

    `OC-EE.ADM.0015` con idx 0 -> `OC-EE.ADM.#`
    `OC-2026-13`     con idx 0 -> `OC-#`
    `OC0051-PAN001-loquesea` con idx 0 -> `OC#`

    Sirve para decidir si dos números pertenecen a la misma serie sin exigir
    que la COLA sea igual: en PANIMAVIDA cada OC termina con su propia
    descripción y aun así todas cuentan.
    """
    g = _grupos(numero)
    if len(g) <= idx:
        return None
    return _DIGITOS.sub("#", numero[: g[idx].end()])


def siguiente_numero_oc(
    numeros: list[str],
    oc_prefix: str | None = None,
) -> Sugerencia | None:
    """Propone el próximo número para una empresa.

    `numeros` va ordenado del MÁS RECIENTE al más viejo, e incluye tanto las
    OC vivas como las eliminadas: un número que se usó y se borró no se
    reutiliza — el documento pudo haber salido al proveedor.

    Devuelve None sólo si no hay forma de proponer nada sensato.
    """
    limpios = [n.strip() for n in numeros if n and n.strip()]

    # ── Empresa sin ninguna OC ────────────────────────────────────────────
    if not limpios:
        prefijo = (oc_prefix or "OC").strip() or "OC"
        return Sugerencia(
            numero=f"{prefijo}-0001",
            motivo="Primera OC de la empresa. Se arranca en 0001.",
            base=None,
        )

    actual = limpios[0]
    anterior = limpios[1] if len(limpios) > 1 else None

    idx = _indice_del_contador(actual, anterior)
    if idx is None:
        # El último número no tiene un solo dígito (p. ej. "OC-URGENTE").
        # No se inventa un contador: se devuelve el número tal cual para que
        # la persona lo edite, diciendo por qué.
        return Sugerencia(
            numero=actual,
            motivo=(
                f"El último número ({actual}) no tiene ninguna cifra, así que "
                "no se puede deducir un correlativo. Escribilo a mano."
            ),
            base=actual,
        )

    g = _grupos(actual)[idx]

    # El MÁXIMO del contador entre todos los números de la empresa, no el del
    # más reciente. Si alguien cargó la OC 48 después de la 51 —pasa, se
    # carga con atraso—, seguir del más reciente propondría un 49 que ya
    # existe. En producción hay exactamente ese caso: OC0047..OC0051 el mismo
    # día, y una OC0023 cargada después.
    # Sólo cuentan los números de la MISMA serie. EVOQUE tiene
    # `OC-EE.ADM.0015` y, de una numeración vieja, `OC-2026-13`: mirando "el
    # grupo número 0" de los dos, el 2026 del AÑO ganaba y la sugerencia
    # saltaba a `OC-EE.ADM.2027`. Dos números son de la misma serie si su
    # esqueleto HASTA el contador coincide (`OC-EE.ADM.#` ≠ `OC-#`); lo que
    # venga DESPUÉS puede diferir libremente, que es lo que permite seguir
    # contando a PANIMAVIDA aunque cada OC lleve su propia descripción.
    esqueleto = _esqueleto_hasta(actual, idx)

    mayor = int(g.group())
    for n in limpios:
        gn = _grupos(n)
        if len(gn) > idx and _esqueleto_hasta(n, idx) == esqueleto:
            with contextlib.suppress(ValueError):
                # El regex garantiza dígitos; el suppress cubre sólo un
                # entero tan largo que no entre en int (no pasa en la
                # práctica, pero esto NUNCA puede lanzar: lo llama un
                # endpoint que el formulario consulta en cada tecleo).
                mayor = max(mayor, int(gn[idx].group()))

    ancho = len(g.group())
    cabeza = actual[: g.start()]
    cola = _cola_comun(actual, anterior, g.end()) if anterior else actual[g.end():]

    usados = {n.casefold() for n in limpios}
    siguiente = mayor
    for _ in range(1000):
        siguiente += 1
        # `rstrip`: la cola heredada puede terminar en espacio y un número
        # de documento que termina en blanco es una molestia para siempre.
        propuesto = f"{cabeza}{siguiente:0{ancho}d}{cola}".rstrip()
        if propuesto.casefold() not in usados:
            return Sugerencia(
                numero=propuesto,
                motivo=f"Sigue de {actual}.",
                base=actual,
            )

    # 1000 intentos sin encontrar un hueco: algo raro pasa con esa
    # numeración. Mejor no proponer que proponer un duplicado.
    return None
