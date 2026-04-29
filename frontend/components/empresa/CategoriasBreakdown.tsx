"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { toCLP } from "@/lib/format";
import { cn } from "@/lib/utils";
import { netoTone, tipoStyle } from "@/lib/empresa/colors";
import type { CategoriaBreakdown } from "@/lib/api/schema";

/**
 * Breakdown jerárquico Concepto General → Concepto Detallado.
 * Cada concepto general es expandible y muestra sub-categorías.
 */
export function CategoriasBreakdownList({
  data,
}: {
  data: CategoriaBreakdown[];
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(data.length > 0 && data[0] ? [data[0].concepto_general] : []),
  );

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (data.length === 0) {
    return (
      <Surface>
        <Surface.Header>
          <Surface.Title>Categorías</Surface.Title>
          <Surface.Subtitle>
            Sin movimientos para mostrar.
          </Surface.Subtitle>
        </Surface.Header>
      </Surface>
    );
  }

  return (
    <div className="space-y-4">
      {data.map((cat) => {
        const isOpen = expanded.has(cat.concepto_general);
        const Chevron = isOpen ? ChevronDown : ChevronRight;
        const style = tipoStyle(getTipoOf(cat.concepto_general));
        const neto = Number(cat.total_abono) - Number(cat.total_egreso);
        const netoStyleObj = netoTone(neto);
        return (
          <Surface key={cat.concepto_general}>
            <button
              type="button"
              onClick={() => toggle(cat.concepto_general)}
              aria-expanded={isOpen}
              className="flex w-full items-start gap-3 text-left transition-colors duration-150 ease-apple"
            >
              <Chevron
                className="mt-0.5 h-4 w-4 shrink-0 text-ink-300"
                strokeWidth={2}
              />
              <span
                className={cn(
                  "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
                  style.dot,
                )}
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-base font-display font-semibold tracking-tight text-ink-900">
                    {cat.concepto_general}
                  </p>
                  <p className="font-display text-kpi-sm tabular-nums text-ink-900">
                    {toCLP(cat.total_egreso)}
                  </p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                  <span>
                    {cat.transaction_count}{" "}
                    {cat.transaction_count === 1
                      ? "movimiento"
                      : "movimientos"}
                  </span>
                  <span>·</span>
                  <span className="tabular-nums">
                    Abonos {toCLP(cat.total_abono)}
                  </span>
                  <span>·</span>
                  <span
                    className={cn(
                      "tabular-nums font-medium",
                      netoStyleObj.className,
                    )}
                  >
                    Neto {netoStyleObj.prefix}
                    {toCLP(neto)}
                  </span>
                  <span
                    className={cn(
                      "ml-auto inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium tracking-tight",
                      style.badge,
                    )}
                  >
                    {style.label}
                  </span>
                </div>
              </div>
            </button>

            {isOpen && cat.sub_categorias.length > 0 && (
              <div className="mt-4 overflow-x-auto border-t border-hairline pt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-ink-500">
                      <th className="py-2 pr-4 font-medium">
                        Concepto detallado
                      </th>
                      <th className="py-2 pr-4 text-right font-medium">
                        Egresos
                      </th>
                      <th className="py-2 pr-4 text-right font-medium">
                        Abonos
                      </th>
                      <th className="py-2 text-right font-medium">Mov.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {cat.sub_categorias.map((sub) => (
                      <tr
                        key={sub.concepto_detallado}
                        className="transition-colors duration-150 ease-apple hover:bg-ink-100/30"
                      >
                        <td className="py-2.5 pr-4 text-ink-700">
                          {sub.concepto_detallado}
                        </td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-ink-900">
                          {toCLP(sub.total_egreso)}
                        </td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-ink-900">
                          {toCLP(sub.total_abono)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-ink-500">
                          {sub.transaction_count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Surface>
        );
      })}
    </div>
  );
}

/**
 * El backend devuelve `concepto_general`; reusamos el helper de tipoStyle
 * pasándolo directo. tipoStyle hace fallback a "Otros" para cualquier
 * concepto desconocido, así que es seguro.
 */
function getTipoOf(conceptoGeneral: string): string {
  // Mapeo simétrico al backend (TIPO_MAP). Si falla, tipoStyle ya tiene
  // fallback a "Otros".
  const key = conceptoGeneral.trim().toLowerCase().replace(/\s+/g, "_");
  const MAP: Record<string, string> = {
    pago_de_acciones: "Capital",
    capital: "Capital",
    inversion: "Tesoreria",
    inversión: "Tesoreria",
    reversa: "Ajuste",
    ajuste: "Ajuste",
    prestamos: "Financiero",
    préstamos: "Financiero",
    financiamiento: "Financiero",
    desarrollo_proyecto: "Operacional",
    recurso_humano: "Operacional",
    administracion: "Operacional",
    administración: "Operacional",
    operacion: "Operacional",
    operación: "Operacional",
    ventas: "Operacional",
  };
  return MAP[key] ?? "Otros";
}
