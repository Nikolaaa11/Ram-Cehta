/**
 * Reparto de un gasto CORFO entre fuentes — espejo TypeScript del motor
 * `backend/app/domain/value_objects/reparto_corfo.py`.
 *
 * # POR QUÉ EXISTE UN ESPEJO
 *
 * La ficha del gasto recalcula en vivo mientras Claudia tipea "50 / 20 /
 * 30": ir al servidor por cada tecla sería lento y, peor, la pantalla
 * podría mostrar un reparto distinto al que después guarda la API. Las dos
 * implementaciones tienen que dar EXACTAMENTE lo mismo, y para eso está
 * `lib/__tests__/reparto-corfo.test.ts`, que carga el mismo snapshot que
 * verifica el backend (`backend/tests/fixtures/reparto_corfo_esperado.json`).
 *
 * # PLATA EN CENTAVOS ENTEROS, NUNCA FLOAT
 *
 * - `total` y montos: `number` de CENTAVOS (94352.00 → 9435200).
 * - porcentajes: `number` de CENTÉSIMOS de punto (50.00 % → 5000; 100 % = 10000).
 *
 * Los productos intermedios (centavos × centésimos) superan 2^53 con totales
 * grandes, así que se multiplican con BigInt. El redondeo es HALF_UP como
 * `decimal.ROUND_HALF_UP` (lejos de cero en el medio exacto), no
 * `Math.round` (que va hacia +∞ con negativos).
 */
import type { EgresoRead, EgresoUpdate, Fuente, RepartoEstado } from "./types";

/** Orden canónico. También es el orden de desempate del residuo. */
export const FUENTES: readonly Fuente[] = [
  "subsidio",
  "cehta_ptec",
  "cehta",
  "trewaox",
];

export const ETIQUETAS: Record<Fuente, string> = {
  subsidio: "Subsidio CORFO",
  cehta_ptec: "Cehta · aporte P-tec",
  cehta: "Cehta (fuera del subsidio)",
  trewaox: "Trewaox · Innova Región",
};

export const ESTADO_SIN_CLASIFICAR: RepartoEstado = "SIN_CLASIFICAR";
export const ESTADO_OK: RepartoEstado = "OK";
export const ESTADO_DESCUADRADO: RepartoEstado = "DESCUADRADO";

/** 100,00 % en centésimos. */
export const CIEN_PCT = 10_000;
/** Tolerancia al validar que los porcentajes suman 100 (±0,01). */
const TOL_PCT = 1;

export type RepartoCentavos = Record<Fuente, number | null>;
export type PctCentesimos = Record<Fuente, number>;

export class RepartoInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepartoInvalidoError";
  }
}

/**
 * Neto o impuesto que no caben en el total (el otro daría negativo). La
 * pantalla lo muestra en un toast y NO guarda: es el mismo rechazo que
 * haría la API (`resolver_neto_impuesto`), pero antes de ir al servidor.
 */
export class MontosInvalidosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MontosInvalidosError";
  }
}

// ── Decimal string ↔ enteros ─────────────────────────────────────────────

/**
 * "5645105.9504" → 564510595 (centavos, HALF_UP al segundo decimal).
 *
 * Se parte el string en el punto en vez de hacer `Number(x) * 100`: con
 * float, "0.29" * 100 da 28.999999999999996 y el gasto pierde un centavo.
 * Acepta coma decimal por si el valor viene tipeado a la chilena.
 * Devuelve `null` si no hay número.
 */
export function decimalACentavos(valor: string | number | null | undefined): number | null {
  return aEnteroEscalado(valor, 2);
}

/** "33.33" → 3333 (centésimos de punto porcentual). */
export function pctACentesimos(valor: string | number | null | undefined): number | null {
  return aEnteroEscalado(valor, 2);
}

