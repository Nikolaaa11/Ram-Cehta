/**
 * ProgressBar — barra de progreso lineal Apple-style.
 *
 * Server-safe. Soporta:
 *   - Single fill con tono
 *   - Split fill (e.g. positive/warning/negative para compliance)
 *   - Animated stripe overlay (modo "active")
 *   - Indeterminate (loading sin saber %)
 *
 * Tamaños: sm (4px), md (6px), lg (10px).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface ProgressBarProps {
  /** Valor actual (0-100). Si undefined → indeterminate. */
  value?: number;
  /** Max del valor. Default 100. */
  max?: number;
  /** Tono del fill. */
  tone?: "default" | "positive" | "negative" | "warning" | "info" | "gold";
  size?: "sm" | "md" | "lg";
  /** Si true, agrega stripes animadas (cuando algo está procesando). */
  animated?: boolean;
  /** Label opcional arriba de la barra. */
  label?: string;
  /** Mostrar % a la derecha. */
  showValue?: boolean;
  className?: string;
}

const toneFills: Record<NonNullable<ProgressBarProps["tone"]>, string> = {
  default: "bg-gradient-to-r from-cehta-green to-emerald-500",
  positive: "bg-gradient-to-r from-positive to-emerald-400",
  negative: "bg-gradient-to-r from-negative to-red-500",
  warning: "bg-gradient-to-r from-warning to-amber-500",
  info: "bg-gradient-to-r from-sf-blue to-cyan-500",
  gold: "bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600",
};

const sizeClasses: Record<NonNullable<ProgressBarProps["size"]>, string> = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2.5",
};

export function ProgressBar({
  value,
  max = 100,
  tone = "default",
  size = "md",
  animated = false,
  label,
  showValue = false,
  className,
}: ProgressBarProps) {
  const pct = value !== undefined ? Math.max(0, Math.min(100, (value / max) * 100)) : null;
  const isIndeterminate = value === undefined;

  return (
    <div className={cn("w-full", className)}>
      {(label || showValue) && (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          {label && (
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
              {label}
            </span>
          )}
          {showValue && pct !== null && (
            <span className="text-xs font-semibold tabular-nums text-ink-700">
              {pct.toFixed(0)}%
            </span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value ?? undefined}
        className={cn(
          "relative w-full overflow-hidden rounded-full bg-ink-100",
          sizeClasses[size],
        )}
      >
        {isIndeterminate ? (
          // Indeterminate: barra que se mueve infinitely
          <div
            className={cn(
              "absolute inset-y-0 h-full w-1/3 rounded-full",
              toneFills[tone],
            )}
            style={{
              animation: "progress-indeterminate 1.5s cubic-bezier(0.65, 0.05, 0.36, 1) infinite",
            }}
          />
        ) : (
          <div
            className={cn(
              "h-full rounded-full transition-all duration-700 ease-apple",
              toneFills[tone],
              animated && "progress-stripes",
            )}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}

export interface ProgressSplitBarProps {
  segments: {
    value: number;
    tone: NonNullable<ProgressBarProps["tone"]>;
    label?: string;
  }[];
  size?: NonNullable<ProgressBarProps["size"]>;
  className?: string;
}

/**
 * Versión split con múltiples segmentos contiguos.
 * Total se calcula sumando todos los `value`. Cada segment ocupa
 * `value / total * 100%` del ancho.
 */
export function ProgressSplitBar({
  segments,
  size = "md",
  className,
}: ProgressSplitBarProps) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);

  return (
    <div
      role="progressbar"
      className={cn(
        "flex w-full overflow-hidden rounded-full bg-ink-100",
        sizeClasses[size],
        className,
      )}
    >
      {total > 0 ? (
        segments.map((seg, i) => (
          <div
            key={i}
            title={seg.label ?? `${seg.value}`}
            className={cn(
              "h-full transition-all duration-700 ease-apple",
              toneFills[seg.tone],
              i === 0 && "rounded-l-full",
              i === segments.length - 1 && "rounded-r-full",
            )}
            style={{ width: `${(seg.value / total) * 100}%` }}
          />
        ))
      ) : (
        <div className="h-full w-full bg-ink-200/30" />
      )}
    </div>
  );
}
