"use client";

/**
 * PeriodoChips — navegación por meses del registro.
 *
 * `Todos` primero, después cada mes que tenga gastos (`Ago 2026 · 30 ·
 * $12,4M`), del más reciente al más viejo. El punto ámbar avisa que ese mes
 * tiene gastos sin clasificar o descuadrados: es el "todavía te falta
 * resolver algo acá" que Claudia veía en su Excel a ojo.
 *
 * Es un `tablist` real: flechas ← → mueven entre chips, Home/End van a los
 * extremos.
 */
import { useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toCLPCompact } from "@/lib/format";
import type { PeriodoResumen } from "@/lib/claudia/types";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** "2026-08" → "Ago 2026". Sin `Date`: un string no tiene zona horaria. */
export function formatearPeriodo(periodo: string): string {
  const [y, m] = periodo.split("-");
  const mes = MESES[Number(m) - 1];
  if (!y || !mes) return periodo;
  return `${mes} ${y}`;
}

/** Espejo de `_periodo_to_corfo` del backend: "2026-08" → "Ago de 2026". */
export function periodoCorfo(periodo: string): string {
  const [y, m] = periodo.split("-");
  const mes = MESES[Number(m) - 1];
  if (!y || !mes) return periodo;
  return `${mes} de ${y}`;
}

interface Props {
  items: PeriodoResumen[];
  /** "" = Todos. */
  value: string;
  onChange: (periodo: string) => void;
  loading: boolean;
  nTotal: number;
  totalGeneral: string;
}

export function PeriodoChips({ items, value, onChange, loading, nTotal, totalGeneral }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  if (loading) {
    return (
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-36 shrink-0 rounded-full" />
        ))}
      </div>
    );
  }

  const opciones: Array<{ periodo: string; label: string; detalle: string; alerta: number }> = [
    {
      periodo: "",
      label: "Todos",
      detalle: `${nTotal} · ${toCLPCompact(totalGeneral)}`,
      alerta: items.reduce((acc, p) => acc + p.sin_clasificar + p.descuadrados, 0),
    },
    ...items.map((p) => ({
      periodo: p.periodo,
      label: formatearPeriodo(p.periodo),
      detalle: `${p.n} · ${toCLPCompact(p.total)}`,
      alerta: p.sin_clasificar + p.descuadrados,
    })),
  ];

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const idx = opciones.findIndex((o) => o.periodo === value);
    let next = -1;
    if (e.key === "ArrowRight") next = Math.min(opciones.length - 1, idx + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, idx - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = opciones.length - 1;
    if (next < 0 || next === idx) return;
    e.preventDefault();
    const o = opciones[next];
    if (!o) return;
    onChange(o.periodo);
    const btn = listRef.current?.querySelector<HTMLButtonElement>(`[data-periodo="${o.periodo}"]`);
    btn?.focus();
    btn?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Meses del registro"
      onKeyDown={onKeyDown}
      className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {opciones.map((o) => {
        const activo = o.periodo === value;
        return (
          <button
            key={o.periodo || "todos"}
            type="button"
            role="tab"
            aria-selected={activo}
            tabIndex={activo ? 0 : -1}
            data-periodo={o.periodo}
            onClick={() => onChange(o.periodo)}
            title={
              o.alerta > 0
                ? `${o.alerta} gasto${o.alerta === 1 ? "" : "s"} sin clasificar o descuadrado${o.alerta === 1 ? "" : "s"}`
                : undefined
            }
            className={cn(
              "group relative inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition-all duration-150 ease-apple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2",
              activo
                ? "bg-ink-900 text-white shadow-card"
                : "bg-white text-ink-700 ring-1 ring-hairline hover:bg-ink-100/60 hover:text-ink-900",
            )}
          >
            <span className="font-medium">{o.label}</span>
            <span
              className={cn(
                "text-xs tabular-nums",
                // white/80 sobre ink-900 (~11:1) y ink-500 sobre blanco (5,3:1): AA.
                activo ? "text-white/80" : "text-ink-500",
              )}
            >
              {o.detalle}
            </span>
            {o.alerta > 0 && (
              <>
                <span
                  className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-warning ring-2 ring-white"
                  aria-hidden
                />
                {/* El punto es sólo color: el lector de pantalla necesita el texto. */}
                <span className="sr-only">
                  {`, ${o.alerta} sin clasificar o descuadrado${o.alerta === 1 ? "" : "s"}`}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