function aEnteroEscalado(
  valor: string | number | null | undefined,
  decimales: number,
): number | null {
  if (valor === null || valor === undefined) return null;
  let t = String(valor).trim().replace(/\s/g, "");
  if (t === "") return null;
  // Si viene con coma y sin punto, la coma es el decimal ("12,5").
  if (t.includes(",") && !t.includes(".")) t = t.replace(",", ".");
  const negativo = t.startsWith("-");
  t = t.replace(/^[+-]/, "");
  if (!/^\d*(\.\d*)?$/.test(t) || !/\d/.test(t)) return null;

  const [enteroRaw = "", fraccionRaw = ""] = t.split(".");
  const entero = enteroRaw === "" ? "0" : enteroRaw;
  const fraccion = fraccionRaw.padEnd(decimales, "0");
  const base = fraccion.slice(0, decimales);
  const resto = fraccion.slice(decimales);
  let escalado = BigInt(entero) * BigInt(10 ** decimales) + BigInt(base);
  // HALF_UP: si lo que sobra empieza en 5 o más, sube (lejos de cero).
  if (resto !== "" && Number(resto[0]) >= 5) escalado += 1n;
  const n = Number(escalado);
  return negativo ? -n : n;
}

/** 564510595 → "5645105.95". Siempre 2 decimales, como NUMERIC(18,2). */
export function centavosADecimal(centavos: number): string {
  return deEnteroEscalado(centavos, 2);
}

/** 3333 → "33.33". */
export function centesimosAPct(centesimos: number): string {
  return deEnteroEscalado(centesimos, 2);
}

function deEnteroEscalado(n: number, decimales: number): string {
  const negativo = n < 0;
  const abs = Math.abs(Math.trunc(n));
  const s = String(abs).padStart(decimales + 1, "0");
  const entero = s.slice(0, s.length - decimales);
  const frac = s.slice(s.length - decimales);
  return `${negativo ? "-" : ""}${entero}.${frac}`;
}

/** Centavos → pesos (number) sólo para MOSTRAR con `toCLP`; nunca para calcular. */
export function centavosAPesos(centavos: number): number {
  return centavos / 100;
}

// ── Aritmética HALF_UP con BigInt ────────────────────────────────────────

/** num / den redondeado HALF_UP (lejos de cero), como Decimal.quantize. */
function divHalfUp(num: bigint, den: bigint): bigint {
  if (den === 0n) return 0n;
  const negativo = num < 0n !== den < 0n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const q = (2n * a + b) / (2n * b);
  return negativo ? -q : q;
}

// ── El motor ─────────────────────────────────────────────────────────────

/**
 * Los 4 montos, o los 4 en `null` si no hay reparto.
 *
 * Todo-o-nada: si al menos UNA fuente trae valor, las que faltan pasan a 0
 * (no a null). Así "sin clasificar" es una sola cosa: las cuatro en null.
 */
export function normalizarMontos(
  montos: Partial<Record<Fuente, number | null | undefined>> | null | undefined,
): RepartoCentavos {
  const vacio: RepartoCentavos = {
    subsidio: null,
    cehta_ptec: null,
    cehta: null,
    trewaox: null,
  };
  if (!montos) return vacio;
  const crudos = FUENTES.map((f) => montos[f]);
  if (crudos.every((v) => v === null || v === undefined)) return vacio;
  const out = { ...vacio };
  for (const f of FUENTES) {
    const v = montos[f];
    out[f] = v === null || v === undefined ? 0 : Math.trunc(v);
  }
  return out;
}

/**
 * Porcentajes (centésimos) → montos (centavos) que suman EXACTAMENTE el total.
 *
 * - Cada porcentaje va de 0 a 100; las fuentes ausentes valen 0.
 * - La suma tiene que ser 100 (±0,01). Si no, `RepartoInvalidoError`.
 * - Cada monto se redondea a PESO entero (HALF_UP). El residuo (que puede
 *   incluir los centavos del total) va a la fuente con mayor porcentaje;
 *   en empate, a la primera según `FUENTES`.
 */
