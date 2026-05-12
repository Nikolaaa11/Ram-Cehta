/**
 * MetricGrid — grid responsivo de métricas compactas premium.
 *
 * Para mostrar 3–6 KPIs secundarios sin el overhead visual de KpiCard
 * (que es altura fija 160px). MetricItem es ~96px y se ve mejor cuando
 * complementa cards principales arriba.
 *
 * Server-safe. Cada MetricItem soporta opcionalmente:
 *   - Sparkline mini (opcional)
 *   - Tone para el accent color (default | positive | negative | warning)
 *   - Delta numérico ya formateado
 *
 * Uso:
 *   <MetricGrid columns={4}>
 *     <MetricItem label="Vouchers hoy" value="42" tone="positive" delta="+8" />
 *     <MetricItem label="Pendientes" value="3" tone="warning" />
 *   </MetricGrid>
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface MetricGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Columnas en desktop. Default 4. */
  columns?: 2 | 3 | 4 | 5 | 6;
  children: React.ReactNode;
}

const colsMap: Record<NonNullable<MetricGridProps["columns"]>, string> = {
  2: "md:grid-cols-2",
  3: "sm:grid-cols-2 md:grid-cols-3",
  4: "sm:grid-cols-2 md:grid-cols-4",
  5: "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
  6: "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6",
};

export function MetricGrid({
  columns = 4,
  className,
  children,
  ...props
}: MetricGridProps) {
  return (
    <div
      className={cn("grid grid-cols-1 gap-3", colsMap[columns], className)}
      {...props}
    >
      {children}
    </div>
  );
}

export interface MetricItemProps {
  label: string;
  value: string | number;
  /** Sub-texto pequeño debajo. */
  hint?: string;
  /** Delta texto formateado (ej. "+5%", "-12"). */
  delta?: {
    value: string;
    direction: "up" | "down" | "flat";
  };
  tone?: "default" | "positive" | "negative" | "warning" | "info";
  /** Mini sparkline opcional. */
  sparkline?: number[];
  className?: string;
}

const toneAccent: Record<NonNullable<MetricItemProps["tone"]>, string> = {
  default: "before:bg-ink-300/40",
  positive: "before:bg-gradient-to-b before:from-positive/60 before:to-positive/20",
  negative: "before:bg-gradient-to-b before:from-negative/60 before:to-negative/20",
  warning: "before:bg-gradient-to-b before:from-warning/60 before:to-warning/20",
  info: "before:bg-gradient-to-b before:from-sf-blue/60 before:to-sf-blue/20",
};

const directionStyle: Record<
  NonNullable<MetricItemProps["delta"]>["direction"],
  string
> = {
  up: "text-positive",
  down: "text-negative",
  flat: "text-ink-500",
};

export function MetricItem({
  label,
  value,
  hint,
  delta,
  tone = "default",
  sparkline,
  className,
}: MetricItemProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl bg-white p-3.5 ring-1 ring-hairline shadow-card transition-all duration-200 ease-apple hover:shadow-card-hover hover:-translate-y-0.5",
        "before:absolute before:left-0 before:top-3 before:bottom-3 before:w-0.5 before:rounded-r-full",
        toneAccent[tone],
        "dark:bg-ink-900 dark:ring-ink-800",
        className,
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-ink-900 dark:text-ink-100">
          {value}
        </p>
        {delta && (
          <span
            className={cn(
              "text-xs font-medium tabular-nums",
              directionStyle[delta.direction],
            )}
          >
            {delta.value}
          </span>
        )}
      </div>
      {hint && (
        <p className="mt-0.5 text-[11px] text-ink-500 dark:text-ink-400 line-clamp-1">
          {hint}
        </p>
      )}
      {sparkline && sparkline.length > 1 && (
        <div className="mt-2">
          <MiniSparkline points={sparkline} tone={tone} />
        </div>
      )}
    </div>
  );
}

function MiniSparkline({
  points,
  tone,
}: {
  points: number[];
  tone: NonNullable<MetricItemProps["tone"]>;
}) {
  const w = 100;
  const h = 16;
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

  const stroke =
    tone === "positive"
      ? "#34c759"
      : tone === "negative"
        ? "#ff3b30"
        : tone === "warning"
          ? "#ff9500"
          : tone === "info"
            ? "#0a84ff"
            : "#1d6f42";

  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
