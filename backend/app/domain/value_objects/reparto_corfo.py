"""Reparto de un gasto del subsidio CORFO entre fuentes de financiamiento.

Es la "SEPARACIÓN VALORES" del Excel de Claudia: cada gasto de REVTECH o
TRONGKAI se parte entre quién lo paga:

    subsidio    → CORFO (el pozo del subsidio 2024-265638)
    cehta_ptec  → Cehta Capital, como aporte pecuniario al programa P-tec
    cehta       → Cehta Capital, gasto fuera del subsidio
    trewaox     → Innova Región (proyecto Trewaox, sólo TRONGKAI)

# LA REGLA DE ORO

La fuente de verdad son los MONTOS en pesos, no los porcentajes. Los
porcentajes se derivan y se ofrecen como forma cómoda de editar: si
Claudia escribe "50 / 20 / 30", este módulo convierte a pesos enteros
(HALF_UP) y le asigna el residuo de redondeo a la fuente MÁS GRANDE, de
modo que la suma sea EXACTAMENTE el total. Nunca queda un peso bailando.

Un reparto puede estar en tres estados:
    SIN_CLASIFICAR  → las 4 fuentes en None (todavía no se decidió)
    OK              → la suma de las fuentes es exactamente el total
    DESCUADRADO     → hay fuentes cargadas pero no cierran contra el total
                      (pasa con filas importadas del Excel; la pantalla
                      las marca para que se corrijan, no las esconde)

Módulo puro: sin BD, sin FastAPI. Los tests de `test_reparto_corfo.py` y
el snapshot de paridad con TypeScript fijan este comportamiento.
"""
from __future__ import annotations

from collections.abc import Mapping
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

#: Orden canónico. También es el orden de desempate del residuo.
FUENTES: tuple[str, ...] = ("subsidio", "cehta_ptec", "cehta", "trewaox")

ETIQUETAS: dict[str, str] = {
    "subsidio": "Subsidio CORFO",
    "cehta_ptec": "Cehta · aporte P-tec",
    "cehta": "Cehta (fuera del subsidio)",
    "trewaox": "Trewaox · Innova Región",
}

ESTADO_SIN_CLASIFICAR = "SIN_CLASIFICAR"
ESTADO_OK = "OK"
ESTADO_DESCUADRADO = "DESCUADRADO"

_CIEN = Decimal("100")
_PESO = Decimal("1")
_CENT = Decimal("0.01")
#: Tolerancia al validar que los porcentajes suman 100 (2 decimales).
_TOL_PCT = Decimal("0.01")


class RepartoInvalidoError(ValueError):
    """El reparto pedido no es válido (porcentajes que no suman 100, etc.)."""


def _d(v: Any) -> Decimal:
    if isinstance(v, Decimal):
        return v
    if v is None or v == "":
        return Decimal("0")
    return Decimal(str(v))


def _validar_fuentes(datos: Mapping[str, Any]) -> None:
    desconocidas = sorted(set(datos) - set(FUENTES))
    if desconocidas:
        raise RepartoInvalidoError(
            f"Fuente(s) desconocida(s): {', '.join(desconocidas)}. "
            f"Válidas: {', '.join(FUENTES)}"
        )


def normalizar_montos(montos: Mapping[str, Any] | None) -> dict[str, Decimal | None]:
    """Los 4 montos a Decimal con 2 decimales, o los 4 en None si viene vacío.

    Todo-o-nada: si al menos UNA fuente trae valor, las que faltan pasan a
    0 (no a None). Así "sin clasificar" es una sola cosa: las cuatro en None.
    """
    if not montos:
        return {f: None for f in FUENTES}
    _validar_fuentes(montos)
    crudos = {f: montos.get(f) for f in FUENTES}
    if all(v is None or v == "" for v in crudos.values()):
        return {f: None for f in FUENTES}
    return {f: _d(v).quantize(_CENT, rounding=ROUND_HALF_UP) for f, v in crudos.items()}


def repartir_por_pct(total: Any, pcts: Mapping[str, Any]) -> dict[str, Decimal]:
    """Convierte porcentajes en montos que suman EXACTAMENTE el total.

    - Cada porcentaje va de 0 a 100; las fuentes ausentes valen 0.
    - La suma tiene que ser 100 (±0,01). Si no, `RepartoInvalidoError`.
    - Cada monto se redondea a peso entero (HALF_UP). El residuo (que puede
      incluir los centavos del total) va a la fuente con mayor porcentaje;
      en empate, a la primera según `FUENTES`.
    """
    total_d = _d(total).quantize(_CENT, rounding=ROUND_HALF_UP)
    if total_d < 0:
        raise RepartoInvalidoError("El total no puede ser negativo")
    _validar_fuentes(pcts)
    limpio = {f: _d(pcts.get(f)) for f in FUENTES}
    for f, p in limpio.items():
        if p < 0 or p > _CIEN:
            raise RepartoInvalidoError(
                f"El porcentaje de {ETIQUETAS[f]} tiene que estar entre 0 y 100 (llegó {p})"
            )
    suma = sum(limpio.values(), Decimal("0"))
    if abs(suma - _CIEN) > _TOL_PCT:
        raise RepartoInvalidoError(
            f"Los porcentajes suman {suma.normalize():f}%, tienen que sumar 100%"
        )

    montos = {
        f: (total_d * p / _CIEN).quantize(_PESO, rounding=ROUND_HALF_UP)
        for f, p in limpio.items()
    }
    residuo = total_d - sum(montos.values(), Decimal("0"))
    if residuo:
        mayor = max(FUENTES, key=lambda f: (limpio[f], -FUENTES.index(f)))
        montos[mayor] = montos[mayor] + residuo
    return {f: m.quantize(_CENT) for f, m in montos.items()}


