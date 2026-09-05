"use client";

/**
 * RepartoEditor — quién paga cada gasto CORFO, por % o por $.
 *
 * Es la "SEPARACIÓN VALORES" del Excel de Claudia: Subsidio CORFO /
 * Cehta-Ptec / Cehta (+ Trewaox en TRONGKAI). Los inputs de % y $ están
 * acoplados: escribir un % recalcula los $ con el motor (residuo a la fuente
 * mayor, suma exacta al centavo); escribir un $ recalcula los %.
 *
 * Los MONTOS mandan; los porcentajes son sólo una forma cómoda de editar.
 * Por eso el botón Guardar se habilita únicamente cuando la suma cierra
 * contra el total (o cuando se elige "Sin clasificar" a propósito): un
 * reparto que no cuadra es información para CORFO, no algo que se guarda
 * desde acá a medias.
 *
 * Todo el cálculo pasa por `lib/claudia/reparto.ts` (espejo del motor
 * Python con test de paridad). Este componente no suma nada por su cuenta.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { toCLP } from "@/lib/format";
import { limpiarCeros, normalizarNumero } from "@/lib/oc/pegar-items";
import {
  centavosADecimal,
  centavosAPesos,
  CIEN_PCT,
  decimalACentavos,
  ESTADO_OK,
  ESTADO_SIN_CLASIFICAR,
  ETIQUETAS,
  estadoReparto,
  formatearPctCorto,
  FUENTES,
  normalizarMontos,
  pctACentesimos,
  pctDesdeMontos,
  PRESETS_REPARTO,
  RepartoInvalidoError,
  repartirPorPct,
  repartoParaApi,
  sumaReparto,
  type RepartoCentavos,
} from "@/lib/claudia/reparto";

/** Punto ámbar que acompaña a los avisos: el color va ahí, no en el texto (AA). */
function PuntoAviso() {
  return <span className="inline-block size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />;
}
import type { Fuente, RepartoEstado } from "@/lib/claudia/types";

/** Colores por fuente (§3.5): sólo clases de la paleta existente. */
export const FUENTE_CLASES: Record<Fuente, { dot: string; bar: string; text: string }> = {
  subsidio: { dot: "bg-cehta-green", bar: "bg-cehta-green", text: "text-cehta-green" },
  cehta_ptec: { dot: "bg-sf-blue", bar: "bg-sf-blue", text: "text-sf-blue" },
  cehta: { dot: "bg-ink-500", bar: "bg-ink-500", text: "text-ink-500" },
  trewaox: { dot: "bg-sf-teal", bar: "bg-sf-teal", text: "text-sf-teal" },
};

/** Rayado ámbar para "sin clasificar" sin inventar un color nuevo. */
export const RAYADO_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, currentColor 0 3px, transparent 3px 7px)",
};

// ── Mini barra apilada (grilla, KPIs y ficha la comparten) ───────────────

