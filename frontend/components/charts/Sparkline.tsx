"use client";

/**
 * Sparkline — mini-gráfico inline para mostrar tendencias en KPI cards (R152bb).
 *
 * Renderiza una línea con gradient fill y un punto al final indicando
 * el valor actual. Sin ejes, sin labels — solo señal visual.
 *
 * Uso: <Sparkline data={[12, 19, 15, 22, 28, 25, 31]} trend="up" />
 */
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";

interface Props {
  data: number[];
  trend?: "up" | "down" | "flat";
  height?: number;
  /** Color override; si se omite se elige según trend */
  color?: string;
  /** Si true, agrega tooltip al hover */
  showTooltip?: boolean;
  /** Label opcional para el tooltip ("Vouchers", "CLP", etc) */
  label?: string;
}

const TREND_COLOR: Record<NonNullable<Props["trend"]>, string> = {
  up: "#236C4F",     // cehta-green (positivo)
  down: "#DC2626",   // red-600 (negativo)
  flat: "#9CA3AF",   // ink-400 (neutro)
};

export function Sparkline({
  data,
  trend = "flat",
  height = 32,
  color,
  showTooltip = false,
  label = "Valor",
}: Props) {
  if (!data || data.length === 0) {
    return <div className="h-8 w-full rounded bg-ink-100/40" />;
  }

  const stroke = color ?? TREND_COLOR[trend];
  const gradId = `spark-grad-${stroke.replace("#", "")}-${data.length}`;

  // Convertir array a [{v: n}] que recharts entiende
  const series = data.map((v, i) => ({ i, v }));

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          {showTooltip && (
            <Tooltip
              cursor={{ stroke: "#E5E7EB", strokeWidth: 1 }}
              contentStyle={{
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                padding: "4px 8px",
                fontSize: 11,
                fontFamily: "inherit",
              }}
              formatter={(v: number) => [v.toLocaleString("es-CL"), label]}
              labelFormatter={() => ""}
            />
          )}
          <Area
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={1.8}
            fill={`url(#${gradId})`}
            isAnimationActive={true}
            animationDuration={900}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
