"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Tooltip Apple-style para Recharts. No es un wrapper de `<Tooltip content>`;
 * se pasa como `<Tooltip content={<ChartTooltip ... />} />` y Recharts inyecta
 * `active`, `payload`, `label`.
 *
 * No usamos `<Surface variant="elevated">` directamente para evitar costos de
 * SSR/CSR en hover; un div tailwind-only tiene el mismo look.
 */
export interface ChartTooltipRow {
  label: string;
  value: string;
  /** Color del dot (hex/rgba). Si se omite, no se renderiza dot. */
  color?: string;
  /** Estilo opcional para destacar (e.g. flujo neto en bold). */
  emphasis?: boolean;
  /** Color del texto del valor (e.g. positive/negative). */
  valueClassName?: string;
}

interface Props {
  /** Etiqueta principal — usualmente el período del eje X. */
  title: string;
  /** Subtítulo opcional (e.g. razón social de la empresa). */
  subtitle?: string;
  rows: ChartTooltipRow[];
  className?: string;
}

export function ChartTooltipShell({ title, subtitle, rows, className }: Props) {
  return (
    <div
      className={cn(
        "rounded-xl bg-white/95 backdrop-blur-md ring-1 ring-hairline shadow-card-hover",
        "px-3 py-2.5 min-w-[180px]",
        className,
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
        {title}
      </p>
      {subtitle && (
        <p className="text-xs text-ink-700 mt-0.5">{subtitle}</p>
      )}
      <div className="mt-2 space-y-1">
        {rows.map((row, i) => (
          <div
            key={`${row.label}-${i}`}
            className="flex items-center justify-between gap-4 text-xs tabular-nums"
          >
            <div className="flex items-center gap-1.5 text-ink-700">
              {row.color && (
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: row.color }}
                  aria-hidden
                />
              )}
              <span>{row.label}</span>
            </div>
            <span
              className={cn(
                row.emphasis ? "font-semibold text-ink-900" : "text-ink-900",
                row.valueClassName,
              )}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
