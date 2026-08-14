"""Retención de honorarios (Art. 74 N°2 LIR) y totales de la orden de compra.

Hermano de `iva.py` y con las mismas reglas de juego: todo `Decimal`, redondeo a
peso chileno con ROUND_HALF_UP, funciones puras — sin BD, sin ORM.

UNIDADES, que acá son la fuente de todos los errores de plata:

- Las primitivas (`calcular_retencion`, `calcular_liquido`, `bruto_desde_liquido`)
  toman **tasa**: 0.1525. Igual que `calcular_iva(neto, rate)`.
- Las de alto nivel (`calcular_totales`, `normalizar_porcentajes`) y
  `porcentaje_retencion_por_fecha` toman y devuelven **porcentaje**: 15.25. Es lo
  que guardan las columnas `iva_porcentaje` / `retencion_porcentaje` y lo que ve
  el operador.
- El puente es `porcentaje_a_tasa`, reexportado desde `iva.py`.

Cada parámetro dice en su nombre en qué unidad viene, y `_validar_tasa` rechaza
cualquier cosa mayor a 1 nombrando la confusión. Pasar 15.25 donde va 0.1525
retendría 100 veces de más y pasar 0.1525 donde va 15.25 retendría 100 veces de
menos; ninguna de las dos puede pasar en silencio.

`calcular_totales` es el ÚNICO lugar del sistema donde vive la aritmética de los
cuatro tipos de documento de una OC. La API, el PDF, los exports y el frontend la
consumen; ninguno la reimplementa. Cada reimplementación es una oportunidad de
que dos pantallas muestren números distintos para la misma OC, y eso con plata no
se descubre mirando: se descubre cuando el proveedor reclama.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Final, Literal, NamedTuple

# Reusamos el redondeo y la conversión del módulo hermano en vez de copiarlos. El
# criterio de redondeo del peso chileno es uno solo y dos copias terminan
# divergiendo el día que alguien toque una. `_round_clp` es privado de `iva.py`
# pero público dentro de `value_objects`: nadie fuera de este paquete lo importa.
from app.domain.value_objects.iva import (
    IVA_RATE,
    PASO_CLP,
    _round_clp,
    calcular_iva,
    paso_de_moneda,
    porcentaje_a_tasa,
)

# `porcentaje_a_tasa` se reexporta a propósito: los consumidores de la retención
# lo importan desde acá para no tener que saber que vive en `iva.py`. No es un
# import muerto — sacarlo rompe `app/api/v1/ordenes_compra.py`.
__all__ = [
    "paso_de_moneda",
    "CLAVE_TAX_CONFIG_RETENCION",
    "ESCALA_RETENCION_HONORARIOS",
    "IVA_PORCENTAJE_GENERAL",
    "IVA_TRATAMIENTO_POR_TIPO",
    "TIPOS_AFECTOS",
    "TIPOS_CON_RETENCION",
    "TIPOS_DOCUMENTO",
    "TipoDocumento",
    "TotalesOC",
    "bruto_desde_liquido",
    "calcular_liquido",
    "calcular_retencion",
    "calcular_totales",
    "iva_tratamiento",
    "normalizar_porcentajes",
    "porcentaje_a_tasa",
    "porcentaje_retencion_por_fecha",
]

# ---------------------------------------------------------------------------
# Catálogo de tipos de documento
# ---------------------------------------------------------------------------

# Tokens del catálogo SII que ya usa `core.vouchers.doc_tributario_tipo`. El mapeo
# OC -> voucher es la identidad a propósito: toda tabla de traducción entre dos
# catálogos termina divergiendo. Las etiquetas en castellano ("Boleta de
# honorarios") son presentación y viven en el frontend y en el PDF, nunca acá.
TipoDocumento = Literal["FACTURA", "FACTURA_EXENTA", "BOLETA", "HONORARIOS"]

TIPOS_DOCUMENTO: Final[tuple[TipoDocumento, ...]] = (
    "FACTURA",
    "FACTURA_EXENTA",
    "BOLETA",
    "HONORARIOS",
)

# Los que llevan IVA. En el resto va forzado a 0.
TIPOS_AFECTOS: Final[frozenset[str]] = frozenset({"FACTURA", "BOLETA"})

# Los que llevan retención. Hoy sólo la boleta de honorarios, pero el set existe
# para que sumar (p.ej.) otra retención de segunda categoría no sea un `if`
# desparramado por seis archivos.
TIPOS_CON_RETENCION: Final[frozenset[str]] = frozenset({"HONORARIOS"})

# Tratamiento de IVA para `voucher_lines.iva_tratamiento` / `plan_cuentas`.
# Exento no es lo mismo que afecto al 0 %: una operación exenta no genera crédito
# fiscal y se declara en una línea distinta del F29 y del RCV. Si se guardan
# iguales, el día que se concilie contra el SII no hay forma de separarlas.
IVA_TRATAMIENTO_POR_TIPO: Final[dict[str, str]] = {
    "FACTURA": "AFECTO",
    "BOLETA": "AFECTO",
    "FACTURA_EXENTA": "EXENTO",
    "HONORARIOS": "NO_GRAVADO",
}

# Porcentaje editable (19), no tasa (0.19). Derivado de `IVA_RATE` para que el
# IVA general siga teniendo una sola fuente de verdad.
IVA_PORCENTAJE_GENERAL: Final[Decimal] = IVA_RATE * Decimal("100")

# ---------------------------------------------------------------------------
# Escala de retención de honorarios
# ---------------------------------------------------------------------------

# Clave con la que esta escala vive en `core.tax_config`. Se expone para que el
# SQL que la siembra, el endpoint que la lee y el fallback de acá no puedan
# escribir tres strings distintos.
CLAVE_TAX_CONFIG_RETENCION: Final[str] = "RETENCION_HONORARIOS"

# Escala del Art. 74 N°2 de la LIR según la Ley 21.133: (vigente_desde, porcentaje).
ESCALA_RETENCION_HONORARIOS: Final[tuple[tuple[date, Decimal], ...]] = (
    (date(2024, 1, 1), Decimal("13.75")),
    (date(2025, 1, 1), Decimal("14.50")),
    (date(2026, 1, 1), Decimal("15.25")),
    (date(2027, 1, 1), Decimal("16.00")),
    (date(2028, 1, 1), Decimal("17.00")),
)


def porcentaje_retencion_por_fecha(fecha: date | None = None) -> Decimal:
    """Porcentaje de retención de honorarios vigente a `fecha` (15.25, no 0.1525).

    ESTO ES EL FALLBACK EN CÓDIGO, NO LA FUENTE DE VERDAD. La fuente de verdad es
    `core.tax_config` (clave `RETENCION_HONORARIOS`, vigencia por fecha), como
    manda el invariante 10 del SUPER_PROMPT_MAESTRO. La escala existe acá por tres
    razones concretas: que los tests unitarios no necesiten una BD, que el seed de
    `tax_config` tenga contra qué contrastarse, y que un entorno donde la
    migración todavía no se aplicó a mano no termine reteniendo 0 — el deploy no
    corre migraciones. Si `tax_config` y esta tupla discrepan, gana `tax_config` y
    hay que venir a corregir acá, no al revés.

    Hacia adelante la última fila se extiende sin límite: 17 % es la tasa de
    régimen permanente de la Ley 21.133, no un tope que caduca a fines de 2028.

    Hacia atrás NO se extrapola. Antes de 2024 la ley traía otros valores (la tasa
    venía subiendo año a año desde 2020) y devolver 13,75 % para una fecha de 2023
    sería inventar un dato tributario. Por eso levanta: una OC retroactiva sin
    tasa cargada es un problema que resuelve una persona, no un default.
    """
    momento = fecha if fecha is not None else date.today()
    arranque, _ = ESCALA_RETENCION_HONORARIOS[0]
    if momento < arranque:
        raise ValueError(
            f"No hay tasa de retención de honorarios para {momento.isoformat()}: "
            f"la escala documentada arranca el {arranque.isoformat()}"
        )

    vigente = ESCALA_RETENCION_HONORARIOS[0][1]
    for desde, porcentaje in ESCALA_RETENCION_HONORARIOS:
        if momento < desde:
            break
        vigente = porcentaje
    return vigente


def iva_tratamiento(tipo_documento: str) -> str:
    """Tratamiento de IVA (AFECTO / EXENTO / NO_GRAVADO) del tipo de documento."""
    _validar_tipo(tipo_documento)
    return IVA_TRATAMIENTO_POR_TIPO[tipo_documento]


# ---------------------------------------------------------------------------
# Validaciones de unidad
# ---------------------------------------------------------------------------


def _validar_tipo(tipo_documento: str) -> None:
    if tipo_documento not in TIPOS_DOCUMENTO:
        validos = ", ".join(TIPOS_DOCUMENTO)
        raise ValueError(
            f"Tipo de documento desconocido: {tipo_documento!r}. Los válidos son {validos}"
        )


def _validar_tasa(tasa: Decimal) -> None:
    """La tasa va entre 0 y 1. Cualquier cosa mayor es un porcentaje disfrazado.

    Es la red contra el error de unidad: `calcular_retencion(bruto, 15.25)`
    retendría 1525 % del bruto. No hay tasa de retención legítima arriba de 1, así
    que el chequeo no tiene falsos positivos y convierte un error silencioso de
    plata en una excepción que dice exactamente qué pasó.
    """
    if tasa < 0:
        raise ValueError(f"La tasa de retención no puede ser negativa, recibí {tasa}")
    if tasa > 1:
        raise ValueError(
            f"La tasa de retención va entre 0 y 1, recibí {tasa}. Si tenés el "
            f"porcentaje editable ({tasa}%), convertilo con porcentaje_a_tasa()"
        )


def _validar_porcentaje(nombre: str, porcentaje: Decimal) -> None:
    """Espeja el CHECK de la BD: los porcentajes van entre 0 y 100 inclusive."""
    if porcentaje < 0 or porcentaje > 100:
        raise ValueError(
            f"El porcentaje de {nombre} tiene que estar entre 0 y 100, recibí {porcentaje}"
        )


# ---------------------------------------------------------------------------
# Aritmética de la retención
# ---------------------------------------------------------------------------


def calcular_retencion(
    bruto: Decimal, tasa: Decimal, paso: Decimal = PASO_CLP
) -> Decimal:
    """Retención sobre el honorario BRUTO, redondeada a peso chileno.

    `tasa` es 0.1525, no 15.25 — la misma convención que `calcular_iva(neto, rate)`.
    El porcentaje editable que guarda la OC se convierte con `porcentaje_a_tasa`.

    Tasa 0 es legítima y devuelve retención 0, que NO es lo mismo que "no sé
    cuánto retener". Quien no tenga el dato lo resuelve antes de llegar acá: esta
    función no adivina y no tiene fallback (§3.4 del contrato).
    """
    _validar_tasa(tasa)
    return (bruto * tasa).quantize(paso, rounding=ROUND_HALF_UP)


def calcular_liquido(bruto: Decimal, tasa: Decimal) -> Decimal:
    """Líquido a pagar = bruto - retención. POR RESTA, nunca con fórmula propia.

    Si el líquido se calculara aparte como `redondear(bruto * (1 - tasa))`, los dos
    redondeos podrían tirar cada uno para su lado y la identidad
    `total_a_pagar + retencion_monto == total` dejaría de cerrar por un peso. Con
    un solo redondeo (el de la retención) y una resta, cierra siempre y por
    construcción, no por suerte aritmética (§3.3 del contrato).

    Ejemplo real de por qué importa: bruto 1.000.600 al 15,25 % da retención
    152.591,5 -> 152.592, y líquido por resta 848.008. Redondeando el líquido por
    separado daría 848.009, y 848.009 + 152.592 = 1.000.601: un peso que no existe.
    Un peso de diferencia no es cosmético — descuadra el asiento y el trigger de
    partida doble no deja salir el voucher de DRAFT.

    Si `bruto` trae decimales (moneda extranjera), el líquido los arrastra. La
    identidad sigue cerrando exacto contra el bruto que se recibió.
    """
    return bruto - calcular_retencion(bruto, tasa)


def bruto_desde_liquido(liquido: Decimal, tasa: Decimal) -> Decimal:
    """Gross-up: el honorario BRUTO que le deja `liquido` al profesional.

        bruto = liquido / (1 - tasa)

    Existe porque cuando se pacta "te pago $1.000.000" con un profesional casi
    siempre se está hablando del LÍQUIDO. El bruto que va en la OC y en la boleta
    de honorarios es 1.179.941, no 1.000.000 (§3.2). Cargar el líquido en el campo
    de bruto le hace cobrar ~15 % de menos, y es el error más frecuente de las
    planillas de Excel de todo Chile.

    Sobre la reversibilidad, que no es simétrica y conviene saberla:

    - `líquido -> bruto -> líquido` cierra EXACTO para montos enteros. No es
      casualidad: el error acumulado de los dos redondeos queda estrictamente por
      debajo de un peso, y entre dos enteros eso sólo puede ser cero.
    - `bruto -> líquido -> bruto` NO es reversible, y está bien que no lo sea.
      Varios brutos consecutivos comparten el mismo líquido (1.200.003 y 1.200.004
      pagan los dos 1.017.003 líquidos), así que desde el líquido no hay forma de
      saber cuál era. El gross-up devuelve uno de ellos, no necesariamente el
      original.

    Por eso el dato contractual es el BRUTO: es lo que se firma, lo que el
    prestador declara en su boleta de honorarios electrónica y la base sobre la
    que el mandante entera la retención al SII. El líquido es una consecuencia de
    él, nunca al revés.
    """
    _validar_tasa(tasa)
    if tasa >= 1:
        raise ValueError("Con retención del 100 % no existe un bruto finito que deje ese líquido")
    return _round_clp(liquido / (Decimal("1") - tasa))


# ---------------------------------------------------------------------------
# Totales de la OC
# ---------------------------------------------------------------------------


class TotalesOC(NamedTuple):
    """Las cinco cifras de una OC, en el orden en que las escribe la BD.

    Es una tupla de verdad: se puede desempaquetar
    `total_neto, iva, total, retencion_monto, total_a_pagar = ...` o leer por
    nombre. Se lee por nombre salvo que el orden sea evidente en el contexto.

    `total` conserva su semántica histórica `total = total_neto + iva` y
    `total_a_pagar` se agrega al lado; `total` NO se redefine como líquido. La
    regla para elegir cuál usar (§3.1) es corta: PLATA QUE SALE -> `total_a_pagar`
    (cuotas, hitos, voucher de pago, flujo de caja, "cuánto le debo"); VALOR DEL
    CONTRATO -> `total` (umbral de aprobación, monto contratado, reportes de
    compromiso). Un consumidor mal clasificado acá es un error de plata, no de
    estilo.
    """

    total_neto: Decimal
    iva: Decimal
    total: Decimal
    retencion_monto: Decimal
    total_a_pagar: Decimal


def normalizar_porcentajes(
    tipo_documento: str,
    iva_porcentaje: Decimal | None = None,
    retencion_porcentaje: Decimal | None = None,
    fecha_emision: date | None = None,
) -> tuple[Decimal, Decimal]:
    """Porcentajes efectivos `(iva, retención)` para el tipo de documento.

    Los dos en unidad porcentaje (19, 15.25). Esto es lo que hay que PERSISTIR en
    la OC, no lo que mandó el cliente: el servidor calcula, el cliente propone.

    La asimetría entre los dos casos incoherentes es deliberada (§4.3):

    - IVA > 0 en una exenta o en honorarios -> se PISA a 0 en silencio. Dejar un 19
      viejo en el campo al cambiar el tipo de documento es un descuido esperable
      del operador, y rechazarlo sólo le enseña a odiar el formulario.
    - Retención > 0 en una factura o boleta afecta -> levanta `ValueError` (la API
      lo traduce a 422). Eso no es un descuido: es una afirmación tributaria falsa
      y no hay forma de adivinar qué quiso decir.

    `None` significa AUSENCIA y cae al default; `0` significa CERO y se respeta tal
    cual. Prohibido resolver esto con `or`: Python trata `0` como falso y una OC
    exenta volvería a imprimir 19 % (§3.4 — el bug ya se cometió en esta tabla).

    El default de retención sale de la escala por `fecha_emision`, no de una
    constante: una OC con fecha 2027 tiene que traer 16 %. Lo ideal es que el
    llamador ya venga con el valor leído de `core.tax_config`.
    """
    _validar_tipo(tipo_documento)

    if tipo_documento in TIPOS_AFECTOS:
        iva_efectivo = iva_porcentaje if iva_porcentaje is not None else IVA_PORCENTAJE_GENERAL
    else:
        iva_efectivo = Decimal("0")

    if tipo_documento in TIPOS_CON_RETENCION:
        retencion_efectiva = (
            retencion_porcentaje
            if retencion_porcentaje is not None
            else porcentaje_retencion_por_fecha(fecha_emision)
        )
    else:
        if retencion_porcentaje is not None and retencion_porcentaje > 0:
            raise ValueError(
                f"Una OC de tipo {tipo_documento} no lleva retención: la retención del "
                "Art. 74 N°2 sólo aplica a la boleta de honorarios (HONORARIOS)"
            )
        retencion_efectiva = Decimal("0")

    _validar_porcentaje("IVA", iva_efectivo)
    _validar_porcentaje("retención", retencion_efectiva)
    return iva_efectivo, retencion_efectiva


def calcular_totales(
    tipo_documento: str,
    subtotal: Decimal,
    iva_porcentaje: Decimal | None = None,
    retencion_porcentaje: Decimal | None = None,
    fecha_emision: date | None = None,
    paso: Decimal = PASO_CLP,
) -> TotalesOC:
    """Las cinco cifras de la OC a partir de `subtotal` = suma del itemizado (B).

    Los porcentajes van en unidad porcentaje (19, 15.25), que es como los guardan
    `iva_porcentaje` y `retencion_porcentaje`.

    ```
    FACTURA / BOLETA   total_neto = B
                       iva        = redondear(B * iva%/100)
                       total      = total_neto + iva
                       retencion  = 0
                       a_pagar    = total

    FACTURA_EXENTA     total_neto = B ; iva = 0 ; total = B
                       retencion  = 0 ; a_pagar = total

    HONORARIOS         total_neto = B          <- honorario BRUTO
                       iva        = 0 ; total = B
                       retencion  = redondear(B * retención%/100)
                       a_pagar    = total - retencion   <- LÍQUIDO
    ```

    `subtotal` NO se redondea: llega como lo dejó la suma de las líneas y es lo que
    se guarda en `neto`. Redondearlo acá cambiaría el neto a espaldas del operador.

    La identidad `total_a_pagar + retencion_monto == total` cierra exacto siempre,
    porque el líquido sale por resta (§3.3).

    OJO, una regla que este motor NO conoce: la API no calcula IVA cuando la moneda
    no es CLP (en UF/USD el impuesto se liquida al convertir). Esa decisión es del
    llamador y vive en `app/api/v1/ordenes_compra.py`.

    `paso` es la unidad mínima de la moneda: 1 en pesos, 0.01 en UF y USD. El
    default de 1 mantiene el comportamiento histórico de los llamadores que no
    lo pasan; quien trabaje en UF DEBE pasar `paso_de_moneda(moneda)` o el IVA
    sale redondeado a la unidad entera, que en UF es casi $40.000.
    """
    iva_efectivo, retencion_efectiva = normalizar_porcentajes(
        tipo_documento,
        iva_porcentaje=iva_porcentaje,
        retencion_porcentaje=retencion_porcentaje,
        fecha_emision=fecha_emision,
    )

    total_neto = subtotal
    # Sin `if iva_efectivo`: con 0 % devuelve 0 igual, y la rama de más sería otra
    # oportunidad de confundir el cero con la ausencia.
    iva = calcular_iva(total_neto, porcentaje_a_tasa(iva_efectivo), paso)
    total = total_neto + iva

    # La retención se calcula sobre el BRUTO (= el neto), no sobre el total con
    # IVA. En honorarios son el mismo número porque el IVA es 0, pero escribirlo
    # sobre el neto deja explícito cuál es la base imponible.
    retencion_monto = calcular_retencion(
        total_neto, porcentaje_a_tasa(retencion_efectiva), paso
    )
    total_a_pagar = total - retencion_monto

    return TotalesOC(
        total_neto=total_neto,
        iva=iva,
        total=total,
        retencion_monto=retencion_monto,
        total_a_pagar=total_a_pagar,
    )