export function repartirPorPct(
  totalCentavos: number,
  pcts: Partial<Record<Fuente, number | null | undefined>>,
): Record<Fuente, number> {
  const total = Math.trunc(totalCentavos);
  if (total < 0) throw new RepartoInvalidoError("El total no puede ser negativo");
  const limpio = {} as PctCentesimos;
  for (const f of FUENTES) {
    const p = pcts[f];
    limpio[f] = p === null || p === undefined ? 0 : Math.trunc(p);
  }
  for (const f of FUENTES) {
    const p = limpio[f];
    if (p < 0 || p > CIEN_PCT) {
      throw new RepartoInvalidoError(
        `El porcentaje de ${ETIQUETAS[f]} tiene que estar entre 0 y 100 (llegó ${centesimosAPct(p)})`,
      );
    }
  }
  const suma = FUENTES.reduce((acc, f) => acc + limpio[f], 0);
  if (Math.abs(suma - CIEN_PCT) > TOL_PCT) {
    throw new RepartoInvalidoError(
      `Los porcentajes suman ${formatearPctCorto(suma)}%, tienen que sumar 100%`,
    );
  }

  // total_pesos × pct / 100, a peso entero HALF_UP:
  //   (centavos/100) × (centésimos/10000) = centavos × centésimos / 1e6 pesos.
  const montos = {} as Record<Fuente, number>;
  for (const f of FUENTES) {
    const pesos = divHalfUp(BigInt(total) * BigInt(limpio[f]), 1_000_000n);
    montos[f] = Number(pesos) * 100;
  }
  const residuo = total - FUENTES.reduce((acc, f) => acc + montos[f], 0);
  if (residuo !== 0) {
    const mayor = fuenteMayor(limpio);
    montos[mayor] += residuo;
  }
  return montos;
}

/**
 * Reescala un reparto cuando cambia el TOTAL, sin pasar por porcentajes.
 * Espejo exacto de `escalar_reparto` del motor Python.
 *
 * Por qué no se usa `pctDesdeMontos` + `repartirPorPct`: los porcentajes
 * tienen 2 decimales, y esa ida y vuelta movía $21 del Subsidio a Cehta en
 * una fila real (PROYECTA SPA) sin que nadie tocara el reparto. Acá cada
 * fuente se escala en proporción exacta (monto × nuevo / viejo, HALF_UP a
 * peso entero) y el residuo va a la fuente MAYOR (empate: la primera en
 * `FUENTES`), así la suma es exactamente el total nuevo.
 *
 * - Sin clasificar (las 4 en null) → sigue sin clasificar.
 * - DESCUADRADO contra el total viejo → `RepartoInvalidoError`: no se
 *   escala un reparto que no cierra; el llamador lo deja como está.
 * - Total viejo 0 → sólo se acepta si el nuevo también es 0.
 */
export function escalarReparto(
  totalViejoCentavos: number,
  totalNuevoCentavos: number,
  montos: Partial<Record<Fuente, number | null | undefined>> | null | undefined,
): RepartoCentavos {
  const limpio = normalizarMontos(montos);
  if (FUENTES.every((f) => limpio[f] === null)) return limpio;
  const viejo = Math.trunc(totalViejoCentavos);
  const nuevo = Math.trunc(totalNuevoCentavos);
  if (nuevo < 0) throw new RepartoInvalidoError("El total no puede ser negativo");
  if (estadoReparto(viejo, limpio) !== ESTADO_OK) {
    throw new RepartoInvalidoError(
      "El reparto no cuadra contra el total actual; corregilo antes de cambiar el total",
    );
  }
  if (viejo === nuevo) return limpio;
  if (viejo === 0) {
    throw new RepartoInvalidoError("No se puede escalar un reparto desde un total de $0");
  }
  const montosOk = {} as Record<Fuente, number>;
  for (const f of FUENTES) montosOk[f] = limpio[f] ?? 0;
  // monto × nuevo / viejo da centavos; el /100 extra lo lleva a PESOS
  // enteros (HALF_UP). Todo en BigInt: el producto supera 2^53 con totales
  // grandes.
  const escalados = {} as Record<Fuente, number>;
  for (const f of FUENTES) {
    const pesos = divHalfUp(BigInt(montosOk[f]) * BigInt(nuevo), BigInt(viejo) * 100n);
    escalados[f] = Number(pesos) * 100;
  }
  const residuo = nuevo - FUENTES.reduce((acc, f) => acc + escalados[f], 0);
  if (residuo !== 0) escalados[fuenteMayor(montosOk)] += residuo;
  return { ...escalados };
}

/** La fuente con mayor valor; empate → la primera en `FUENTES`. */
function fuenteMayor(valores: Record<Fuente, number>): Fuente {
  let mejor: Fuente = FUENTES[0]!;
  for (const f of FUENTES) {
    if (valores[f] > valores[mejor]) mejor = f;
  }
  return mejor;
}

