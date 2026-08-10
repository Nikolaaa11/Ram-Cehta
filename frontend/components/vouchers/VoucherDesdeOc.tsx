"use client";

/**
 * VoucherDesdeOc — el puente OC ↔ voucher del lado del frontend.
 *
 * Cuatro piezas que comparten un solo contrato de datos, `LineaPropuesta[]`:
 *
 *   1. `TIPOS_DOCUMENTO_VOUCHER`    — el selector de tipo de documento con las
 *      etiquetas en castellano agrupadas, mismo criterio que ya quedó en
 *      `ordenes-compra/nueva`. Ahí vive la razón de por qué el `value` es el
 *      token SII crudo y la etiqueta bonita es presentación.
 *   2. `OcTypeahead`                — elegir una OC desde el alta de voucher.
 *   3. `HonorariosAsistente`        — boleta de honorarios SIN OC: bruto +
 *      tasa, las tres cifras a la vista, y el asiento armado.
 *   4. `CrearVoucherDesdeOcButton`  — la acción en el detalle de la OC. Si la
 *      OC ya tiene voucher, lleva AL QUE EXISTE en vez de ofrecer otro.
 *
 * Por qué viven juntos: los cuatro producen lo mismo — líneas que el form de
 * alta pinta EDITABLES. Nada se guarda sin que el operador vea el asiento: es
 * lo que después firma.
 *
 * Lo que este archivo NO hace: decidir la cuenta de gasto de una
 * factura/boleta/exenta. La OC no tiene `cuenta_codigo` y proponer una
 * inventada es peor que dejarla en blanco — se guarda mal y nadie lo nota.
 * Esas líneas salen con `requiereCuenta: true` y el form bloquea el guardado.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Route } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  Calculator,
  ExternalLink,
  FileText,
  Link2,
} from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import {
  useProveedoresCache,
  highlightMatch,
} from "@/hooks/use-proveedores-cache";
import { toast } from "@/components/ui/toast";
import type { ComboboxItem } from "@/components/ui/combobox";
import { toCLP } from "@/lib/format";
import type {
  BalanceTreatment,
  ContraparteTipo,
  DocTributarioTipo,
  IvaTratamiento,
  OcListItem,
  Page,
  VoucherTipo,
} from "@/lib/api/schema";

// ───────────────────────────────────────────────────────────────────────────
// Constantes contables
// ───────────────────────────────────────────────────────────────────────────

/**
 * Las tres cuentas del asiento de una boleta de honorarios. Existen en el plan
 * (que es global) y están habilitadas en las 11 empresas.
 *
 * La retención NO es gasto de la empresa: es plata del prestador que la
 * empresa entera al SII por él. Por eso `2105-04` es PASIVO y no una cuenta de
 * resultado — mandarla a gasto se imputa como costo propio un impuesto ajeno y
 * descuadra el F29.
 */
export const CUENTA_HONORARIOS_GASTO = "4201-02";
export const CUENTA_RETENCION_HONORARIOS = "2105-04";
export const CUENTA_HONORARIOS_POR_PAGAR = "2102-11";

/**
 * Los tipos de documento que el alta de voucher ofrece, con la etiqueta en
 * castellano y agrupados por tratamiento de IVA.
 *
 * `value` es el token del catálogo SII que viaja a
 * `core.vouchers.doc_tributario_tipo` — el mismo que usa la OC, para que el
 * mapeo OC → voucher sea la identidad. Toda tabla de traducción entre dos
 * catálogos termina divergiendo.
 *
 * Las notas van en su propio grupo a propósito: pueden ser afectas o exentas
 * según el documento que corrigen, y meterlas en "Afectas a IVA" sería
 * afirmar algo que el token no dice.
 */
export const TIPOS_DOCUMENTO_VOUCHER: ComboboxItem[] = [
  { value: "FACTURA", label: "Factura", group: "Afectas a IVA" },
  { value: "BOLETA", label: "Boleta", group: "Afectas a IVA" },
  { value: "FACTURA_EXENTA", label: "Factura exenta", group: "Sin IVA" },
  { value: "HONORARIOS", label: "Boleta de honorarios", group: "Sin IVA" },
  { value: "NOTA_CREDITO", label: "Nota de crédito", group: "Notas de ajuste" },
  { value: "NOTA_DEBITO", label: "Nota de débito", group: "Notas de ajuste" },
  {
    value: "NA",
    label: "Sin documento tributario",
    group: "Notas de ajuste",
  },
];

const TIPO_DOCUMENTO_LABEL: Record<string, string> = Object.fromEntries(
  TIPOS_DOCUMENTO_VOUCHER.map((t) => [t.value, t.label]),
);

