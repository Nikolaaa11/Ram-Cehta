"""Asiento contable propuesto a partir de una orden de compra.

Hermano de `value_objects/retencion.py` y con las mismas reglas de juego: todo
`Decimal`, redondeo ROUND_HALF_UP al paso de la moneda, funciones puras — sin BD,
sin ORM, sin HTTPException. Quien llama traduce los `ValueError` de acá al 422 que
le corresponda (`vouchers.py` ya lo hace, y `oc_cuotas.py` pasa por ahí).

QUÉ HACE Y QUÉ NO HACE
----------------------
Toma las cinco cifras que la OC YA tiene guardadas (`neto`, `iva`, `total`,
`retencion_monto`, `total_a_pagar`) y las acomoda en líneas de partida doble. NO
recalcula la retención ni el IVA: esa aritmética vive en `calcular_totales` y es de
un solo dueño (ver el docstring de `retencion.py`). Si este módulo volviera a
multiplicar por la tasa, dos pantallas podrían mostrar números distintos para la
misma OC — y eso con plata no se descubre leyendo el código, se descubre cuando el
proveedor reclama.

LO QUE NO SE PUEDE SABER DESDE LA OC
-----------------------------------
`core.ordenes_compra` no tiene `cuenta_codigo`, ni proyecto, ni área. Para los
tipos que no son honorarios la línea de gasto sale con `cuenta_codigo = None` y el
asiento se marca INCOMPLETO. Proponer una cuenta inventada es peor que dejarla en
blanco: se guarda mal y nadie lo nota. En honorarios la cuenta de gasto sí se sabe
(`4201-02`), porque es la definición del documento, no una adivinanza.

EL ASIENTO DE LA BOLETA DE HONORARIOS
-------------------------------------
    4201-02  HONORARIOS PROFESIONALES ...... DEBE   bruto
    2105-04  RETENCIÓN PROFESIONALES ....... HABER  retención
    2102-11  HONORARIOS POR PAGAR .......... HABER  líquido

Cierra por construcción porque `bruto = retención + líquido` es la identidad que
`calcular_liquido` garantiza sacando el líquido POR RESTA, y que además tiene un
CHECK en la BD. No hay nada que recalcular acá: las tres cifras salen de la OC.

⚠️ La retención NO es un gasto de la empresa. Es plata del prestador que la empresa
retiene y entera al SII por él, así que va al PASIVO `2105-04` y nunca a una cuenta
de resultado. Mandarla a gasto se imputa como costo propio un impuesto ajeno y
descuadra el F29.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Final, Literal, NamedTuple

from app.domain.value_objects.retencion import (
    IVA_TRATAMIENTO_POR_TIPO,
    TIPOS_AFECTOS,
    TIPOS_CON_RETENCION,
    TIPOS_DOCUMENTO,
)

__all__ = [
    "CUENTA_HONORARIOS_GASTO",
    "CUENTA_HONORARIOS_POR_PAGAR",
    "CUENTA_IVA_CREDITO",
    "CUENTA_PROVEEDORES_POR_PAGAR",
    "CUENTA_RETENCION_HONORARIOS",
    "TIPOS_CON_CREDITO_FISCAL",
    "AsientoPropuesto",
    "Concepto",
    "HitoParcial",
    "LineaAsiento",
    "MontosOC",
    "montos_desde_fila",
    "proponer_asiento",
    "proponer_asientos_por_hitos",
]

# ---------------------------------------------------------------------------
# Cuentas del plan (core.plan_cuentas — GLOBAL, 212 cuentas)
# ---------------------------------------------------------------------------

# Verificadas contra el plan de cuentas: existen, son nivel 4 imputables y están
# habilitadas para las 11 empresas en `core.plan_cuenta_empresa`. Están acá como
# constantes con nombre y no sueltas en un dict para que cambiar una sea un solo
# renglón y para que el día que una no exista el error diga cuál.
CUENTA_HONORARIOS_GASTO: Final[str] = "4201-02"  # HONORARIOS PROFESIONALES (GASTO)
CUENTA_RETENCION_HONORARIOS: Final[str] = "2105-04"  # RETENCION PROFESIONALES (PASIVO)
CUENTA_HONORARIOS_POR_PAGAR: Final[str] = "2102-11"  # HONORARIOS POR PAGAR (PASIVO)
CUENTA_IVA_CREDITO: Final[str] = "1113-02"  # IVA CREDITO FISCAL (ACTIVO)
CUENTA_PROVEEDORES_POR_PAGAR: Final[str] = "2102-01"  # FACTURAS POR PAGAR, CORRIENTES

# Tipos cuyo IVA se propone como CRÉDITO FISCAL recuperable (activo `1113-02`) en vez
# de quedar dentro del gasto.
#
# ⚠️ DECISIÓN DE POLÍTICA CONTABLE, DELIBERADAMENTE EN UN SOLO LUGAR. El contrato
# (docs/MEGAPROMPT_VOUCHER_DESDE_OC.md §2.1) manda el mismo asiento para FACTURA y
# BOLETA, y eso es lo que está implementado. Queda anotado el reparo tributario para
# quien tenga que decidirlo: la boleta de ventas y servicios no da derecho a crédito
# fiscal (art. 23 N°1 del D.L. 825 — el crédito es el IVA recargado en FACTURAS), así
# que su IVA sería costo y debería ir dentro de la línea de gasto. Si esa decisión se
# toma, sacar "BOLETA" de este frozenset alcanza: el resto del módulo lo respeta solo
# y el asiento sigue cerrando, porque el gasto se calcula por resta y absorbe el IVA.
#
# No se deriva de `TIPOS_AFECTOS` a propósito: "la OC calcula IVA" y "el IVA es
# recuperable" son dos afirmaciones distintas que hoy coinciden. Atarlas haría que
# cambiar una cambiara la otra sin que nadie lo pida.
TIPOS_CON_CREDITO_FISCAL: Final[frozenset[str]] = frozenset({"FACTURA", "BOLETA"})

# Rol de cada línea dentro del asiento. Existe para que el endpoint y la UI puedan
# decir "ésta es la del líquido" sin comparar textos de glosa ni códigos de cuenta,
# que es como se rompen las pantallas cuando alguien edita una etiqueta.
Concepto = Literal["GASTO", "IVA_CREDITO", "RETENCION", "POR_PAGAR"]

# Explicación que va al lado de la cuenta en la pantalla. El contrato pide que la
# tercera línea de honorarios sea editable "con la explicación al lado": la
# explicación vive acá, junto a la decisión que explica, y no duplicada en el
# frontend donde nadie la actualizaría al cambiar el asiento.
_NOTA_POR_PAGAR_HONORARIOS: Final[str] = (
    "Default del DEVENGO: reconoce la deuda con el prestador. Si este voucher es el "
    "PAGO efectivo, cambiá la cuenta por la del banco desde donde sale la "
    "transferencia. La retención NO sale del banco: queda en 2105-04 hasta el F29."
)
_NOTA_GASTO_SIN_CUENTA: Final[str] = (
    "La OC no guarda cuenta contable, así que ésta la elegís vos. Es un gasto "
    "operativo: además de la cuenta necesita proyecto y área (imputación triple)."
)
_NOTA_RETENCION: Final[str] = (
    "Retención de 2ª categoría (Art. 74 N°2 LIR). No es gasto de la empresa: es plata "
    "del prestador que se entera al SII por él, por eso va al pasivo."
)


class MontosOC(NamedTuple):
    """Las cinco cifras de la OC más el tipo de documento y la moneda.

    Es exactamente lo que guardan las columnas de `core.ordenes_compra`, sin
    reinterpretar: `total` es el valor del contrato (para honorarios, el BRUTO) y
    `total_a_pagar` es la plata que sale (para honorarios, el LÍQUIDO). La regla de
    cuál usar está en el docstring de `TotalesOC`; acá se respetan las dos.
    """

    tipo_documento: str
    neto: Decimal
    iva: Decimal
    total: Decimal
    retencion_monto: Decimal
    total_a_pagar: Decimal
    moneda: str = "CLP"


class HitoParcial(NamedTuple):
    """Un hito de pago de la OC, para prorratear el asiento.

    `monto` es la porción de `total_a_pagar` de ESTE hito — es decir `oc_cuotas.monto`,
    tal cual lo dejó `_derivar_montos`. Va sobre el líquido y no sobre el bruto porque
    los hitos son PLATA QUE SALE: repartir sobre el bruto le transferiría al profesional
    también la retención, que la empresa después entera igual (o sea, la pagaría dos
    veces). Ese bug ya existió y está encandado en `test_oc_honorarios_integracion.py`.

    `acumulado_previo` es la suma de los montos de los hitos ANTERIORES a éste. No es
    burocracia: es lo que permite que el prorrateo de la retención cierre exacto sin
    que este módulo necesite ver la lista completa (ver `_prorratear_acumulado`).
    """

    monto: Decimal
    acumulado_previo: Decimal = Decimal("0")


class LineaAsiento(NamedTuple):
    """Una línea del asiento propuesto. `debit` XOR `credit`, como en la BD.

    `cuenta_codigo = None` significa "esto no se puede saber desde la OC, lo elige el
    operador". La línea igual trae su monto: lo que falta es la cuenta, no la plata.
    """

    concepto: Concepto
    cuenta_codigo: str | None
    debit: Decimal
    credit: Decimal
    glosa: str
    iva_tratamiento: str
    nota: str | None = None


class AsientoPropuesto(NamedTuple):
    """El asiento completo, con el veredicto de si se puede guardar tal cual.

    `completo` es False cuando alguna línea salió sin cuenta. No es un error: es el
    caso normal de FACTURA / BOLETA / FACTURA_EXENTA, donde la cuenta de gasto la
    elige el operador. Lo que NO puede pasar nunca es que `total_debe != total_haber`:
    eso lo garantiza la construcción y lo verifica `_verificar_partida_doble` antes de
    devolver.
    """

    lineas: tuple[LineaAsiento, ...]
    completo: bool
    faltantes: tuple[str, ...]
    total_debe: Decimal
    total_haber: Decimal


# ---------------------------------------------------------------------------
# Redondeo
# ---------------------------------------------------------------------------


def _paso_redondeo(moneda: str | None) -> Decimal:
    """Unidad mínima de la moneda: el peso chileno no tiene centavos, el resto sí.

    Gemelo deliberado de `_paso_redondeo` en `app/api/v1/oc_cuotas.py`. No se importa
    de allá porque el dominio no puede depender de la capa de API — pero las dos tienen
    que decir lo mismo: si divergen, el asiento de un hito no calza con el monto del
    hito que le dio origen.
    """
    return Decimal("1") if (moneda or "CLP").upper() == "CLP" else Decimal("0.01")


def _redondear(valor: Decimal, paso: Decimal) -> Decimal:
    """ROUND_HALF_UP al paso de la moneda. Mismo criterio que `_round_clp` en `iva.py`,
    generalizado: con `paso = 1` son la misma función."""
    return valor.quantize(paso, rounding=ROUND_HALF_UP)


def _prorratear_acumulado(
    total_a_repartir: Decimal,
    acumulado_previo: Decimal,
    monto_hito: Decimal,
    base_total: Decimal,
    paso: Decimal,
) -> Decimal:
    """Porción de `total_a_repartir` que le toca al hito, por REDONDEO ACUMULADO.

    En vez de redondear la porción de cada hito por separado —que deja una diferencia
    de hasta medio peso por hito y obliga a "dumpear" el residuo en alguno— se redondea
    el ACUMULADO hasta el final de cada hito y se resta el acumulado hasta el anterior:

        porción_i = redondear(T · Σ_{j<=i} m_j / L) - redondear(T · Σ_{j<i} m_j / L)

    La suma telescopea: `Σ porción_i = redondear(T · L / L) - redondear(0) = T`, exacto
    y sin casos especiales, siempre que los hitos cubran `L` completo.

    POR QUÉ ESTO Y NO OTRA COSA. El contrato pide que el residuo de redondeo lo absorba
    la línea del líquido y nunca la de la retención, "porque la retención se declara al
    SII y no admite ajuste de calce". El redondeo acumulado cumple esa regla de la única
    forma en que se puede cumplir de verdad:

    - No hay ningún hito que reciba el residuo de los demás. Cada retención es el
      redondeo honesto de su propio tramo; ninguna carga un ajuste de calce ajeno.
    - `Σ retención_i == retencion_monto` EXACTO, que es el número que se entera al SII y
      la razón por la que la regla existe.
    - El líquido de cada hito queda intacto — es `oc_cuotas.monto`, la plata que
      tesorería transfiere de verdad — y el residuo del reparto ya vive ahí desde antes:
      `_derivar_montos` se lo puso al último hito. O sea el residuo está en el líquido,
      tal como pide el contrato, sólo que puesto río arriba.

    (La alternativa ingenua —prorratear cada hito por separado y cerrar la diferencia en
    el último— era la otra lectura posible del contrato, y es peor: haría que el último
    hito declare al SII una retención que no es la de su propio tramo.)
    """
    hasta_este = _redondear(
        total_a_repartir * (acumulado_previo + monto_hito) / base_total, paso
    )
    hasta_el_anterior = _redondear(total_a_repartir * acumulado_previo / base_total, paso)
    return hasta_este - hasta_el_anterior


# ---------------------------------------------------------------------------
# Lectura de la fila de la OC
# ---------------------------------------------------------------------------


def _a_decimal(valor: Any, campo: str) -> Decimal:
    try:
        return Decimal(str(valor))
    except Exception as exc:  # el detalle del parser no le aporta nada al operador
        raise ValueError(f"el campo {campo} de la OC no es un número: {valor!r}") from exc


def montos_desde_fila(fila: Mapping[str, Any]) -> MontosOC:
    """Arma un `MontosOC` desde la fila cruda de `core.ordenes_compra`.

    Existe para que cada llamador no reinvente la conversión —y sobre todo para que no
    la reinvente con `or`, que confundiría un monto de 0 legítimo con un campo ausente
    (la trampa del cero falso, ya cometida en esta misma tabla)—.

    Cómo trata cada ausencia, que no es lo mismo en todos los campos:

    - `neto`, `total`: si faltan o vienen NULL, LEVANTA. Son la base del asiento; sin
      ellas no hay nada que proponer y adivinar un 0 escribiría un voucher vacío.
    - `iva`, `retencion_monto`: NULL significa "no aplica" y vale 0. Para el asiento un
      impuesto que no aplica y un impuesto de cero producen exactamente las mismas
      líneas, así que acá la distinción no cambia ninguna cifra.
    - `total_a_pagar`: un valor NULL cae a `total`, para cubrir la ventana entre el SQL
      y el deploy. Ojo con la asimetría: el VALOR puede ser NULL, pero la COLUMNA tiene
      que venir en la fila. Si faltan las dos columnas de retención a la vez, la
      verificación `total_a_pagar + retención == total` NO salta (0 + total == total) y
      una boleta de honorarios sale mandando a girar el bruto.
    - `moneda`: NULL cae a CLP, igual que `_paso_redondeo`.

    Si el SELECT del llamador no trae alguna columna, el error dice cuál.
    """
    # `retencion_monto` y `total_a_pagar` son OBLIGATORIAS aunque tengan
    # fallback: sin ellas, una OC de HONORARIOS degrada a retención 0 y
    # `total_a_pagar = total`, las dos validaciones de `_validar_oc` pasan
    # (0 + total == total) y el asiento sale de DOS líneas mandando a girar el
    # BRUTO. Cuadra la partida doble, así que ninguna red posterior lo frena:
    # el prestador cobraría el 15,25% de más y la retención no se registraría.
    # Un fallback que puede cambiar una cifra de plata tiene que LEVANTAR, no
    # degradar — el fallback a None sigue existiendo para el valor NULL en BD
    # (ventana entre el SQL y el deploy), pero la COLUMNA tiene que venir.
    faltan = [
        c
        for c in (
            "tipo_documento",
            "neto",
            "iva",
            "total",
            "retencion_monto",
            "total_a_pagar",
        )
        if c not in fila
    ]
    if faltan:
        raise ValueError(
            "la fila de la OC no trae "
            + ", ".join(faltan)
            + ". Hay que agregar esas columnas al SELECT: el asiento no se puede armar "
            "sin ellas"
        )

    tipo = fila["tipo_documento"]
    if tipo is None:
        raise ValueError("la OC no tiene tipo_documento y sin él no hay asiento posible")

    for campo in ("neto", "total"):
        if fila[campo] is None:
            raise ValueError(
                f"la OC tiene {campo} en NULL, que es la base del asiento. Hay que "
                "corregir la OC antes de generar el voucher"
            )

    iva = fila["iva"]
    retencion = fila.get("retencion_monto")
    a_pagar = fila.get("total_a_pagar")
    total = _a_decimal(fila["total"], "total")

    return MontosOC(
        tipo_documento=str(tipo),
        neto=_a_decimal(fila["neto"], "neto"),
        iva=Decimal("0") if iva is None else _a_decimal(iva, "iva"),
        total=total,
        retencion_monto=(
            Decimal("0") if retencion is None else _a_decimal(retencion, "retencion_monto")
        ),
        total_a_pagar=(total if a_pagar is None else _a_decimal(a_pagar, "total_a_pagar")),
        moneda=str(fila.get("moneda") or "CLP"),
    )


# ---------------------------------------------------------------------------
# Validaciones
# ---------------------------------------------------------------------------


def _validar_oc(oc: MontosOC) -> None:
    """Rechaza una OC cuyas cifras no cierran entre sí, ANTES de armar el asiento.

    Un asiento construido sobre totales incoherentes es un voucher mal nacido que
    después nadie sabe de dónde salió. Las dos identidades que se verifican son las que
    hacen que la partida doble cierre por construcción, así que si alguna falla el
    asiento no puede existir: hay que arreglar la OC.
    """
    if oc.tipo_documento not in TIPOS_DOCUMENTO:
        validos = ", ".join(TIPOS_DOCUMENTO)
        raise ValueError(
            f"tipo de documento desconocido: {oc.tipo_documento!r}. Los válidos son {validos}"
        )

    negativos = [
        nombre
        for nombre, valor in (
            ("neto", oc.neto),
            ("iva", oc.iva),
            ("total", oc.total),
            ("retencion_monto", oc.retencion_monto),
            ("total_a_pagar", oc.total_a_pagar),
        )
        if valor < 0
    ]
    if negativos:
        raise ValueError(
            "la OC tiene montos negativos en " + ", ".join(negativos) + ". Una nota de "
            "crédito se asienta al revés, no con signos invertidos en la OC"
        )

    if oc.neto + oc.iva != oc.total:
        raise ValueError(
            f"la OC no cuadra: neto ({oc.neto}) + IVA ({oc.iva}) da {oc.neto + oc.iva} "
            f"y su total dice {oc.total}. Con esas cifras el asiento no puede cerrar"
        )

    if oc.total_a_pagar + oc.retencion_monto != oc.total:
        raise ValueError(
            f"la OC no cuadra: líquido ({oc.total_a_pagar}) + retención "
            f"({oc.retencion_monto}) da {oc.total_a_pagar + oc.retencion_monto} y su "
            f"total dice {oc.total}. El líquido tiene que salir del total por resta"
        )

    if oc.tipo_documento not in TIPOS_AFECTOS and oc.iva != 0:
        raise ValueError(
            f"una OC de tipo {oc.tipo_documento} no lleva IVA, pero trae {oc.iva}. "
            "Proponer una línea de crédito fiscal sobre eso inflaría el F29"
        )

    if oc.tipo_documento not in TIPOS_CON_RETENCION and oc.retencion_monto != 0:
        raise ValueError(
            f"una OC de tipo {oc.tipo_documento} no lleva retención, pero trae "
            f"{oc.retencion_monto}. La retención del Art. 74 N°2 sólo aplica a la boleta "
            "de honorarios (HONORARIOS)"
        )


def _validar_hito(oc: MontosOC, hito: HitoParcial) -> None:
    """Rechaza un hito que no puede producir un asiento honesto.

    Las tres decisiones que documenta el contrato, y por qué cada una LEVANTA en vez de
    degradar (un fallback que mueve una cifra de plata no es un fallback, es un bug con
    buenos modales):

    - **Hito de 0**: no hay asiento. Las tres líneas darían 0, el validador XOR de
      `VoucherLineCreate` las rechaza una por una, y un voucher de cero no es una orden
      de pago sino un hito mal cargado. Se levanta acá con un mensaje que se entiende,
      en vez de dejar que reviente 422 abajo diciendo "debe tener debit O credit".
    - **Hito mayor que el total**: se levanta. Prorratear una fracción > 1 emitiría un
      voucher por más plata de la que la OC comprometió, y la retención declarada al SII
      sería mayor que la real. No se recorta al total en silencio: recortar cambiaría la
      cifra que el operador cargó sin avisarle cuál era el error.
    - **Base de reparto en 0**: se levanta por división por cero explícita. Pasa con una
      OC de honorarios al 100 % de retención (líquido 0): ahí no hay nada que repartir en
      hitos y el problema es la OC, no el asiento.
    """
    if hito.monto <= 0:
        raise ValueError(
            f"hay un hito de {hito.monto} y no se puede armar un asiento con eso: un "
            "voucher de cero no es una orden de pago. Revisá el reparto de los hitos"
        )
    if hito.acumulado_previo < 0:
        raise ValueError(
            f"el acumulado de los hitos anteriores no puede ser negativo, recibí "
            f"{hito.acumulado_previo}"
        )
    if oc.total_a_pagar <= 0:
        raise ValueError(
            f"la OC tiene un líquido de {oc.total_a_pagar}: no hay base sobre la cual "
            "repartir hitos. Si es una OC de honorarios con retención del 100 %, no hay "
            "líquido que transferir"
        )
    if hito.acumulado_previo + hito.monto > oc.total_a_pagar:
        raise ValueError(
            f"los hitos suman {hito.acumulado_previo + hito.monto} y la OC sólo "
            f"compromete {oc.total_a_pagar}. Un hito no puede pagar más de lo que la OC debe"
        )


def _verificar_partida_doble(lineas: Sequence[LineaAsiento]) -> tuple[Decimal, Decimal]:
    """Última red antes de devolver: Σdebe == Σhaber.

    Si esto salta no es culpa del que llamó, es un bug de este módulo — el asiento se
    arma justamente para que cierre por construcción. Levanta igual: un asiento
    descuadrado que sale de acá se convierte en un voucher que el trigger de partida
    doble va a frenar recién al salir de DRAFT, cuando ya nadie se acuerde de dónde vino.
    """
    debe = sum((linea.debit for linea in lineas), start=Decimal("0"))
    haber = sum((linea.credit for linea in lineas), start=Decimal("0"))
    if debe != haber:
        raise RuntimeError(
            f"El asiento propuesto no cuadra: debe {debe} vs haber {haber}. "
            "Es un defecto del armador, no de los datos de la OC."
        )
    return debe, haber


# ---------------------------------------------------------------------------
# Armado del asiento
# ---------------------------------------------------------------------------


def _linea(
    concepto: Concepto,
    cuenta_codigo: str | None,
    glosa: str,
    iva_tratamiento: str,
    *,
    debit: Decimal = Decimal("0"),
    credit: Decimal = Decimal("0"),
    nota: str | None = None,
) -> LineaAsiento:
    return LineaAsiento(
        concepto=concepto,
        cuenta_codigo=cuenta_codigo,
        debit=debit,
        credit=credit,
        glosa=glosa,
        iva_tratamiento=iva_tratamiento,
        nota=nota,
    )


def _armar(lineas: Sequence[LineaAsiento]) -> AsientoPropuesto:
    """Filtra las líneas en cero, verifica la partida doble y arma el resultado.

    Las líneas en cero se OMITEN, no se emiten con monto 0: el CHECK de `voucher_lines`
    y el validador `_xor_debit_credit` exigen que cada línea tenga debe o haber, y una
    línea de retención en 0 (tasa 0 legítima) o de IVA en 0 (factura al 0 % pactado)
    haría fallar el POST entero con un mensaje que no explica nada.
    """
    vivas = tuple(linea for linea in lineas if linea.debit != 0 or linea.credit != 0)
    if not vivas:
        raise ValueError(
            "el asiento quedó sin líneas porque todos los montos son cero. "
            "Una OC sin plata no genera voucher"
        )

    debe, haber = _verificar_partida_doble(vivas)
    faltantes = tuple(
        f"{linea.concepto}: falta elegir la cuenta contable"
        for linea in vivas
        if linea.cuenta_codigo is None
    )
    return AsientoPropuesto(
        lineas=vivas,
        completo=not faltantes,
        faltantes=faltantes,
        total_debe=debe,
        total_haber=haber,
    )


def proponer_asiento(oc: MontosOC, hito: HitoParcial | None = None) -> AsientoPropuesto:
    """Líneas propuestas del voucher para una OC, entera o prorrateada a un hito.

    Sin `hito` arma el asiento de la OC completa. Con `hito` arma el del tramo, con las
    tres (o dos) líneas prorrateadas — nunca copiando las de la OC entera, que sería
    emitir un voucher por el total en cada cuota.

    Los cuatro asientos (contrato §2 y §2.1):

    ```
    HONORARIOS       4201-02  DEBE   bruto
                     2105-04  HABER  retención
                     2102-11  HABER  líquido      <- editable: banco si es el pago

    FACTURA/BOLETA   (vacía)  DEBE   neto         <- la elige el operador
                     1113-02  DEBE   IVA
                     2102-01  HABER  total

    FACTURA_EXENTA   (vacía)  DEBE   total        <- la elige el operador
                     2102-01  HABER  total
    ```

    La partida doble cierra en los tres, con hito y sin hito, porque la línea que
    equilibra siempre se obtiene por SUMA o RESTA de las otras, jamás redondeando dos
    veces la misma cifra por caminos distintos.

    Levanta `ValueError` si la OC no cuadra consigo misma o si el hito es imposible
    (cero, negativo o mayor que el total). El llamador lo traduce a 422.
    """
    _validar_oc(oc)

    if hito is None:
        neto, iva, total = oc.neto, oc.iva, oc.total
        retencion, liquido = oc.retencion_monto, oc.total_a_pagar
    else:
        _validar_hito(oc, hito)
        paso = _paso_redondeo(oc.moneda)
        # La plata que sale en este hito es el dato duro: viene de `oc_cuotas.monto` y es
        # lo que tesorería transfiere. Todo lo demás se deriva de ella para que el
        # asiento no pueda contradecir a la transferencia.
        liquido = hito.monto
        retencion = _prorratear_acumulado(
            oc.retencion_monto, hito.acumulado_previo, hito.monto, oc.total_a_pagar, paso
        )
        iva = _prorratear_acumulado(
            oc.iva, hito.acumulado_previo, hito.monto, oc.total_a_pagar, paso
        )
        # Bruto y neto POR SUMA/RESTA de las cifras fiscales, nunca redondeando aparte:
        # así `neto + iva == total` y `retención + líquido == total` cierran exacto en
        # cada hito, que es lo que hace que el voucher pueda salir de DRAFT.
        total = liquido + retencion
        neto = total - iva

    tratamiento_gasto = IVA_TRATAMIENTO_POR_TIPO[oc.tipo_documento]

    if oc.tipo_documento in TIPOS_CON_RETENCION:
        return _armar(
            [
                _linea(
                    "GASTO",
                    CUENTA_HONORARIOS_GASTO,
                    "Honorarios profesionales (bruto)",
                    tratamiento_gasto,
                    debit=total,
                ),
                _linea(
                    "RETENCION",
                    CUENTA_RETENCION_HONORARIOS,
                    "Retención Art. 74 N°2 a enterar al SII",
                    # Balance puro: no es una operación afecta ni exenta, y marcarla
                    # AFECTO la haría contar como línea de IVA en el export a Nubox.
                    "NA",
                    credit=retencion,
                    nota=_NOTA_RETENCION,
                ),
                _linea(
                    "POR_PAGAR",
                    CUENTA_HONORARIOS_POR_PAGAR,
                    "Líquido a pagar al prestador",
                    "NA",
                    credit=liquido,
                    nota=_NOTA_POR_PAGAR_HONORARIOS,
                ),
            ]
        )

    if oc.tipo_documento in TIPOS_CON_CREDITO_FISCAL:
        return _armar(
            [
                _linea(
                    "GASTO",
                    None,
                    "Gasto (neto del documento)",
                    tratamiento_gasto,
                    debit=neto,
                    nota=_NOTA_GASTO_SIN_CUENTA,
                ),
                _linea(
                    "IVA_CREDITO",
                    CUENTA_IVA_CREDITO,
                    "IVA crédito fiscal",
                    "AFECTO",
                    debit=iva,
                ),
                _linea(
                    "POR_PAGAR",
                    CUENTA_PROVEEDORES_POR_PAGAR,
                    "Total a pagar al proveedor",
                    "NA",
                    credit=total,
                ),
            ]
        )

    # FACTURA_EXENTA, y cualquier tipo afecto al que se le saque el crédito fiscal: el
    # IVA (si lo hubiera) queda DENTRO del gasto. Por eso el debe va contra `total` y no
    # contra `neto` — así el asiento cierra sin línea de impuesto.
    return _armar(
        [
            _linea(
                "GASTO",
                None,
                "Gasto (documento sin crédito fiscal)",
                tratamiento_gasto,
                debit=total,
                nota=_NOTA_GASTO_SIN_CUENTA,
            ),
            _linea(
                "POR_PAGAR",
                CUENTA_PROVEEDORES_POR_PAGAR,
                "Total a pagar al proveedor",
                "NA",
                credit=total,
            ),
        ]
    )


def proponer_asientos_por_hitos(
    oc: MontosOC, montos_hitos: Sequence[Decimal]
) -> list[AsientoPropuesto]:
    """Un asiento por cada hito, con las cifras fiscales cerrando exacto contra la OC.

    `montos_hitos` son los `oc_cuotas.monto` en el orden de `numero_cuota`.

    ⚠️ HAY QUE PASAR TODOS LOS HITOS, no sólo los que están PENDIENTE. `generar-vouchers`
    emite vouchers únicamente para los hitos pendientes, pero el prorrateo se calcula
    sobre el reparto COMPLETO: cada hito necesita saber cuánto se repartió ANTES que él,
    o su retención sale de una base equivocada y `Σ retención` deja de coincidir con lo
    que se entera al SII. Se filtra después, al elegir qué asientos usar — nunca antes.

    Por eso también se exige que `Σ montos_hitos == total_a_pagar` y se levanta si no:
    esa igualdad es lo que `_derivar_montos` ya garantiza poniendo el residuo del reparto
    en el último hito, y si no se cumple es que llegaron hitos de menos.

    Garantías del resultado, todas exactas y verificadas en los tests:
    `Σ debe_i == Σ haber_i` en cada asiento · `Σ retención_i == retencion_monto` ·
    `Σ IVA_i == iva` · `Σ líquido_i == total_a_pagar` · `Σ bruto_i == total`.
    """
    if not montos_hitos:
        raise ValueError("no hay hitos que prorratear: la lista vino vacía")

    suma = sum(montos_hitos, start=Decimal("0"))
    if suma != oc.total_a_pagar:
        raise ValueError(
            f"los hitos suman {suma} y la OC compromete {oc.total_a_pagar}. Tienen que "
            "venir TODOS los hitos de la OC (no sólo los pendientes): el prorrateo de la "
            "retención se calcula sobre el reparto completo"
        )

    asientos: list[AsientoPropuesto] = []
    acumulado = Decimal("0")
    for monto in montos_hitos:
        asientos.append(proponer_asiento(oc, HitoParcial(monto=monto, acumulado_previo=acumulado)))
        acumulado += monto
    return asientos