/** SIN_CLASIFICAR / OK / DESCUADRADO. Compara a centavo exacto. */
export function estadoReparto(
  totalCentavos: number,
  montos: Partial<Record<Fuente, number | null | undefined>> | null | undefined,
): RepartoEstado {
  const limpio = normalizarMontos(montos);
  if (FUENTES.every((f) => limpio[f] === null)) return ESTADO_SIN_CLASIFICAR;
  const suma = FUENTES.reduce((acc, f) => acc + (limpio[f] ?? 0), 0);
  return suma === Math.trunc(totalCentavos) ? ESTADO_OK : ESTADO_DESCUADRADO;
}

/**
 * Porcentajes (centésimos) a partir de los montos, o `null` sin reparto.
 *
 * Si el reparto está OK, los porcentajes se ajustan para que sumen 100,00
 * exacto (el residuo va a la fuente mayor). Si está DESCUADRADO se
 * devuelven crudos: que NO sumen 100 es justamente lo que hay que mostrar.
 */
export function pctDesdeMontos(
  totalCentavos: number,
  montos: Partial<Record<Fuente, number | null | undefined>> | null | undefined,
): PctCentesimos | null {
  const limpio = normalizarMontos(montos);
  if (FUENTES.every((f) => limpio[f] === null)) return null;
  const total = Math.trunc(totalCentavos);
  const pcts = {} as PctCentesimos;
  if (total === 0) {
    for (const f of FUENTES) pcts[f] = 0;
    return pcts;
  }
  for (const f of FUENTES) {
    // monto / total × 100 → centésimos: monto × 10000 / total.
    pcts[f] = Number(divHalfUp(BigInt(limpio[f] ?? 0) * BigInt(CIEN_PCT), BigInt(total)));
  }
  if (estadoReparto(total, limpio) === ESTADO_OK) {
    const residuo = CIEN_PCT - FUENTES.reduce((acc, f) => acc + pcts[f], 0);
    if (residuo !== 0) pcts[fuenteMayor(pcts)] += residuo;
  }
  return pcts;
}

/** Suma de los montos cargados (0 si sin clasificar). */
export function sumaReparto(montos: RepartoCentavos): number {
  return FUENTES.reduce((acc, f) => acc + (montos[f] ?? 0), 0);
}

/** "3333" → "33.33", "10000" → "100", "5000" → "50" (sin ceros de relleno). */
export function formatearPctCorto(centesimos: number): string {
  return centesimosAPct(centesimos).replace(/\.?0+$/, "");
}

// ── Puente con la API (strings) ──────────────────────────────────────────

/** `reparto` de la API (strings o null) → centavos. */
export function repartoDesdeApi(
  reparto: Partial<Record<Fuente, string | null>> | null | undefined,
): RepartoCentavos {
  if (!reparto) return normalizarMontos(null);
  const out: Partial<Record<Fuente, number | null>> = {};
  for (const f of FUENTES) out[f] = decimalACentavos(reparto[f]);
  return normalizarMontos(out);
}

/** Centavos → `reparto` para la API (strings), o `null` sin clasificar. */
export function repartoParaApi(
  montos: RepartoCentavos,
): Record<Fuente, string> | null {
  const limpio = normalizarMontos(montos);
  if (FUENTES.every((f) => limpio[f] === null)) return null;
  const out = {} as Record<Fuente, string>;
  for (const f of FUENTES) out[f] = centavosADecimal(limpio[f] ?? 0);
  return out;
}

/**
 * Patch coherente al editar Neto, Impuesto o Total desde la grilla o la ficha.
 *
 * Es la misma regla que aplica la API (`resolver_neto_impuesto`), para que
 * la pantalla nunca muestre algo distinto de lo que después se guarda:
 *
 *   - editar Neto → el TOTAL queda fijo y el Impuesto pasa a ser total − neto;
 *   - editar Impuesto → el Total queda fijo y el Neto pasa a ser total − impuesto;
 *   - editar Total → el Neto absorbe (impuesto fijo; si ya no cabe, impuesto 0).
 *
 * Si neto o impuesto superan el total, el otro daría negativo: se lanza
 * `MontosInvalidosError` y NO se guarda (el llamador avisa en un toast).
 *
 * SÓLO editar el Total toca el reparto, y lo hace con `escalarReparto`
 * (proporción exacta, nunca por porcentajes). Un reparto DESCUADRADO o sin
 * clasificar se deja tal cual: no es de esta edición arreglarlo.
 *
 * Por qué cambió: antes editar Neto y después Impuesto recalculaba el total
 * dos veces y re-repartía por %, y el drift de redondeo movía plata entre
 * fuentes (PROYECTA: subsidio 496.451 → 496.430) sin que Claudia tocara el
 * reparto. Con el total fijo, neto/impuesto no pueden mover el reparto.
 */