export function RepartoBarra({
  total,
  montos,
  estado,
  className,
}: {
  /** Centavos. */
  total: number;
  montos: RepartoCentavos;
  estado: RepartoEstado;
  className?: string;
}) {
  if (estado === ESTADO_SIN_CLASIFICAR) {
    return (
      <div
        className={cn("h-1.5 w-full overflow-hidden rounded-full bg-warning/15 text-warning", className)}
        aria-hidden
      >
        <div className="h-full w-full opacity-70" style={RAYADO_STYLE} />
      </div>
    );
  }
  const suma = sumaReparto(montos);
  const base = Math.max(total, suma, 1);
  const falta = total > suma ? total - suma : 0;
  return (
    <div
      className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-ink-100/60", className)}
      aria-hidden
    >
      {FUENTES.map((f) => {
        const v = montos[f] ?? 0;
        if (v <= 0) return null;
        return (
          <div
            key={f}
            className={cn("h-full transition-all duration-200", FUENTE_CLASES[f].bar)}
            style={{ width: `${(v / base) * 100}%` }}
          />
        );
      })}
      {falta > 0 && (
        <div className="h-full bg-negative/35" style={{ width: `${(falta / base) * 100}%` }} />
      )}
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────

interface Props {
  /** Total del gasto, en centavos. */
  total: number;
  /** Reparto vigente (centavos), las 4 en null si sin clasificar. */
  montos: RepartoCentavos;
  /** TRONGKAI tiene Trewaox; en REVTECH aparece sólo si se activa. */
  mostrarTrewaox: boolean;
  onGuardar: (montos: RepartoCentavos) => Promise<void>;
  guardando?: boolean;
}

type Strs = Record<Fuente, string>;

function firma(montos: RepartoCentavos): string {
  return JSON.stringify(repartoParaApi(montos));
}

function montoAInput(c: number | null): string {
  return c === null ? "" : limpiarCeros(centavosADecimal(c));
}

function inputAMonto(s: string): number | null {
  const n = normalizarNumero(s);
  return n === "" ? null : decimalACentavos(n);
}

function strsDesdeMontos(montos: RepartoCentavos, total: number): { pcts: Strs; montosStr: Strs } {
  const pcts = pctDesdeMontos(total, montos);
  const p = {} as Strs;
  const m = {} as Strs;
  for (const f of FUENTES) {
    p[f] = pcts ? formatearPctCorto(pcts[f]) : "";
    m[f] = montoAInput(montos[f]);
  }
  return { pcts: p, montosStr: m };
}

export function RepartoEditor({ total, montos, mostrarTrewaox, onGuardar, guardando }: Props) {
  const inicial = useMemo(() => normalizarMontos(montos), [montos]);
  const inicialFirma = firma(inicial);

  const [pcts, setPcts] = useState<Strs>(() => strsDesdeMontos(inicial, total).pcts);
  const [montosStr, setMontosStr] = useState<Strs>(() => strsDesdeMontos(inicial, total).montosStr);
  const [trewaoxActivo, setTrewaoxActivo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Cuando el gasto cambia (otra fila, o se guardó), se vuelve a lo que
  // dice la API. La firma evita resetear por identidad de objeto.
  useEffect(() => {
    const s = strsDesdeMontos(inicial, total);
    setPcts(s.pcts);
    setMontosStr(s.montosStr);
    setAviso(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicialFirma, total]);

  // "Sin clasificar" NO es una bandera aparte: lo dice el motor. Los 4
  // inputs de $ vacíos → las 4 en null → SIN_CLASIFICAR, tanto si Claudia
  // apretó el preset como si los vació a mano. (Un "0" tipeado es un
  // reparto en cero, no vacío: el cero no es falsy acá.)
  const actual: RepartoCentavos = useMemo(() => {
    const out: Partial<Record<Fuente, number | null>> = {};
    for (const f of FUENTES) out[f] = inputAMonto(montosStr[f]);
    return normalizarMontos(out);
  }, [montosStr]);

  const estado = estadoReparto(total, actual);
  const sinClasificar = estado === ESTADO_SIN_CLASIFICAR;
  const suma = sumaReparto(actual);
  const diferencia = total - suma;
  const cambio = firma(actual) !== inicialFirma;
  const puedeGuardar = cambio && !guardando && (estado === ESTADO_OK || sinClasificar);

  const verTrewaox =
    mostrarTrewaox || trewaoxActivo || (inicial.trewaox ?? 0) > 0 || (actual.trewaox ?? 0) > 0;
  const fuentesVisibles = FUENTES.filter((f) => f !== "trewaox" || verTrewaox);

  function aplicarMontos(nuevos: Record<Fuente, number>) {
    const s = strsDesdeMontos(nuevos, total);
    setPcts(s.pcts);
    setMontosStr(s.montosStr);
  }

  function cambiarPct(f: Fuente, valor: string) {
    setAviso(null);
    const nuevosPcts = { ...pcts, [f]: valor };
    setPcts(nuevosPcts);
    if (valor.trim() === "") {
      // Vaciar el % vacía el $ de esa fuente (no lo pone en 0): así vaciar
      // las cuatro a mano también deja el reparto sin clasificar.
      setMontosStr((prev) => ({ ...prev, [f]: "" }));
      return;
    }
    const enCentesimos: Partial<Record<Fuente, number>> = {};
    let sumaPct = 0;
    for (const g of FUENTES) {
      const c = pctACentesimos(normalizarNumero(nuevosPcts[g]) || null) ?? 0;
      enCentesimos[g] = c;
      sumaPct += c;
    }
    if (Math.abs(sumaPct - CIEN_PCT) <= 1) {
      // Con los % completos, el motor reparte exacto (residuo a la mayor).
      try {
        const m = repartirPorPct(total, enCentesimos);
        setMontosStr((prev) => {
          const next = { ...prev };
          for (const g of FUENTES) next[g] = montoAInput(m[g]);
          return next;
        });
        return;
      } catch (e) {
        setAviso(e instanceof RepartoInvalidoError ? e.message : null);
      }
    }
    // A medio tipear: sólo esta fuente, a peso entero HALF_UP.
    const c = enCentesimos[f] ?? 0;
    const pesos = Math.floor((total * c + 500_000) / 1_000_000);
    setMontosStr((prev) => ({ ...prev, [f]: montoAInput(pesos * 100) }));
  }

  function cambiarMonto(f: Fuente, valor: string) {
    setAviso(null);
    const nuevos = { ...montosStr, [f]: valor };
    setMontosStr(nuevos);
    const out: Partial<Record<Fuente, number | null>> = {};
    for (const g of FUENTES) out[g] = inputAMonto(nuevos[g]);
    const p = pctDesdeMontos(total, normalizarMontos(out));
    setPcts((prev) => {
      const next = { ...prev };
      for (const g of FUENTES) next[g] = p ? formatearPctCorto(p[g]) : "";
      return next;
    });
  }

  function aplicarPreset(id: string) {
    const preset = PRESETS_REPARTO.find((p) => p.id === id);
    if (!preset) return;
    setAviso(null);
    if (preset.pcts === null) {
      // El preset sólo vacía los inputs; que quede SIN_CLASIFICAR lo decide
      // el motor a partir de eso.
      const vacio = {} as Strs;
      for (const f of FUENTES) vacio[f] = "";
      setPcts(vacio);
      setMontosStr(vacio);
      return;
    }
    aplicarMontos(repartirPorPct(total, preset.pcts));
  }

  async function guardar() {
    if (!puedeGuardar) return;
    await onGuardar(actual);
  }

  return (
    <div className="rounded-2xl bg-surface-muted/70 p-4 ring-1 ring-hairline">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-500">
          Reparto por fuente
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Presets de reparto">
          {PRESETS_REPARTO.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => aplicarPreset(p.id)}
              disabled={guardando}
              className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 hover:bg-ink-100/60 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {fuentesVisibles.map((f) => {
          const pct = pctACentesimos(normalizarNumero(pcts[f]) || null) ?? 0;
          const ancho = Math.max(0, Math.min(100, pct / 100));
          return (
            <div key={f} className="grid grid-cols-[auto_1fr_5.5rem_8.5rem] items-center gap-2 sm:gap-3">
              <span className={cn("size-2.5 rounded-full", FUENTE_CLASES[f].dot)} aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm text-ink-900">{ETIQUETAS[f]}</p>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-ink-100/60">
                  <div
                    className={cn("h-full transition-all duration-200", FUENTE_CLASES[f].bar)}
                    style={{ width: `${sinClasificar ? 0 : ancho}%` }}
                  />
                </div>
              </div>
              <label className="relative block">
                <span className="sr-only">Porcentaje {ETIQUETAS[f]}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={pcts[f]}
                  onChange={(e) => cambiarPct(f, e.target.value)}
                  disabled={guardando}
                  aria-label={`Porcentaje ${ETIQUETAS[f]}`}
                  className="h-8 w-full rounded-lg bg-white pl-2 pr-6 text-right text-sm tabular-nums text-ink-900 ring-1 ring-hairline transition-shadow duration-150 focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:opacity-60"
                />
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-ink-500">
                  %
                </span>
              </label>
              <label className="relative block">
                <span className="sr-only">Monto {ETIQUETAS[f]}</span>
                <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-ink-500">
                  $
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={montosStr[f]}
                  onChange={(e) => cambiarMonto(f, e.target.value)}
                  disabled={guardando}
                  aria-label={`Monto ${ETIQUETAS[f]}`}
                  className="h-8 w-full rounded-lg bg-white pl-5 pr-2 text-right text-sm tabular-nums text-ink-900 ring-1 ring-hairline transition-shadow duration-150 focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:opacity-60"
                />
              </label>
            </div>
          );
        })}
        {!verTrewaox && (
          <button
            type="button"
            onClick={() => setTrewaoxActivo(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green rounded"
          >
            <Plus className="size-3.5" strokeWidth={2} />
            fuente Trewaox
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p
          className={cn(
            "inline-flex flex-wrap items-center gap-1.5 text-xs tabular-nums",
            sinClasificar ? "text-ink-500" : estado === ESTADO_OK ? "text-cehta-green-700" : "text-ink-700",
          )}
          aria-live="polite"
        >
          {sinClasificar ? (
            "Sin clasificar: las cuatro fuentes quedan vacías."
          ) : estado === ESTADO_OK ? (
            <>
              Suma {toCLP(centavosAPesos(suma))} de {toCLP(centavosAPesos(total))} · cuadra{" "}
              <Check className="inline size-3.5 text-positive" strokeWidth={2.5} />
            </>
          ) : (
            <>
              <PuntoAviso />
              {diferencia > 0
                ? `Suma ${toCLP(centavosAPesos(suma))} de ${toCLP(centavosAPesos(total))} · faltan ${toCLP(centavosAPesos(diferencia))}`
                : `Suma ${toCLP(centavosAPesos(suma))} de ${toCLP(centavosAPesos(total))} · sobran ${toCLP(centavosAPesos(-diferencia))}`}
            </>
          )}
          {aviso && (
            <span className="inline-flex items-center gap-1.5 text-ink-700">
              <PuntoAviso />
              {aviso}
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={guardar}
          disabled={!puedeGuardar}
          className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-3.5 py-1.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-40"
        >
          {guardando ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : null}
          Guardar reparto
        </button>
      </div>
    </div>
  );
}