/** Etiqueta en castellano del tipo, con el token crudo como fallback: mejor
 *  mostrar el token feo que mentir sobre el documento tributario. */
export function etiquetaTipoDocumento(tipo: string | null | undefined): string {
  if (!tipo) return "—";
  return TIPO_DOCUMENTO_LABEL[tipo] ?? tipo;
}

// ───────────────────────────────────────────────────────────────────────────
// Contrato de datos
// ───────────────────────────────────────────────────────────────────────────

/**
 * Una línea propuesta, ya en el formato que edita el form de alta (montos como
 * texto, porque el `<input type="number">` trabaja con strings).
 */
export interface LineaPropuesta {
  cuenta_codigo: string;
  proyecto_codigo: string;
  area_codigo: string;
  debit: string;
  credit: string;
  descripcion: string;
  iva_tratamiento: IvaTratamiento | null;
  balance_treatment: BalanceTreatment;
  /** La cuenta la tiene que elegir el operador: no se deriva de la OC. */
  requiereCuenta: boolean;
  /** Explicación corta que el form muestra al lado de la línea. */
  nota: string | null;
}

/** Propuesta normalizada. Todo opcional salvo lo que el form realmente usa. */
export interface PropuestaVoucher {
  ocId: number | null;
  numeroOc: string | null;
  empresaCodigo: string | null;
  tipo: VoucherTipo | null;
  docTributarioTipo: DocTributarioTipo | null;
  docTributarioFolio: string | null;
  fechaDocumento: string | null;
  fechaContable: string | null;
  fechaVencimiento: string | null;
  glosa: string | null;
  moneda: string | null;
  contraparteRut: string | null;
  contraparteNombre: string | null;
  contraparteTipo: ContraparteTipo | null;
  lineas: LineaPropuesta[];
  bruto: number | null;
  retencionMonto: number | null;
  totalAPagar: number | null;
  retencionPorcentaje: number | null;
  /** Si la OC ya tiene voucher, el backend lo dice acá y el form lo muestra. */
  voucherExistenteId: number | null;
  voucherExistenteCodigo: string | null;
  advertencias: string[];
}

/** Lo que el endpoint puede devolver. Todo opcional: lo validamos nosotros. */
interface PropuestaLineaRaw {
  cuenta_codigo?: string | null;
  proyecto_codigo?: string | null;
  area_codigo?: string | null;
  debit?: number | string | null;
  credit?: number | string | null;
  descripcion?: string | null;
  iva_tratamiento?: string | null;
  balance_treatment?: string | null;
  requiere_cuenta?: boolean | null;
  nota?: string | null;
}

interface PropuestaRaw {
  oc_id?: number | null;
  numero_oc?: string | null;
  empresa_codigo?: string | null;
  tipo?: string | null;
  doc_tributario_tipo?: string | null;
  doc_tributario_folio?: string | null;
  fecha_documento?: string | null;
  fecha_contable?: string | null;
  fecha_vencimiento?: string | null;
  glosa?: string | null;
  moneda?: string | null;
  contraparte_rut?: string | null;
  contraparte_nombre?: string | null;
  contraparte_tipo?: string | null;
  lines?: PropuestaLineaRaw[] | null;
  lineas?: PropuestaLineaRaw[] | null;
  bruto?: number | string | null;
  total?: number | string | null;
  retencion_monto?: number | string | null;
  total_a_pagar?: number | string | null;
  retencion_porcentaje?: number | string | null;
  voucher_existente_id?: number | null;
  voucher_existente_codigo?: string | null;
  advertencias?: string[] | null;
  /** Algunos backends envuelven la cabecera: lo contemplamos sin adivinar. */
  voucher?: PropuestaRaw | null;
  propuesta?: PropuestaRaw | null;
}

const TRATAMIENTOS_IVA: IvaTratamiento[] = [
  "AFECTO",
  "EXENTO",
  "NO_GRAVADO",
  "NA",
];
const TRATAMIENTOS_BALANCE: BalanceTreatment[] = ["GASTO", "ACTIVACION", "NA"];

/**
 * Convierte a número un monto que vino del servidor. Levanta si es ilegible.
 *
 * Degradar acá sería cambiar una cifra de plata en silencio: un monto que no
 * se puede leer no vale 0, vale "no sé". Vacío/ausente sí es 0 legítimo — en
 * `voucher_lines` una de las dos columnas siempre va en cero.
 */
function montoDesdeServidor(valor: unknown, contexto: string): number {
  if (valor === null || valor === undefined || valor === "") return 0;
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) {
    throw new Error(
      `${contexto}: el servidor mandó un monto ilegible ("${String(valor)}").`,
    );
  }
  return n;
}

