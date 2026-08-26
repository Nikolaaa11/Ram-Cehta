"""Motor de remuneraciones chilenas — funciones puras, sin BD.

# QUÉ CALCULA

Una liquidación de sueldo mensual chilena completa: haberes (imponibles y no
imponibles), descuentos del trabajador (AFP, salud, AFC, APV, impuesto único
de segunda categoría), aportes del empleador (AFC, SIS, mutual, reforma
previsional ley 21.735) y el costo empresa total.

# POR QUÉ NUNCA ADIVINA

La mitad de estos números depende de parámetros que cambian todos los meses
(UF, UTM) o varias veces al año (ingreso mínimo, comisiones AFP, SIS, el
calendario de la reforma). `ParametrosMes` los recibe TODOS de afuera y, si
falta uno crítico, `calcular_liquidacion` levanta `ParametroFaltante` con un
mensaje accionable en vez de producir un resultado plausible y falso. Un
cálculo con parámetros vencidos es un error disfrazado de resultado.

# CALIBRACIÓN CONTRA EL LIBRO REAL

Las convenciones de redondeo y de base tributable NO son teóricas: están
calibradas contra el libro de remuneraciones de MCG Consultores (AFIS, abril
2026, `core.libro_remuneraciones_lineas`), del que se descifró:

    IMM abril 2026            $539.000   (tope gratificación 213.354 = 4,75·IMM/12)
    UTM abril 2026            $69.889    (impuesto único al centavo, 2 líneas)
    SIS                       1,62 %
    Reforma ley 21.735        0,1 % cuenta individual + 0,9 % seguro social
    Mutual AFIS               2,63 %     (0,93 base + adicional por actividad)

La línea completa de un empleado real (Fonasa, AFP comisión 1,44 %) se
reproduce EXACTA: imponible 2.200.000 → previsionales 418.880 → base
tributable 1.781.120 → impuesto 33.504,74 → líquido 1.747.615. Ese es el
golden test maestro en `tests/unit/test_remuneracion.py`.

Convenciones adoptadas del libro (para conciliar 1:1 con el contador):
  · el impuesto único se calcula y guarda con 2 DECIMALES;
  · `total_descuentos = previsionales + impuesto redondeado a peso`;
  · `base_tributable = imponible topado - previsionales del trabajador`
    (si es isapre, rebaja el plan completo en UF, como lo hace MCG);
  · todo lo demás en pesos enteros, HALF_UP.

# LA JORNADA CAMBIA POR LEY

Ley 21.561: 45→44 horas en abril 2024, 44→42 en abril 2026, 42→40 en 2028.
El valor de la hora extra depende de la jornada, así que `jornada_horas` es
un parámetro del PERÍODO, no una constante.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Final

__all__ = [
    "TRAMOS_IMPUESTO_UTM",
    "EntradaLiquidacion",
    "LiquidacionResultado",
    "ParametroFaltanteError",
    "ParametrosMes",
    "calcular_liquidacion",
    "gratificacion_art50",
    "impuesto_unico",
    "valor_hora_extra",
]

_PESO: Final = Decimal("1")
_CENT: Final = Decimal("0.01")


def _peso(v: Decimal) -> Decimal:
    """Redondeo a peso entero, HALF_UP — el peso chileno no tiene centavos."""
    return v.quantize(_PESO, rounding=ROUND_HALF_UP)


class ParametroFaltanteError(ValueError):
    """Falta un indicador del período. El mensaje dice CUÁL y dónde cargarlo."""


# ---------------------------------------------------------------------------
# Impuesto único de segunda categoría
# ---------------------------------------------------------------------------
# Tramos MENSUALES en UTM — son de LEY (art. 43 LIR) y estables; lo que varía
# mes a mes es el VALOR de la UTM, que es parámetro. (límite superior, tasa %).
TRAMOS_IMPUESTO_UTM: Final[tuple[tuple[Decimal | None, Decimal], ...]] = (
    (Decimal("13.5"), Decimal("0")),
    (Decimal("30"), Decimal("4")),
    (Decimal("50"), Decimal("8")),
    (Decimal("70"), Decimal("13.5")),
    (Decimal("90"), Decimal("23")),
    (Decimal("120"), Decimal("30.4")),
    (Decimal("310"), Decimal("35")),
    (None, Decimal("40")),
)


def _rebajas_por_continuidad() -> tuple[Decimal, ...]:
    """La 'cantidad a rebajar' de cada tramo, DERIVADA, no tabulada.

    En el límite entre dos tramos el impuesto tiene que ser continuo:
    rebaja_n = rebaja_{n-1} + límite_{n-1} x (tasa_n - tasa_{n-1}). Derivarla
    hace IMPOSIBLE que tasas y rebajas queden desalineadas — que es el error
    clásico al copiar la tabla del SII a mano. En UTM.
    """
    rebajas = [Decimal("0")]
    for i in range(1, len(TRAMOS_IMPUESTO_UTM)):
        limite_prev = TRAMOS_IMPUESTO_UTM[i - 1][0]
        assert limite_prev is not None
        delta = (TRAMOS_IMPUESTO_UTM[i][1] - TRAMOS_IMPUESTO_UTM[i - 1][1]) / 100
        rebajas.append(rebajas[-1] + limite_prev * delta)
    return tuple(rebajas)


_REBAJAS_UTM: Final = _rebajas_por_continuidad()


def impuesto_unico(base_tributable: Decimal, utm: Decimal) -> Decimal:
    """Impuesto único mensual, con 2 decimales (como lo guarda el contador).

    Verificado al CENTAVO contra dos líneas reales del libro de MCG
    (UTM 69.889): base 1.035.744 → 3.689,70 · base 1.781.120 → 33.504,74.
    """
    if utm <= 0:
        raise ParametroFaltanteError(
            "Falta la UTM del período (o es inválida). Cargala en "
            "Remuneraciones → Parámetros del mes; el valor lo publica el SII."
        )
    if base_tributable <= 0:
        return Decimal("0.00")
    base_utm = base_tributable / utm
    for (limite, tasa), rebaja in zip(TRAMOS_IMPUESTO_UTM, _REBAJAS_UTM, strict=True):
        if limite is None or base_utm <= limite:
            bruto = base_tributable * tasa / 100 - rebaja * utm
            return max(bruto, Decimal("0")).quantize(_CENT, rounding=ROUND_HALF_UP)
    raise AssertionError("tramos mal definidos")  # pragma: no cover


# ---------------------------------------------------------------------------
# Gratificación y horas extra
# ---------------------------------------------------------------------------


def gratificacion_art50(devengado_imponible: Decimal, ingreso_minimo: Decimal) -> Decimal:
    """Gratificación legal Art. 50 CT: 25 % de lo devengado, tope 4,75 IMM/12.

    El tope mensual con IMM 539.000 es 213.354 — exactamente lo que paga MCG
    en el libro de abril 2026, para sueldos donde el 25 % lo supera.
    """
    if ingreso_minimo <= 0:
        raise ParametroFaltanteError(
            "Falta el ingreso mínimo mensual del período. Cargalo en "
            "Remuneraciones → Parámetros del mes."
        )
    tope_mensual = ingreso_minimo * Decimal("4.75") / 12
    return _peso(min(devengado_imponible * Decimal("0.25"), tope_mensual))


def valor_hora_extra(
    sueldo_base_mensual: Decimal,
    jornada_horas: Decimal,
    recargo_pct: Decimal = Decimal("50"),
) -> Decimal:
    """Valor de UNA hora extra: sueldo x (1/30) x (7/jornada) x (1+recargo).

    Con jornada 45 el factor clásico es 0,0077778; con la jornada de 42 horas
    vigente desde abril 2026 (ley 21.561) el factor SUBE a 0,0083333 — usar el
    factor viejo paga de menos cada hora extra desde esa fecha.
    """
    if jornada_horas <= 0:
        raise ParametroFaltanteError("Falta la jornada semanal del período.")
    factor = (Decimal("7") / jornada_horas / 30) * (1 + recargo_pct / 100)
    return _peso(sueldo_base_mensual * factor)


# ---------------------------------------------------------------------------
# Parámetros y entrada
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ParametrosMes:
    """Los indicadores del período. TODO viene de afuera; nada se adivina.

    `uf` y `utm` admiten None = "todavía no se cargaron": el motor se niega a
    calcular y lo dice. Las tasas tienen los defaults LEGALES estables; las
    que cambian por licitación o calendario (SIS, reforma, comisiones AFP)
    vienen sembradas de la BD y son editables ahí.
    """

    periodo: str  # "YYYY-MM"
    uf: Decimal | None
    utm: Decimal | None
    ingreso_minimo: Decimal
    tope_imponible_uf: Decimal = Decimal("87.8")
    tope_afc_uf: Decimal = Decimal("131.9")
    jornada_horas: Decimal = Decimal("42")  # ley 21.561, desde abril 2026
    cotizacion_afp_pct: Decimal = Decimal("10")
    salud_legal_pct: Decimal = Decimal("7")
    afc_trab_indefinido_pct: Decimal = Decimal("0.6")
    afc_emp_indefinido_pct: Decimal = Decimal("2.4")
    afc_emp_plazo_fijo_pct: Decimal = Decimal("3.0")
    sis_pct: Decimal = Decimal("1.62")  # libro MCG abril 2026
    mutual_pct: Decimal = Decimal("0.93")  # base ley 16.744; adicional por empresa
    reforma_cuenta_individual_pct: Decimal = Decimal("0.1")  # ley 21.735
    reforma_seguro_social_pct: Decimal = Decimal("0.9")
    #: comisión por AFP, en % (Capital 1.44, Modelo 0.58…). Editable en BD.
    comisiones_afp: dict[str, Decimal] = field(default_factory=dict)
    #: tramos de asignación familiar: (tope de ingreso o None, monto por carga).
    asignacion_familiar: tuple[tuple[Decimal | None, Decimal], ...] = ()
    #: tope mensual de APV que rebaja base tributable (régimen B): 50 UF.
    apv_tope_uf: Decimal = Decimal("50")

    def exigir_uf(self) -> Decimal:
        if self.uf is None or self.uf <= 0:
            raise ParametroFaltanteError(
                f"Falta la UF del período {self.periodo}. Cargala en "
                "Remuneraciones → Parámetros del mes (valor del último día "
                "del mes, lo publica el SII)."
            )
        return self.uf

    def exigir_utm(self) -> Decimal:
        if self.utm is None or self.utm <= 0:
            raise ParametroFaltanteError(
                f"Falta la UTM del período {self.periodo}. Cargala en "
                "Remuneraciones → Parámetros del mes (la publica el SII)."
            )
        return self.utm

    def comision_afp(self, afp: str | None) -> Decimal:
        """Comisión de la AFP del trabajador. Sin AFP conocida NO se adivina."""
        if not afp:
            raise ParametroFaltanteError(
                "El trabajador no tiene AFP asignada. Elegila en el formulario "
                "o cargala en su ficha de RRHH — la comisión cambia el líquido."
            )
        clave = afp.strip().upper()
        for nombre, com in self.comisiones_afp.items():
            if nombre.strip().upper() == clave:
                return com
        raise ParametroFaltanteError(
            f"No hay comisión cargada para la AFP «{afp}» en el período "
            f"{self.periodo}. Cargala en Remuneraciones → Parámetros del mes "
            "(el valor está en Previred)."
        )


@dataclass(frozen=True)
class EntradaLiquidacion:
    """Lo que describe a UN trabajador en UN mes. Todo lo demás es parámetro."""

    sueldo_base: Decimal
    dias_trabajados: Decimal = Decimal("30")
    horas_extra: Decimal = Decimal("0")
    recargo_horas_extra_pct: Decimal = Decimal("50")
    comisiones: Decimal = Decimal("0")
    bonos_imponibles: Decimal = Decimal("0")
    #: ART50_TOPE (25 % con tope legal) | MONTO_FIJO (convenida) | NINGUNA
    gratificacion_tipo: str = "ART50_TOPE"
    gratificacion_monto_fijo: Decimal = Decimal("0")
    colacion: Decimal = Decimal("0")
    movilizacion: Decimal = Decimal("0")
    viaticos: Decimal = Decimal("0")
    otros_no_imponibles: Decimal = Decimal("0")
    cargas_familiares: int = 0
    afp: str | None = None
    #: FONASA | ISAPRE
    salud_sistema: str = "FONASA"
    isapre_plan_uf: Decimal = Decimal("0")
    #: INDEFINIDO | PLAZO_FIJO
    tipo_contrato: str = "INDEFINIDO"
    apv_mensual: Decimal = Decimal("0")
    anticipos: Decimal = Decimal("0")
    otros_descuentos: Decimal = Decimal("0")
    #: pisa el mutual del período cuando la empresa tiene adicional (AFIS 2,63).
    mutual_pct_override: Decimal | None = None


@dataclass(frozen=True)
class LiquidacionResultado:
    """El desglose completo. Los nombres calzan 1:1 con las columnas del libro
    de MCG (`core.libro_remuneraciones_lineas`) para poder conciliar."""

    # Haberes
    sueldo_proporcional: Decimal
    horas_extra_monto: Decimal
    comisiones: Decimal
    bonos_imponibles: Decimal
    gratificacion: Decimal
    total_imponible: Decimal
    colacion: Decimal
    movilizacion: Decimal
    viaticos: Decimal
    otros_no_imponibles: Decimal
    asignacion_familiar: Decimal
    total_no_imponible: Decimal
    total_haberes: Decimal
    # Bases
    base_cotizaciones: Decimal
    base_afc: Decimal
    base_tributable: Decimal
    # Descuentos del trabajador
    afp_cotizacion: Decimal
    afp_comision: Decimal
    salud_legal: Decimal
    salud_adicional_isapre: Decimal
    afc_trabajador: Decimal
    apv: Decimal
    total_previsionales: Decimal
    impuesto_unico: Decimal  # 2 decimales, como MCG
    anticipos: Decimal
    otros_descuentos: Decimal
    total_descuentos: Decimal
    liquido: Decimal
    # Aportes del empleador
    afc_empleador: Decimal
    sis: Decimal
    mutual: Decimal
    reforma_cuenta_individual: Decimal
    reforma_seguro_social: Decimal
    total_aportes_empleador: Decimal
    costo_empresa: Decimal
    # Qué conviene saber del cálculo (tope alcanzado, etc.). Nunca vacío de
    # información crítica: si algo IMPIDE calcular, es excepción, no aviso.
    advertencias: tuple[str, ...]


# ---------------------------------------------------------------------------
# El cálculo
# ---------------------------------------------------------------------------


def calcular_liquidacion(
    e: EntradaLiquidacion, p: ParametrosMes
) -> LiquidacionResultado:
    """Una liquidación completa. Pura: mismos argumentos, mismo resultado.

    Las identidades que SIEMPRE cierran (fijadas por tests):
      total_haberes = imponible + no imponible
      base_tributable = base_cotizaciones - previsionales
      total_descuentos = previsionales + peso(impuesto) + anticipos + otros
      líquido = total_haberes - total_descuentos
      costo_empresa = total_haberes + aportes del empleador
    """
    avisos: list[str] = []
    uf = p.exigir_uf()

    if e.dias_trabajados <= 0 or e.dias_trabajados > 30:
        raise ValueError("Los días trabajados van de 1 a 30 (mes comercial).")
    if e.sueldo_base < 0:
        raise ValueError("El sueldo base no puede ser negativo.")

    # ── Haberes imponibles ───────────────────────────────────────────────
    sueldo_prop = _peso(e.sueldo_base * e.dias_trabajados / 30)
    if e.dias_trabajados != 30:
        avisos.append(
            f"Mes parcial: {e.dias_trabajados} de 30 días — el sueldo va "
            "proporcional."
        )
    vh = valor_hora_extra(e.sueldo_base, p.jornada_horas, e.recargo_horas_extra_pct)
    he_monto = _peso(vh * e.horas_extra)
    if e.horas_extra > 0:
        avisos.append(
            f"Hora extra a ${vh:,.0f} con jornada de {p.jornada_horas} h "
            "(ley 21.561)."
        )

    devengado = sueldo_prop + he_monto + _peso(e.comisiones) + _peso(e.bonos_imponibles)

    tipo_grat = (e.gratificacion_tipo or "ART50_TOPE").upper()
    if tipo_grat == "ART50_TOPE":
        gratificacion = gratificacion_art50(devengado, p.ingreso_minimo)
        tope = _peso(p.ingreso_minimo * Decimal("4.75") / 12)
        if gratificacion == tope:
            avisos.append(
                f"Gratificación al tope legal Art. 50: 4,75xIMM/12 = ${tope:,.0f}."
            )
    elif tipo_grat == "MONTO_FIJO":
        gratificacion = _peso(e.gratificacion_monto_fijo)
    elif tipo_grat == "NINGUNA":
        gratificacion = Decimal("0")
    else:
        raise ValueError(f"Tipo de gratificación desconocido: {e.gratificacion_tipo}")

    total_imponible = devengado + gratificacion

    # ── Bases topadas ────────────────────────────────────────────────────
    tope_imp = _peso(p.tope_imponible_uf * uf)
    tope_afc = _peso(p.tope_afc_uf * uf)
    base_cot = min(total_imponible, tope_imp)
    base_afc = min(total_imponible, tope_afc)
    if total_imponible > tope_imp:
        avisos.append(
            f"El imponible supera el tope de {p.tope_imponible_uf} UF: se "
            f"cotiza por ${base_cot:,.0f}."
        )

    # ── No imponibles ────────────────────────────────────────────────────
    asignacion = Decimal("0")
    if e.cargas_familiares > 0:
        if not p.asignacion_familiar:
            raise ParametroFaltanteError(
                "El trabajador tiene cargas familiares pero el período no "
                "tiene los tramos de asignación familiar cargados."
            )
        monto_carga = Decimal("0")
        for tope_tramo, monto in p.asignacion_familiar:
            if tope_tramo is None or total_imponible <= tope_tramo:
                monto_carga = monto
                break
        asignacion = _peso(monto_carga * e.cargas_familiares)
        if asignacion == 0:
            avisos.append(
                "Por el nivel de renta, la asignación familiar es $0 (tramo D)."
            )

    total_no_imp = (
        _peso(e.colacion) + _peso(e.movilizacion) + _peso(e.viaticos)
        + _peso(e.otros_no_imponibles) + asignacion
    )
    total_haberes = total_imponible + total_no_imp

    # ── Descuentos del trabajador ────────────────────────────────────────
    afp_cot = _peso(base_cot * p.cotizacion_afp_pct / 100)
    afp_com = _peso(base_cot * p.comision_afp(e.afp) / 100)

    salud_legal = _peso(base_cot * p.salud_legal_pct / 100)
    salud_adicional = Decimal("0")
    sistema = (e.salud_sistema or "FONASA").upper()
    if sistema == "ISAPRE":
        plan = _peso(e.isapre_plan_uf * uf)
        if plan < salud_legal:
            # El plan no puede ser menor que el 7 % legal: se cobra el 7 %.
            avisos.append(
                f"El plan Isapre (${plan:,.0f}) es menor al 7 % legal: se "
                "descuenta el 7 %."
            )
        salud_adicional = max(plan - salud_legal, Decimal("0"))
    elif sistema != "FONASA":
        raise ValueError(f"Sistema de salud desconocido: {e.salud_sistema}")

    contrato = (e.tipo_contrato or "INDEFINIDO").upper()
    if contrato == "INDEFINIDO":
        afc_trab = _peso(base_afc * p.afc_trab_indefinido_pct / 100)
        afc_emp = _peso(base_afc * p.afc_emp_indefinido_pct / 100)
    elif contrato == "PLAZO_FIJO":
        # A plazo fijo TODO el AFC (3,0 %) es del empleador.
        afc_trab = Decimal("0")
        afc_emp = _peso(base_afc * p.afc_emp_plazo_fijo_pct / 100)
    else:
        raise ValueError(f"Tipo de contrato desconocido: {e.tipo_contrato}")

    apv = _peso(e.apv_mensual)
    apv_tope = _peso(p.apv_tope_uf * uf)
    if apv > apv_tope:
        avisos.append(
            f"El APV supera el tope de {p.apv_tope_uf} UF: sólo "
            f"${apv_tope:,.0f} rebaja la base tributable."
        )

    # Convención del libro de MCG: los previsionales que rebajan la base
    # tributable incluyen el plan Isapre COMPLETO. `min` con el tope de APV.
    previsionales = afp_cot + afp_com + salud_legal + salud_adicional + afc_trab
    base_trib = max(base_cot - previsionales - min(apv, apv_tope), Decimal("0"))

    imp = impuesto_unico(base_trib, p.exigir_utm())

    total_desc = (
        previsionales + apv + _peso(imp) + _peso(e.anticipos) + _peso(e.otros_descuentos)
    )
    liquido = total_haberes - total_desc
    if liquido < 0:
        avisos.append(
            "El líquido quedó NEGATIVO: los descuentos superan los haberes. "
            "Revisá anticipos y otros descuentos."
        )

    # ── Aportes del empleador ────────────────────────────────────────────
    mutual_pct = (
        e.mutual_pct_override if e.mutual_pct_override is not None else p.mutual_pct
    )
    sis = _peso(base_cot * p.sis_pct / 100)
    mutual = _peso(base_cot * mutual_pct / 100)
    ref_ci = _peso(base_cot * p.reforma_cuenta_individual_pct / 100)
    ref_ss = _peso(base_cot * p.reforma_seguro_social_pct / 100)
    aportes = afc_emp + sis + mutual + ref_ci + ref_ss

    return LiquidacionResultado(
        sueldo_proporcional=sueldo_prop,
        horas_extra_monto=he_monto,
        comisiones=_peso(e.comisiones),
        bonos_imponibles=_peso(e.bonos_imponibles),
        gratificacion=gratificacion,
        total_imponible=total_imponible,
        colacion=_peso(e.colacion),
        movilizacion=_peso(e.movilizacion),
        viaticos=_peso(e.viaticos),
        otros_no_imponibles=_peso(e.otros_no_imponibles),
        asignacion_familiar=asignacion,
        total_no_imponible=total_no_imp,
        total_haberes=total_haberes,
        base_cotizaciones=base_cot,
        base_afc=base_afc,
        base_tributable=base_trib,
        afp_cotizacion=afp_cot,
        afp_comision=afp_com,
        salud_legal=salud_legal,
        salud_adicional_isapre=salud_adicional,
        afc_trabajador=afc_trab,
        apv=apv,
        total_previsionales=previsionales,
        impuesto_unico=imp,
        anticipos=_peso(e.anticipos),
        otros_descuentos=_peso(e.otros_descuentos),
        total_descuentos=total_desc,
        liquido=liquido,
        afc_empleador=afc_emp,
        sis=sis,
        mutual=mutual,
        reforma_cuenta_individual=ref_ci,
        reforma_seguro_social=ref_ss,
        total_aportes_empleador=aportes,
        costo_empresa=total_haberes + aportes,
        advertencias=tuple(avisos),
    )
