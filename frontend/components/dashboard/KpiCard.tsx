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
  /** V5++ ola CA — si true, agrega glow gradient en hover (premium feel). */
  glow?: boolean;
  className?: string;
}

const toneIconBg: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "bg-ink-100/60 text-ink-700 ring-1 ring-ink-100",
  positive: "bg-positive/10 text-positive ring-1 ring-positive/20",
  negative: "bg-negative/10 text-negative ring-1 ring-negative/20",
  warning: "bg-warning/10 text-warning ring-1 ring-warning/20",
};

const toneAccentGradient: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default:
    "before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-ink-300 before:to-transparent",
  positive:
    "before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-positive/50 before:to-transparent",
  negative:
    "before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-negative/60 before:to-transparent",
  warning:
    "before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-warning/60 before:to-transparent",
};

const directionStyles: Record<KpiDelta["direction"], { color: string; bg: string; Icon: LucideIcon }> = {
  up: { color: "text-positive", bg: "bg-positive/8", Icon: TrendingUp },
  down: { color: "text-negative", bg: "bg-negative/8", Icon: TrendingDown },
  flat: { color: "text-ink-500", bg: "bg-ink-100/40", Icon: Minus },
};

/**
 * Render server-safe — sin hooks, sin "use client".
 * Renderiza una tarjeta KPI grande de tipografía display.
 *
 * V5++ ola CA: top accent gradient + delta como pill + sparkline con
 * gradient fill + opcional glow on hover.
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
  glow = false,
  className,
}: KpiCardProps) {
  const dir = delta ? directionStyles[delta.direction] : null;
  const DirIcon = dir?.Icon;

  const content = (
    <Surface
      variant={glow ? "glow" : href ? "interactive" : "default"}
      className={cn(
        // Top accent line — sutil indicator del tono
        "relative grid h-[160px] grid-rows-[auto_1fr_20px] overflow-hidden transition-all duration-300 ease-apple",
        toneAccentGradient[tone],
        href && !glow && "hover:-translate-y-0.5 hover:shadow-card-hover",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
          {label}
        </p>
        {Icon && (
          <span
            className={cn(
              "inline-flex h-9 w-9 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110",
              toneIconBg[tone],
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </span>
        )}
      </div>

      <div className="flex flex-col justify-end gap-0.5">
        <p className="font-display text-kpi-lg tabular-nums tracking-tight text-ink-900">
          {value}
        </p>
        {subtitle && (
          <p className="line-clamp-1 text-sm tabular-nums text-ink-500">
            {subtitle}
          </p>
        )}
      </div>

      {/* Bottom slot — siempre rendea con altura 20px (definida en grid-rows).
          V5++ ola CA: delta ahora se renderiza como pill con bg semi-transparente. */}
      <div className="flex items-end justify-between gap-3">
        {delta && dir ? (
          <div
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
              dir.color,
              dir.bg,
            )}
          >
            {DirIcon && <DirIcon className="h-3 w-3" strokeWidth={2} />}
            <span className="font-semibold tabular-nums">{delta.value}</span>
            <span className="text-ink-500">
              {delta.label}
            </span>
          </div>
        ) : (
          <span aria-hidden className="block h-5 w-1" />
        )}
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
        className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
      >
        {content}
      </Link>
    );
  }
  return <div className="group">{content}</div>;
}

/**
 * Sparkline puramente visual: SVG path normalizado al rango.
 * V5++ ola CA: agrega area fill con gradient para más impacto visual.
 */
function Sparkline({
  points,
  tone,
}: {
  points: number[];
  tone: NonNullable<KpiCardProps["tone"]>;
}) {
  if (points.length < 2) return null;
  const w = 72;
  const h = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = w / (points.length - 1);

  const linePath = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  // Area path — agrega cierre al fondo para llenar área debajo de la línea
  const areaPath = `${linePath} L${w.toFixed(1)},${h} L0,${h} Z`;

  const stroke =
    tone === "positive"
      ? "#34c759"
      : tone === "negative"
        ? "#ff3b30"
        : tone === "warning"
          ? "#ff9500"
          : "#1d6f42";

  const gradientId = `spark-grad-${tone}`;
  const lastPoint = {
    x: w,
    y: h - ((points[points.length - 1]! - min) / span) * h,
  };

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="shrink-0"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.30} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End-point dot — pequeño punto al final del trend */}
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r={2}
        fill={stroke}
      />
    </svg>
  );
}
