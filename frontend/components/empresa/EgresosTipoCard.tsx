"use client";

import * as React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { PieChart as PieIcon } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { ChartTooltipShell } from "@/components/dashboard/ChartTooltip";
import { formatM } from "@/lib/dashboard/format-chart";
import { toCLP, toPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EgresoTipoItem } from "@/lib/api/schema";

interface Slice {
  name: string;
  value: number;
  color: string;
  porcentaje: number;
  transaction_count: number;
}

function toSlices(items: EgresoTipoItem[]): {
  slices: Slice[];
  total: number;
  totalTx: number;
} {
  const slices: Slice[] = items.map((it) => ({
    name: it.categoria,
    value: Number(it.total_egreso),
    color: it.color,
    porcentaje: it.porcentaje,
    transaction_count: it.transaction_count,
  }));
  const total = slices.reduce((acc, s) => acc + s.value, 0);
  const totalTx = slices.reduce((acc, s) => acc + s.transaction_count, 0);
  return { slices, total, totalTx };
}

export function EgresosTipoCard({ data }: { data: EgresoTipoItem[] }) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);

  if (data.length === 0) {
    return (
      <Surface aria-label="Egresos por tipo — sin datos">
        <Surface.Header>
          <Surface.Title>Egresos por Tipo</Surface.Title>
          <Surface.Subtitle>Sin egresos registrados.</Surface.Subtitle>
        </Surface.Header>
        <Surface.Body className="flex h-[300px] flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/40">
            <PieIcon className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-ink-500">Sin movimientos.</p>
        </Surface.Body>
      </Surface>
    );
  }

  const { slices, total, totalTx } = toSlices(data);

  return (
    <Surface aria-label={`Egresos por tipo — total ${toCLP(total)}`}>
      <Surface.Header>
        <Surface.Title>Egresos por Tipo</Surface.Title>
        <Surface.Subtitle>
          {toCLP(total)} · {totalTx} {totalTx === 1 ? "movimiento" : "movimientos"}
        </Surface.Subtitle>
      </Surface.Header>
      <Surface.Body className="mt-4 flex h-[300px] flex-row items-center gap-4">
        <div className="relative h-full flex-shrink-0" style={{ width: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart accessibilityLayer>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                innerRadius={70}
                outerRadius={110}
                paddingAngle={2}
                cornerRadius={4}
                stroke="#fff"
                strokeWidth={2}
                isAnimationActive
                animationDuration={400}
              >
                {slices.map((slice, i) => (
                  <Cell
                    key={slice.name}
                    fill={slice.color}
                    fillOpacity={
                      hoveredIdx === null || hoveredIdx === i ? 1 : 0.35
                    }
                    style={{
                      transition:
                        "fill-opacity 200ms cubic-bezier(0.16,1,0.3,1)",
                    }}
                  />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip />} cursor={false} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-[10px] font-medium uppercase tracking-wide text-ink-500">
              Total egresos
            </p>
            <p className="mt-0.5 font-display text-lg font-semibold tabular-nums text-ink-900">
              {formatM(total)}
            </p>
          </div>
        </div>

        <ul className="max-h-full flex-1 min-w-0 space-y-1.5 overflow-y-auto pr-1">
          {slices.map((slice, i) => (
            <li
              key={slice.name}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={cn(
                "-mx-1.5 flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors",
                hoveredIdx === i ? "bg-ink-100/40" : "",
              )}
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
                aria-hidden
              />
              <span className="flex-1 truncate text-ink-700">{slice.name}</span>
              <span className="font-medium tabular-nums text-ink-900">
                {formatM(slice.value)}
              </span>
              <span className="w-10 text-right tabular-nums text-ink-500">
                {toPct(slice.porcentaje, { digits: 1 })}
              </span>
            </li>
          ))}
        </ul>
      </Surface.Body>
    </Surface>
  );
}

interface DonutTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: Slice }>;
}

function DonutTooltip({ active, payload }: DonutTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const slice = payload[0]?.payload;
  if (!slice) return null;
  return (
    <ChartTooltipShell
      title={slice.name}
      rows={[
        {
          label: "Total",
          value: toCLP(slice.value),
          color: slice.color,
          emphasis: true,
        },
        { label: "% del total", value: toPct(slice.porcentaje, { digits: 1 }) },
        { label: "Movimientos", value: String(slice.transaction_count) },
      ]}
    />
  );
}