export function patchMontos(
  egreso: Pick<EgresoRead, "monto_neto" | "impuesto" | "total" | "reparto" | "reparto_estado">,
  campo: "monto_neto" | "impuesto" | "total",
  nuevo: number | null,
): EgresoUpdate {
  const netoC = decimalACentavos(egreso.monto_neto);
  const impC = decimalACentavos(egreso.impuesto);
  const totC = decimalACentavos(egreso.total) ?? 0;
  const patch: EgresoUpdate = {};

  if (campo === "monto_neto") {
    // Vaciar el neto = "que lo calcule solo": total − impuesto vigente.
    const imp = impC ?? 0;
    const neto = nuevo === null ? totC - imp : nuevo;
    const resto = totC - neto;
    if (resto < 0) {
      throw new MontosInvalidosError(
        `El neto ${pesosLegibles(neto)} no puede superar el total ${pesosLegibles(totC)}`,
      );
    }
    patch.monto_neto = centavosADecimal(neto);
    patch.impuesto = centavosADecimal(resto);
    return patch;
  }

  if (campo === "impuesto") {
    // Vaciar el impuesto = impuesto 0 (boleta, exenta): el neto es el total.
    const imp = nuevo ?? 0;
    const resto = totC - imp;
    if (resto < 0) {
      throw new MontosInvalidosError(
        `El impuesto ${pesosLegibles(imp)} no puede superar el total ${pesosLegibles(totC)}`,
      );
    }
    patch.monto_neto = centavosADecimal(resto);
    patch.impuesto = centavosADecimal(imp);
    return patch;
  }

  // campo === "total"
  if (nuevo === null) return patch; // el total es obligatorio: no hay nada que mandar
  patch.total = centavosADecimal(nuevo);
  if (netoC !== null || impC !== null) {
    // Como la API: se conserva el impuesto y el neto absorbe; si el
    // impuesto ya no cabe en el total nuevo, se recalcula desde cero.
    const imp = impC ?? 0;
    if (imp <= nuevo) {
      patch.monto_neto = centavosADecimal(nuevo - imp);
      patch.impuesto = centavosADecimal(imp);
    } else {
      patch.monto_neto = centavosADecimal(nuevo);
      patch.impuesto = centavosADecimal(0);
    }
  }
  if (nuevo !== totC && egreso.reparto_estado === ESTADO_OK) {
    try {
      const paraApi = repartoParaApi(escalarReparto(totC, nuevo, repartoDesdeApi(egreso.reparto)));
      if (paraApi) patch.reparto = paraApi;
    } catch (e) {
      // Descuadrado contra el total viejo, o viejo $0: el reparto queda
      // como está y la API dirá lo suyo. No se inventa un reparto.
      if (!(e instanceof RepartoInvalidoError)) throw e;
    }
  }
  return patch;
}

/** $ legible para mensajes ("$94.352"), sin depender de `lib/format`. */
function pesosLegibles(centavos: number): string {
  const negativo = centavos < 0;
  const abs = Math.abs(Math.trunc(centavos));
  const pesos = Math.trunc(abs / 100);
  const cent = abs % 100;
  const entero = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = cent === 0 ? "" : `,${String(cent).padStart(2, "0")}`;
  return `${negativo ? "-" : ""}$${entero}${frac}`;
}

/** Presets de reparto de la ficha, en centésimos. */
export const PRESETS_REPARTO: ReadonlyArray<{
  id: string;
  label: string;
  pcts: Partial<Record<Fuente, number>> | null;
}> = [
  { id: "subsidio", label: "100% Subsidio", pcts: { subsidio: CIEN_PCT } },
  {
    id: "default",
    label: "50 / 20 / 30 (default proyecto)",
    pcts: { subsidio: 5000, cehta_ptec: 2000, cehta: 3000 },
  },
  { id: "cehta", label: "100% Cehta", pcts: { cehta: CIEN_PCT } },
  { id: "sin", label: "Sin clasificar", pcts: null },
];