def escalar_reparto(
    total_viejo: Any, total_nuevo: Any, montos: Mapping[str, Any] | None
) -> dict[str, Decimal | None]:
    """Reescala un reparto cuando cambia el TOTAL, sin pasar por porcentajes.

    Es la respuesta al drift que encontró el lente de dinero: convertir a %
    con 2 decimales y volver a pesos movía $21 del Subsidio a Cehta en una
    fila real (PROYECTA SPA) sin que nadie tocara el reparto. Acá cada
    fuente se escala en proporción exacta (monto * nuevo / viejo, HALF_UP a
    peso) y el residuo va a la fuente MAYOR, así la suma es el total nuevo.
    Ida y vuelta puede mover a lo sumo $1 por el redondeo a peso, y sólo si
    el total cambió de verdad.

    - Sin clasificar (las 4 en None) → sigue sin clasificar.
    - Reparto DESCUADRADO contra el total viejo → `RepartoInvalidoError`:
      no se escala un reparto que no cierra; el llamador lo deja como está.
    - Total viejo 0 → sólo se acepta si el nuevo también es 0.
    """
    limpio = normalizar_montos(montos)
    if all(v is None for v in limpio.values()):
        return limpio
    viejo = _d(total_viejo).quantize(_CENT, rounding=ROUND_HALF_UP)
    nuevo = _d(total_nuevo).quantize(_CENT, rounding=ROUND_HALF_UP)
    if nuevo < 0:
        raise RepartoInvalidoError("El total no puede ser negativo")
    if estado_reparto(viejo, limpio) != ESTADO_OK:
        raise RepartoInvalidoError(
            "El reparto no cuadra contra el total actual; corregilo antes de cambiar el total"
        )
    if viejo == nuevo:
        return limpio
    if viejo == 0:
        if nuevo == 0:
            return limpio
        raise RepartoInvalidoError("No se puede escalar un reparto desde un total de $0")
    montos_ok = {f: (v or Decimal("0")) for f, v in limpio.items()}
    escalados = {
        f: (m * nuevo / viejo).quantize(_PESO, rounding=ROUND_HALF_UP)
        for f, m in montos_ok.items()
    }
    residuo = nuevo - sum(escalados.values(), Decimal("0"))
    if residuo:
        mayor = max(FUENTES, key=lambda f: (montos_ok[f], -FUENTES.index(f)))
        escalados[mayor] = escalados[mayor] + residuo
    return {f: m.quantize(_CENT) for f, m in escalados.items()}


def estado_reparto(total: Any, montos: Mapping[str, Any] | None) -> str:
    """SIN_CLASIFICAR / OK / DESCUADRADO. Compara a centavo exacto."""
    limpio = normalizar_montos(montos)
    if all(v is None for v in limpio.values()):
        return ESTADO_SIN_CLASIFICAR
    total_d = _d(total).quantize(_CENT, rounding=ROUND_HALF_UP)
    suma = sum(((v or Decimal("0")) for v in limpio.values()), Decimal("0"))
    return ESTADO_OK if suma == total_d else ESTADO_DESCUADRADO


def pct_desde_montos(
    total: Any, montos: Mapping[str, Any] | None
) -> dict[str, Decimal] | None:
    """Porcentajes (2 decimales) a partir de los montos, o None si no hay reparto.

    Si el reparto está OK, los porcentajes se ajustan para que sumen 100,00
    exacto (el residuo de redondeo va a la fuente mayor). Si está
    DESCUADRADO se devuelven los porcentajes crudos: que NO sumen 100 es
    justamente la información que hay que mostrar.
    """
    limpio = normalizar_montos(montos)
    if all(v is None for v in limpio.values()):
        return None
    total_d = _d(total).quantize(_CENT, rounding=ROUND_HALF_UP)
    if total_d == 0:
        return {f: Decimal("0.00") for f in FUENTES}
    pcts = {
        f: ((v or Decimal("0")) / total_d * _CIEN).quantize(_CENT, rounding=ROUND_HALF_UP)
        for f, v in limpio.items()
    }
    if estado_reparto(total_d, limpio) == ESTADO_OK:
        residuo = _CIEN - sum(pcts.values(), Decimal("0"))
        if residuo:
            mayor = max(FUENTES, key=lambda f: (pcts[f], -FUENTES.index(f)))
            pcts[mayor] = (pcts[mayor] + residuo).quantize(_CENT)
    return pcts
