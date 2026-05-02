import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

export interface KpiDelta {
  /** Texto ya formateado (e.g. "+8.2%"). El backend manda valor + signo. */
  value: string;
  /** Etiqueta secundaria (e.g. "vs. mes anterior"). */
  label: string;
  /** Direccion semantizada por backend; el frontend NO la calcula. */
  direction: "up" | "down" | "flat";
}

export interface KpiCardProps {
  label: string;
  /** Valor ya formateado por `toCLP`/`toPct`/etc. */
  value: string;
  /** Subtítulo opcional (e.g. monto en CLP debajo del contador). */
  subtitle?: string;
  delta?: KpiDelta;
  icon?: LucideIcon;
  /** Sparkline ultra-minimal embebido. Si presente, render 60×24. */
  sparkline?: number[];
  /** Si está, envuelve la card en `<Link>` y aplica hover lift. */
  href?: Route;
  /** Tono de la tarjeta — afecta solo el icono. Default. */
  tone?: "default" | "positive" | "negative" | "warning";
  className?: string;
}

const toneIconBg: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "bg-ink-100/60 text-ink-700",
  positive: "bg-positive/10 text-positive",
  negative: "bg-negative/10 text-negative",
  warning: "bg-warning/10 text-warning",
};

const directionStyles: Record<KpiDelta["direction"], { color: string; Icon: LucideIcon }> = {
  up: { color: "text-positive", Icon: TrendingUp },
  down: { color: "text-negative", Icon: TrendingDown },
  flat: { color: "text-ink-500", Icon: Minus },
};

/**
 * Render server-safe — sin hooks, sin "use client".
 * Renderiza una tarjeta KPI grande de tipografía display.
 */
export function KpiCard({
  label,
  value,
  subtitle,
  delta,
  icon: Icon,
  sparkline,
  href,
  tone = "default",
  className,
}: KpiCardProps) {
  const dir = delta ? directionStyles[delta.direction] : null;
  const DirIcon = dir?.Icon;

  const content = (
    <Surface
      variant={href ? "interactive" : "default"}
      className={cn("relative flex h-[160px] flex-col justify-between", className)}
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
          {label}
        </p>
        {Icon && (
          <span
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-xl",
              toneIconBg[tone],
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.5} />
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <p className="font-display text-kpi-lg tabular-nums text-ink-900">{value}</p>
        {subtitle && (
          <p className="text-sm tabular-nums text-ink-500">{subtitle}</p>
        )}
      </div>

      {/* Bottom slot — altura fija (h-5) garantiza que el valor del medio
          queda siempre en la misma posición vertical, tenga delta o no.
          Antes: con `<span />` vacío, justify-between redistribuía y el
          valor flotaba al centro de la card. */}
      <div className="flex h-5 items-end justify-between gap-3">
        {delta ? (
          <div
            className={cn(
              "flex items-center gap-1.5 text-sm",
              dir?.color,
            )}
          >
            {DirIcon && <DirIcon className="h-3.5 w-3.5" strokeWidth={1.75} />}
            <span className="font-medium tabular-nums">{delta.value}</span>
            <span className="text-ink-500">{delta.label}</span>
          </div>
        ) : null}
        {sparkline && sparkline.length > 1 && (
          <Sparkline points={sparkline} tone={tone} />
        )}
      </div>
    </Surface>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
      >
        {content}
      </Link>
    );
  }
  return content;
}

/**
 * Sparkline puramente visual: SVG path normalizado al rango. Sin tooltips.
 * Cualquier interactividad va en chart full (Phase 4+).
 */
function Sparkline({
  points,
  tone,
}: {
  points: number[];
  tone: NonNullable<KpiCardProps["tone"]>;
}) {
  if (points.length < 2) return null;
  const w = 60;
  const h = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const stroke =
    tone === "positive"
      ? "#34c759"
      : tone === "negative"
        ? "#ff3b30"
        : tone === "warning"
          ? "#ff9500"
          : "#1d6f42";

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="shrink-0"
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