/** Monto → texto para el input. 0 se muestra vacío para que el mutex
 *  debe/haber del form siga funcionando. No redondea: redondear acá sería un
 *  SEGUNDO redondeo sobre una cifra que el backend ya cerró. */
function montoATexto(n: number): string {
  return n === 0 ? "" : String(n);
}

function textoOpcional(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function numeroOpcional(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normaliza la respuesta del endpoint de propuesta. LEVANTA si el asiento no
 * cierra o si algún monto es ilegible: una propuesta descuadrada es un bug del
 * backend y hay que verlo, no pintarlo y dejar que el operador lo firme.
 */
export function normalizarPropuesta(raw: unknown): PropuestaVoucher {
  const r = (raw ?? {}) as PropuestaRaw;
  // La cabecera puede venir envuelta; el asiento manda igual.
  const h: PropuestaRaw = r.voucher ?? r.propuesta ?? r;
  const lineasRaw = r.lines ?? r.lineas ?? h.lines ?? h.lineas ?? [];

  let sumaDebe = 0;
  let sumaHaber = 0;
  const lineas: LineaPropuesta[] = lineasRaw.map((l, i) => {
    const etiqueta = `Línea ${i + 1} de la propuesta`;
    const debit = montoDesdeServidor(l.debit, `${etiqueta} (debe)`);
    const credit = montoDesdeServidor(l.credit, `${etiqueta} (haber)`);
    if (debit < 0 || credit < 0) {
      throw new Error(`${etiqueta}: monto negativo (${debit} / ${credit}).`);
    }
    if (debit !== 0 && credit !== 0) {
      throw new Error(`${etiqueta}: trae debe y haber a la vez.`);
    }
    sumaDebe += debit;
    sumaHaber += credit;

    const cuenta = textoOpcional(l.cuenta_codigo) ?? "";
    const iva = TRATAMIENTOS_IVA.find((t) => t === l.iva_tratamiento) ?? null;
    const balance =
      TRATAMIENTOS_BALANCE.find((t) => t === l.balance_treatment) ?? "NA";
    return {
      cuenta_codigo: cuenta,
      proyecto_codigo: textoOpcional(l.proyecto_codigo) ?? "",
      area_codigo: textoOpcional(l.area_codigo) ?? "",
      debit: montoATexto(debit),
      credit: montoATexto(credit),
      descripcion: textoOpcional(l.descripcion) ?? "",
      iva_tratamiento: iva,
      balance_treatment: balance,
      // Si el backend no marcó nada, una cuenta vacía ES una cuenta que falta.
      requiereCuenta: l.requiere_cuenta === true || cuenta === "",
      nota: textoOpcional(l.nota),
    };
  });

  if (lineas.length > 0 && Math.abs(sumaDebe - sumaHaber) > 0.005) {
    throw new Error(
      `La propuesta no cuadra: debe ${sumaDebe.toLocaleString("es-CL")} vs ` +
        `haber ${sumaHaber.toLocaleString("es-CL")}. No la cargamos.`,
    );
  }

  const tipoDoc = textoOpcional(h.doc_tributario_tipo);
  return {
    ocId: numeroOpcional(h.oc_id ?? r.oc_id),
    numeroOc: textoOpcional(h.numero_oc ?? r.numero_oc),
    empresaCodigo: textoOpcional(h.empresa_codigo ?? r.empresa_codigo),
    tipo: (textoOpcional(h.tipo) as VoucherTipo | null) ?? null,
    docTributarioTipo: (tipoDoc as DocTributarioTipo | null) ?? null,
    docTributarioFolio: textoOpcional(h.doc_tributario_folio),
    fechaDocumento: textoOpcional(h.fecha_documento),
    fechaContable: textoOpcional(h.fecha_contable),
    fechaVencimiento: textoOpcional(h.fecha_vencimiento),
    glosa: textoOpcional(h.glosa),
    moneda: textoOpcional(h.moneda),
    contraparteRut: textoOpcional(h.contraparte_rut),
    contraparteNombre: textoOpcional(h.contraparte_nombre),
    contraparteTipo:
      (textoOpcional(h.contraparte_tipo) as ContraparteTipo | null) ?? null,
    lineas,
    bruto: numeroOpcional(h.bruto ?? h.total ?? r.bruto ?? r.total),
    retencionMonto: numeroOpcional(h.retencion_monto ?? r.retencion_monto),
    totalAPagar: numeroOpcional(h.total_a_pagar ?? r.total_a_pagar),
    retencionPorcentaje: numeroOpcional(
      h.retencion_porcentaje ?? r.retencion_porcentaje,
    ),
    voucherExistenteId: numeroOpcional(
      h.voucher_existente_id ?? r.voucher_existente_id,
    ),
    voucherExistenteCodigo: textoOpcional(
      h.voucher_existente_codigo ?? r.voucher_existente_codigo,
    ),
    advertencias: (r.advertencias ?? h.advertencias ?? []).filter(
      (a): a is string => typeof a === "string" && a.trim() !== "",
    ),
  };
}

/**
 * Trae la propuesta de asiento para una OC.
 *
 * `retry: false` a propósito: si el endpoint todavía no está desplegado
 * queremos el 404 rápido y visible, no tres reintentos y un spinner largo. El
 * form tiene un camino de respaldo que prellena la cabecera desde la OC y deja
 * las líneas al operador — nunca inventa montos.
 */
export function usePropuestaVoucherOc(ocId: number | null) {
  const query = useApiQuery<unknown>(
    ["voucher-propuesto-oc", String(ocId ?? "")],
    `/ordenes-compra/${ocId}/voucher-propuesto`,
    ocId !== null,
    { retry: false },
  );

  const resultado = useMemo(() => {
    if (query.data === undefined) return null;
    try {
      return { ok: true as const, propuesta: normalizarPropuesta(query.data) };
    } catch (err) {
      return {
        ok: false as const,
        error:
          err instanceof Error
            ? err.message
            : "La propuesta llegó en un formato que no se pudo leer.",
      };
    }
  }, [query.data]);

  return { query, resultado };
}

// ───────────────────────────────────────────────────────────────────────────
// Boleta de honorarios sin OC
// ───────────────────────────────────────────────────────────────────────────

/**
 * Escala del Art. 74 N°2 LIR (Ley 21.133). Es una SUGERENCIA de UI para que el
 * operador no tenga que buscar la tasa del año; la tasa de verdad vive en
 * `core.tax_config` y en la boleta que emitió el prestador, que trae la
 * retención impresa. Por eso el campo queda editable y a la vista.
 *
 * Mismo criterio (y misma escala) que `ordenes-compra/nueva`. A partir de 2028
 * la ley la deja fija en 17%.
 */
export function retencionSugerida(fecha: string): string {
  const anio = Number(fecha.slice(0, 4));
  if (!Number.isFinite(anio) || anio <= 2024) return "13.75";
  if (anio === 2025) return "14.5";
  if (anio === 2026) return "15.25";
  if (anio === 2027) return "16";
  return "17";
}

export interface AsientoHonorarios {
  bruto: number;
  retencion: number;
  liquido: number;
  tasa: number;
  lineas: LineaPropuesta[];
}

/**
 * Arma el asiento de una boleta de honorarios.
 *
 *   4201-02  HONORARIOS PROFESIONALES  DEBE   bruto
 *   2105-04  RETENCIÓN PROFESIONALES   HABER  retención
 *   2102-11  HONORARIOS POR PAGAR      HABER  líquido
 *
 * Cierra por construcción porque el líquido sale POR RESTA: se redondea la
 * retención una sola vez y el resto es el líquido. Redondear las dos por
 * separado deja un peso de diferencia y rompe la partida doble.
 *
 * Las líneas en cero no se emiten: el validador de `voucher_lines` exige
 * debe XOR haber, y una línea 0/0 lo viola. Con tasa 0 el asiento son dos
 * líneas, no tres con un cero.
 *
 * Levanta con mensaje propio en vez de devolver un asiento raro: es plata.
 */
export function construirAsientoHonorarios(
  brutoTexto: string,
  tasaTexto: string,
): AsientoHonorarios {
  const bruto = Number(brutoTexto);
  const tasa = Number(tasaTexto);
  if (brutoTexto.trim() === "" || !Number.isFinite(bruto) || bruto <= 0) {
    throw new Error(
      "Ingresá el honorario bruto (el monto de la boleta, antes de la " +
        "retención). Solo números, sin separador de miles.",
    );
  }
  // El peso chileno no tiene centavos. Redondear el bruto por nuestra cuenta
  // sería cambiarle la cifra al documento: se rechaza y lo corrige el operador.
  if (!Number.isInteger(bruto)) {
    throw new Error(
      "El peso chileno no tiene centavos: el bruto va en pesos enteros " +
        `(pusiste ${brutoTexto}).`,
    );
  }
  if (tasaTexto.trim() === "" || !Number.isFinite(tasa)) {
    throw new Error("La tasa de retención tiene que ser un número (ej: 15.25).");
  }
  if (tasa < 0 || tasa > 100) {
    throw new Error("La tasa de retención va entre 0 y 100.");
  }

  const retencion = Math.round((bruto * tasa) / 100);
  const liquido = bruto - retencion;
  if (liquido < 0) {
    throw new Error(
      "Con esa tasa la retención supera al bruto y el líquido queda negativo. " +
        "Revisá el porcentaje.",
    );
  }

  const lineas: LineaPropuesta[] = [
    {
      cuenta_codigo: CUENTA_HONORARIOS_GASTO,
      proyecto_codigo: "",
      area_codigo: "",
      debit: montoATexto(bruto),
      credit: "",
      descripcion: "Honorarios profesionales (bruto)",
      // NO_GRAVADO explícito: si va en null, el exportador a Nubox trata la
      // línea como afecta a IVA.
      iva_tratamiento: "NO_GRAVADO",
      balance_treatment: "GASTO",
      requiereCuenta: false,
      nota: "Gasto por el BRUTO: el costo de la empresa es el honorario completo.",
    },
  ];
  if (retencion !== 0) {
    lineas.push({
      cuenta_codigo: CUENTA_RETENCION_HONORARIOS,
      proyecto_codigo: "",
      area_codigo: "",
      debit: "",
      credit: montoATexto(retencion),
      descripcion: `Retención honorarios ${tasa}%`,
      iva_tratamiento: "NO_GRAVADO",
      balance_treatment: "NA",
      requiereCuenta: false,
      nota: "Pasivo, no gasto: es plata del prestador que la empresa entera al SII por él.",
    });
  }
  if (liquido !== 0) {
    lineas.push({
      cuenta_codigo: CUENTA_HONORARIOS_POR_PAGAR,
      proyecto_codigo: "",
      area_codigo: "",
      debit: "",
      credit: montoATexto(liquido),
      descripcion: "Líquido a pagar al prestador",
      iva_tratamiento: "NO_GRAVADO",
      balance_treatment: "NA",
      requiereCuenta: false,
      nota: "Default del DEVENGO. Si este voucher ES el pago, cambiá la cuenta por la del banco.",
    });
  }

  return { bruto, retencion, liquido, tasa, lineas };
}

const CIFRA_LABEL =
  "text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500";

/**
 * Bloque de honorarios para el alta de voucher, cuando NO viene de una OC.
 *
 * Muestra las tres cifras antes de guardar. El número grande es el LÍQUIDO
 * porque es lo que tesorería gira: si el operador solo ve el bruto, gira el
 * bruto y le paga al prestador la retención que la empresa tiene que enterar.
 */
export function HonorariosAsistente({
  fechaDocumento,
  onAplicar,
}: {
  fechaDocumento: string;
  /** Devuelve `false` si el padre canceló (p.ej. había líneas cargadas y el
   *  operador no quiso pisarlas): entonces no cantamos éxito. */
  onAplicar: (asiento: AsientoHonorarios) => boolean;
}) {
  const [bruto, setBruto] = useState("");
  const [tasa, setTasa] = useState(() => retencionSugerida(fechaDocumento));
  const tasaTocada = useRef(false);

  // La tasa sugerida depende del año del documento. Mientras el operador no
  // la haya tocado, la seguimos; apenas la edita, es suya y no se la pisamos.
  useEffect(() => {
    if (tasaTocada.current) return;
    setTasa(retencionSugerida(fechaDocumento));
  }, [fechaDocumento]);

  // Vista previa en vivo. Si los datos todavía no sirven, no mostramos cifras
  // a medias: mostramos guiones.
  const preview = useMemo(() => {
    try {
      return construirAsientoHonorarios(bruto, tasa);
    } catch {
      return null;
    }
  }, [bruto, tasa]);

  const aplicar = () => {
    try {
      const asiento = construirAsientoHonorarios(bruto, tasa);
      if (!onAplicar(asiento)) return;
      toast.success(
        `Asiento propuesto: ${asiento.lineas.length} líneas. Revisalo y ` +
          "ajustá la cuenta del haber si este voucher es el pago.",
        { duration: 8000 },
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo armar el asiento",
      );
    }
  };

  return (
    <div className="mt-3 rounded-2xl bg-cehta-green/[0.04] p-4 ring-1 ring-cehta-green/20">
      <div className="flex items-center gap-2">
        <Calculator className="h-4 w-4 text-cehta-green" strokeWidth={1.75} />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
          Boleta de honorarios · retención
        </p>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="hon-bruto"
            className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500"
          >
            Honorario bruto (el monto de la boleta)
          </label>
          <input
            id="hon-bruto"
            type="number"
            step="1"
            min="0"
            value={bruto}
            onChange={(e) => setBruto(e.target.value)}
            placeholder="1179941"
            className="w-full rounded-xl border-0 bg-white px-3 py-2 text-right font-mono text-sm tabular-nums ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </div>
        <div>
          <label
            htmlFor="hon-tasa"
            className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500"
          >
            Retención %
          </label>
          <input
            id="hon-tasa"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={tasa}
            onChange={(e) => {
              tasaTocada.current = true;
              setTasa(e.target.value);
            }}
            className="w-full rounded-xl border-0 bg-white px-3 py-2 text-right font-mono text-sm tabular-nums ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
          <p className="mt-1 text-[11px] text-ink-400">
            Sugerida por la fecha del documento (Art. 74 N°2 LIR). Contrastala
            con la retención impresa en la boleta del prestador.
          </p>
        </div>
      </div>

      {/* Las tres cifras. El líquido es el número grande: es lo que se gira. */}
      <div className="mt-4 flex flex-wrap items-end gap-6 rounded-xl bg-white/70 p-3 ring-1 ring-hairline">
        <div>
          <p className={CIFRA_LABEL}>Bruto</p>
          <p className="text-sm text-ink-900 tabular-nums">
            {preview ? toCLP(preview.bruto) : "—"}
          </p>
        </div>
        <div>
          <p className={CIFRA_LABEL}>Retención</p>
          <p className="text-sm text-negative tabular-nums">
            {preview ? `− ${toCLP(preview.retencion)}` : "—"}
          </p>
        </div>
        <div className="border-l border-hairline pl-6">
          <p className={CIFRA_LABEL}>Líquido a pagar</p>
          <p className="font-display text-2xl font-semibold text-cehta-green tabular-nums">
            {preview ? toCLP(preview.liquido) : "—"}
          </p>
          <p className="text-[11px] text-ink-400">
            Es lo que se le gira al prestador.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={aplicar}
        disabled={!preview}
        className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3.5 py-2 text-sm font-semibold text-white shadow-card transition-colors hover:bg-cehta-green-700 disabled:cursor-not-allowed disabled:opacity-50"
        title={
          preview
            ? "Reemplaza las líneas actuales por el asiento de honorarios"
            : "Cargá el bruto y la tasa"
        }
      >
        <Calculator className="h-4 w-4" strokeWidth={1.75} />
        Proponer el asiento
      </button>
      <p className="mt-2 text-[11px] text-ink-500">
        Se proponen <span className="font-mono">{CUENTA_HONORARIOS_GASTO}</span>{" "}
        al debe por el bruto,{" "}
        <span className="font-mono">{CUENTA_RETENCION_HONORARIOS}</span> al
        haber por la retención (pasivo: la empresa la entera al SII por el
        prestador) y{" "}
        <span className="font-mono">{CUENTA_HONORARIOS_POR_PAGAR}</span> al
        haber por el líquido. Esa última es el default del{" "}
        <strong>devengo</strong>; si este voucher ya <strong>es el pago</strong>
        , cambiala por la cuenta del banco desde donde sale la plata. Todas son
        editables antes de guardar.
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Selector de OC
// ───────────────────────────────────────────────────────────────────────────

/** OCs que ya no admiten un voucher nuevo. */
const ESTADOS_OC_CERRADOS = new Set(["anulada", "rechazada"]);

/** Máximo que acepta `GET /ordenes-compra` (`size: le=100`). */
const OC_PAGE_SIZE = 100;

/**
 * Lo mínimo que el selector necesita para pintar una OC elegida. Tanto
 * `OcListItem` (el typeahead) como `OcRead` (el deeplink `?oc_id=`) encajan
 * estructuralmente: así el chip se pinta igual venga de donde venga.
 */
export interface OcSeleccionada {
  oc_id: number;
  numero_oc: string;
  proveedor_id: number | null;
  tipo_documento: string;
  moneda: string;
  total: string;
  total_a_pagar?: string | null;
  estado: string;
}

function montoOc(oc: OcSeleccionada): string {
  // La plata que se gira es `total_a_pagar`; con honorarios el bruto incluye
  // plata que nunca sale de la empresa. `??` y no `||`: 0 es un total válido.
  const crudo = oc.total_a_pagar ?? oc.total;
  const n = Number(crudo);
  if (!Number.isFinite(n)) return "—";
  if (oc.moneda === "CLP") return toCLP(n);
  return `${oc.moneda} ${n.toLocaleString("es-CL")}`;
}

/**
 * Typeahead de órdenes de compra, mismo patrón que
 * `ProveedorTypeaheadCached`: se trae el catálogo de la empresa y se filtra en
 * memoria.
 *
 * No es capricho — `GET /ordenes-compra` NO acepta búsqueda de texto (la
 * pantalla de OCs ya filtra client-side por eso). Como el endpoint tope 100
 * por página, cuando hay más se lo decimos al operador con la salida por el
 * detalle de la OC, en vez de esconderle órdenes en silencio.
 */
export function OcTypeahead({
  empresaCodigo,
  seleccionada,
  onSelect,
  onClear,
  disabled = false,
}: {
  empresaCodigo: string;
  seleccionada: OcSeleccionada | null;
  onSelect: (oc: OcListItem) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const ocs = useApiQuery<Page<OcListItem>>(
    ["ocs-para-voucher", empresaCodigo],
    `/ordenes-compra?page=1&size=${OC_PAGE_SIZE}&empresa_codigo=${encodeURIComponent(empresaCodigo)}`,
    !!empresaCodigo && !disabled,
  );
  const { data: proveedores = [] } = useProveedoresCache();

  const nombreProveedor = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of proveedores) map.set(p.proveedor_id, p.razon_social);
    return map;
  }, [proveedores]);

  const candidatas = useMemo(
    () =>
      (ocs.data?.items ?? []).filter(
        (oc) => !ESTADOS_OC_CERRADOS.has((oc.estado ?? "").toLowerCase()),
      ),
    [ocs.data],
  );

  const resultados = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidatas.slice(0, 8);
    return candidatas
      .filter((oc) => {
        const prov = (
          oc.proveedor_id !== null ? nombreProveedor.get(oc.proveedor_id) : ""
        )?.toLowerCase();
        return (
          oc.numero_oc.toLowerCase().includes(q) ||
          (prov ? prov.includes(q) : false)
        );
      })
      .slice(0, 8);
  }, [candidatas, query, nombreProveedor]);

  const totalServidor = ocs.data?.total ?? 0;
  const hayMasEnServidor = totalServidor > (ocs.data?.items.length ?? 0);

  if (seleccionada) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 ring-1 ring-cehta-green/30">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">
            OC {seleccionada.numero_oc}
            <span className="ml-2 font-normal text-ink-500">
              {seleccionada.proveedor_id !== null
                ? (nombreProveedor.get(seleccionada.proveedor_id) ??
                  `Proveedor #${seleccionada.proveedor_id}`)
                : "Sin proveedor"}
            </span>
          </p>
          <p className="text-[11px] text-ink-500 tabular-nums">
            {etiquetaTipoDocumento(seleccionada.tipo_documento)} ·{" "}
            {montoOc(seleccionada)} ·{" "}
            <Link
              href={`/ordenes-compra/${seleccionada.oc_id}` as Route}
              className="text-cehta-green hover:underline"
            >
              ver la OC
            </Link>
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-ink-600 ring-1 ring-hairline transition-colors hover:bg-ink-50"
        >
          Quitar
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={query}
        disabled={disabled || !empresaCodigo}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={
          !empresaCodigo
            ? "Elegí primero la empresa"
            : ocs.isLoading
              ? "Cargando órdenes…"
              : `Buscar entre ${candidatas.length} órdenes por número o proveedor…`
        }
        autoComplete="off"
        role="combobox"
        aria-controls="oc-typeahead-listbox"
        aria-autocomplete="list"
        aria-expanded={open}
        className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:cursor-not-allowed disabled:opacity-60"
      />
      {open && resultados.length > 0 && (
        <ul
          id="oc-typeahead-listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-hairline bg-white shadow-lg"
          role="listbox"
        >
          {resultados.map((oc) => (
            <li
              key={oc.oc_id}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(oc);
                setQuery("");
                setOpen(false);
              }}
              className="cursor-pointer px-3 py-2 text-sm hover:bg-cehta-green/10"
            >
              <div className="font-medium text-ink-900">
                {highlightMatch(oc.numero_oc, query).map((seg, i) =>
                  seg.highlight ? (
                    <mark
                      key={i}
                      className="rounded-sm bg-cehta-green/30 px-0.5 text-ink-900"
                    >
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  ),
                )}
                <span className="ml-2 font-normal text-ink-500">
                  {oc.proveedor_id !== null
                    ? (nombreProveedor.get(oc.proveedor_id) ??
                      `Proveedor #${oc.proveedor_id}`)
                    : "Sin proveedor"}
                </span>
              </div>
              <div className="flex items-baseline gap-2 text-xs text-ink-500 tabular-nums">
                <span>{etiquetaTipoDocumento(oc.tipo_documento)}</span>
                <span>·</span>
                <span>{montoOc(oc)}</span>
                <span>·</span>
                <span className="capitalize">{oc.estado}</span>
              </div>
            </li>
          ))}
          {hayMasEnServidor && (
            <li className="border-t border-hairline bg-ink-50/60 px-3 py-1.5 text-[11px] text-ink-500">
              Se cargaron {candidatas.length} de {totalServidor} órdenes. Si la
              que buscás no aparece, abrila en /ordenes-compra y usá &quot;Crear
              voucher desde esta OC&quot;.
            </li>
          )}
        </ul>
      )}
      {open && !ocs.isLoading && resultados.length === 0 && !!empresaCodigo && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-hairline bg-white px-3 py-3 text-xs text-ink-500 shadow-lg">
          Sin órdenes que coincidan en {empresaCodigo}. Las anuladas y
          rechazadas no se ofrecen.
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Acción en el detalle de la OC
// ───────────────────────────────────────────────────────────────────────────

/** Sólo lo que necesitamos de `GET /ordenes-compra/{id}/cuotas`. */
interface CuotaConVoucher {
  cuota_id: number;
  numero_cuota: number;
  voucher_id: number | null;
  voucher_codigo: string | null;
}

const btnBase =
  "inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2";

/**
 * "Crear voucher desde esta OC" en el detalle de la OC.
 *
 * Si la OC ya tiene voucher, el botón lleva AL QUE EXISTE. Un voucher
 * duplicado sobre la misma OC es un pago duplicado esperando.
 *
 * La comprobación va contra `/ordenes-compra/{id}/cuotas`, que es el único
 * lugar del que hoy se puede saber si un hito ya generó voucher — y usa la
 * MISMA query key que `OcCuotasSection`, así que comparte cache y no agrega un
 * round-trip. Mientras no sabemos, el botón de crear está deshabilitado: un
 * parpadeo de "Crear" es una invitación a duplicar.
 */
export function CrearVoucherDesdeOcButton({
  ocId,
  numeroOc,
  estado,
}: {
  ocId: number;
  numeroOc: string;
  estado?: string;
}) {
  const cuotas = useApiQuery<CuotaConVoucher[]>(
    ["oc-cuotas", String(ocId)],
    `/ordenes-compra/${ocId}/cuotas`,
  );

  const conVoucher = (cuotas.data ?? []).filter((c) => c.voucher_id !== null);
  const primero = conVoucher[0];
  const cerrada = ESTADOS_OC_CERRADOS.has((estado ?? "").toLowerCase());

  if (primero?.voucher_id != null) {
    return (
      <Link
        href={`/vouchers/${primero.voucher_id}` as Route}
        className={`${btnBase} bg-white text-ink-700 ring-1 ring-hairline hover:bg-ink-100/40`}
        title={
          conVoucher.length > 1
            ? `Esta OC ya generó ${conVoucher.length} vouchers. No se crea otro.`
            : "Esta OC ya tiene voucher. No se crea otro."
        }
      >
        <ExternalLink className="h-4 w-4" strokeWidth={1.5} />
        Ver voucher {primero.voucher_codigo ?? `#${primero.voucher_id}`}
        {conVoucher.length > 1 && (
          <span className="rounded-full bg-ink-100 px-1.5 text-[11px] text-ink-600">
            +{conVoucher.length - 1}
          </span>
        )}
      </Link>
    );
  }

  // OC anulada o rechazada: no hay voucher que crear y el backend lo rechaza
  // igual. Mostrar el botón sería prometer algo que no va a pasar.
  if (cerrada) return null;

  if (cuotas.isLoading) {
    return (
      <button
        type="button"
        disabled
        className={`${btnBase} bg-white text-ink-400 ring-1 ring-hairline`}
      >
        <FileText className="h-4 w-4" strokeWidth={1.5} />
        Revisando vouchers…
      </button>
    );
  }

  return (
    <Link
      href={`/vouchers/nuevo?oc_id=${ocId}` as Route}
      className={`${btnBase} bg-cehta-green text-white hover:bg-cehta-green-700`}
      aria-label={`Crear voucher desde la OC ${numeroOc}`}
      title={
        cuotas.isError
          ? "No se pudo verificar si la OC ya tiene voucher. Revisá los hitos antes de guardar."
          : "Abre el alta de voucher con el asiento propuesto desde esta OC"
      }
    >
      <Link2 className="h-4 w-4" strokeWidth={1.5} />
      Crear voucher desde esta OC
    </Link>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Avisos reutilizables
// ───────────────────────────────────────────────────────────────────────────

/** Banner ámbar de "esto está incompleto / mirá esto antes de guardar". */
export function AvisoPropuesta({
  tono = "aviso",
  titulo,
  children,
}: {
  tono?: "aviso" | "error" | "info";
  titulo: string;
  children?: React.ReactNode;
}) {
  const estilos =
    tono === "error"
      ? "bg-negative/5 ring-negative/25 text-negative"
      : tono === "info"
        ? "bg-cehta-green/5 ring-cehta-green/25 text-cehta-green"
        : "bg-amber-50 ring-amber-200 text-amber-800";
  return (
    <div className={`rounded-2xl p-4 text-xs ring-1 ${estilos}`}>
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        {titulo}
      </p>
      {children && (
        <div className="mt-1.5 leading-relaxed text-ink-600">{children}</div>
      )}
    </div>
  );
}
