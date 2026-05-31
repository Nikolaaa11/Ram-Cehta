"use client";

/**
 * DonutKPI — donut compacto con valor central animado (R152bb).
 *
 * Pensado para mostrar % de completitud, ratio de éxito, etc.
 *
 * Uso:
 *   <DonutKPI value={73} total={100} label="Adopción" color="#236C4F" />
 */
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { AnimatedNumber } from "./AnimatedNumber";

interface Props {
  /** Valor actual */
  value: number;
  /** Total/máximo (default 100) */
  total?: number;
  /** Label que va debajo del número */
  label: string;
  /** Color del arco principal */
  color?: string;
  /** Color del arco de fondo (resto) */
  bgColor?: string;
  /** Tamaño en px (default 140) */
  size?: number;
  /** Suffix opcional para el número central */
  suffix?: string;
  /** Formato del número */
  format?: "int" | "pct";
}

export function DonutKPI({
  value,
  total = 100,
  label,
  color = "#236C4F",
  bgColor = "#F3F4F6",
  size = 140,
  suffix,
  format = "pct",
}: Props) {
  const safeValue = Math.max(0, Math.min(value, total));
  const remainder = Math.max(0, total - safeValue);
  const data = [
    { name: "value", v: safeValue },
    { name: "rest", v: remainder },
  ];
  const pct = total > 0 ? Math.round((safeValue / total) * 100) : 0;

  return (
    <div
      className="relative inline-flex flex-col items-center"
      style={{ width: size, height: size }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="v"
            cx="50%"
            cy="50%"
            innerRadius={size * 0.32}
            outerRadius={size * 0.46}
            startAngle={90}
            endAngle={-270}
            paddingAngle={1.5}
            isAnimationActive={true}
            animationDuration={900}
            animationEasing="ease-out"
            stroke="none"
          >
            <Cell fill={color} />
            <Cell fill={bgColor} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <AnimatedNumber
          value={format === "pct" ? pct : safeValue}
          format={format === "pct" ? "pct" : "int"}
          decimals={0}
          suffix={suffix}
          className="font-display text-2xl font-semibold text-ink-900"
        />
        <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-500">
          {label}
        </span>
      </div>
    </div>
  );
}
