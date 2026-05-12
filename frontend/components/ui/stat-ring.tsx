"use client";

/**
 * StatRing — progress ring circular animado (Apple Watch style).
 *
 * SVG conic-stroke con dash-offset animado vía CSS transition.
 * Apple-tier: rounded caps + glow sutil + count-up del % central.
 *
 * Uso:
 *   <StatRing value={72} max={100} size={120} tone="positive" label="Cumplimiento" />
 *
 * Si `value` cambia, anima el delta con transition CSS (no requiere RAF).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface StatRingProps {
  /** Valor actual. */
  value: number;
  /** Valor máximo (100% del ring). Default 100. */
  max?: number;
  /** Diámetro en px. Default 96. */
  size?: number;
  /** Stroke width en px. Default 8. */
  stroke?: number;
  /** Color semántico. */
  tone?: "default" | "positive" | "negative" | "warning" | "gold";
  /** Label arriba del número central. */
  label?: string;
  /** Sufijo del número (%, días, etc.). */
  suffix?: string;
  /** Si true, no muestra texto central — sólo el ring. */
  hideText?: boolean;
  /** Decimales del número central. Default 0. */
  decimals?: number;
  className?: string;
}

const toneColors: Record<NonNullable<StatRingProps["tone"]>, { stroke: string; glow: string }> = {
  default: { stroke: "#1d6f42", glow: "rgba(29, 111, 66, 0.35)" },
  positive: { stroke: "#34c759", glow: "rgba(52, 199, 89, 0.40)" },
  negative: { stroke: "#ff3b30", glow: "rgba(255, 59, 48, 0.40)" },
  warning: { stroke: "#ff9500", glow: "rgba(255, 149, 0, 0.40)" },
  gold: { stroke: "#d4af37", glow: "rgba(212, 175, 55, 0.40)" },
};

export function StatRing({
  value,
  max = 100,
  size = 96,
  stroke = 8,
  tone = "default",
  label,
  suffix = "%",
  hideText = false,
  decimals = 0,
  className,
}: StatRingProps) {
  const pct = Math.max(0, Math.min(1, value / max));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);
  const colors = toneColors[tone];

  // Animar el display number (count-up suave)
  const [display, setDisplay] = React.useState(0);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const duration = 900;
    const fromValue = 0;
    let rafId: number;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(2, -10 * t);
      setDisplay(fromValue + (value - fromValue) * eased);
      if (t < 1) rafId = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [value]);

  const displayPct = (display / max) * 100;

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        style={{ filter: `drop-shadow(0 0 6px ${colors.glow})` }}
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={stroke}
          fill="none"
          className="text-ink-100 dark:text-ink-700"
          opacity={0.25}
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.stroke}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: "stroke-dashoffset 1s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      </svg>
      {!hideText && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {label && (
            <span className="text-[10px] font-medium uppercase tracking-wide text-ink-500 dark:text-ink-300">
              {label}
            </span>
          )}
          <span className="font-display text-2xl font-semibold tabular-nums tracking-tight text-ink-900 dark:text-ink-100">
            {decimals > 0
              ? displayPct.toFixed(decimals)
              : Math.round(displayPct)}
            <span className="ml-0.5 text-sm text-ink-500">{suffix}</span>
          </span>
        </div>
      )}
    </div>
  );
}
