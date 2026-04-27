"use client";

import * as React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Surface } from "@/components/ui/surface";
import { useDashboardQuery } from "@/lib/dashboard/use-dashboard-query";
import { dashboardKeys } from "@/lib/dashboard/queries";
import { useDashboardFilters } from "@/lib/dashboard/use-dashboard-filters";
import { APPLE_PALETTE, colorAt } from "@/lib/dashboard/chart-palette";
import { toCLP, toPct } from "@/lib/format";
import { formatM } from "@/lib/dashboard/format-chart";
import { EgresosDonutSkeleton } from "./EgresosDonutSkeleton";
import { ChartTooltipShell } from "./ChartTooltip";
import { cn } from "@/lib/utils";
import { PieChart as PieIcon } from "lucide-react";
import type { EgresoConcepto } from "@/lib/api/schema";

interface Slice {
  name: string;
  value: number;
  color: string;
  porcentaje: number;
  num_movimientos: number;
}

const TOP_N = 9;

function buildSlices(items: EgresoConcepto[]): {
  slices: Slice[];
  total: number;
  totalMovs: number;
} {
  const sorted = [...items].sort(
    (a, b) => Number(b.total_egreso) - Number(a.total_egreso),
  );
  const top = sorted.slice(0, TOP_N);
  const rest = sorted.slice(TOP_N);
  const total = sorted.reduce((acc, x) => acc + Number(x.total_egreso), 0);
  const totalMovs = sorted.reduce((acc, x) => acc + x.num_movimientos, 0);

  const slices: Slice[] = top.map((item, i) => ({
    name: item.concepto_general || item.concepto_detallado || "Sin concepto",
    value: Number(item.total_egreso),
    color: colorAt(i),
    porcentaje: item.porcentaje,
    num_movimientos: item.num_movimientos,
  }));

  if (rest.length > 0) {
    const restValue = rest.reduce((acc, x) => acc + Number(x.total_egreso), 0);
    const restPct = total > 0 ? (restValue / total) * 100 : 0;
    const restMovs = rest.reduce((acc, x) => acc + x.num_movimientos, 0);
    slices.push({
      name: "Otros",
      value: restValue,
      color: APPLE_PALETTE[9]!, // gris
      porcentaje: restPct,
      num_movimientos: restMovs,
    });
  }

  return { slices, total, totalMovs };
}

export function EgresosDonut() {
  const { filters } = useDashboardFilters();
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);

  // El backend usa current_periodo si no se pasa periodo. Sólo enviamos empresa.
  const qs = filters.empresa
    ? `?empresa_codigo=${encodeURIComponent(filters.empresa)}`
    : "";
  const query = useDashboardQuery<EgresoConcepto[]>(
    dashboardKeys.egresosPorConcepto(filters),
    `/dashboard/egresos-por-concepto${qs}`,
  );

  if (query.isLoading || (!query.data && !query.isError)) {
    return <EgresosDonutSkeleton />;
  }

  if (query.isError) {
    return (
      <Surface aria-label="Egresos por concepto — error">
        <Surface.Header>
          <Surface.Title>Egresos por concepto</Surface.Title>
          <Surface.Subtitle className="text-negative">
            No se pudo cargar la distribución. {query.error?.message}
          </Surface.Subtitle>
        </Surface.Header>
      </Surface>
    );
  }

  const items = query.data ?? [];
  if (items.length === 0) {
    return (
      <Surface aria-label="Egresos por concepto — sin datos">
        <Surface.Header>
          <Surface.Title>Egresos por concepto</Surface.Title>
          <Surface.Subtitle>Sin egresos en el período actual</Surface.Subtitle>
        </Surface.Header>
        <Surface.Body className="flex h-[300px] flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/40">
            <PieIcon className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-ink-500">Sin movimientos registrados.</p>
        </Surface.Body>
      </Surface>
    );
  }

  const { slices, total, totalMovs } = buildSlices(items);

  return (
    <Surface aria-label={`Egresos por concepto — total ${toCLP(total)}`}>
      <Surface.Header>
        <Surface.Title>Egresos por concepto</Surface.Title>
        <Surface.Subtitle>
          {toCLP(total)} · {totalMovs} {totalMovs === 1 ? "movimiento" : "movimientos"}
        </Surface.Subtitle>
      </Surface.Header>
      <Surface.Body className="mt-4 h-[300px] flex flex-row items-center gap-4">
        {/* Donut */}
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
                isAnimationActive={true}
                animationDuration={400}
              >
                {slices.map((slice, i) => (
                  <Cell
                    key={slice.name}
                    fill={slice.color}
                    fillOpacity={hoveredIdx === null || hoveredIdx === i ? 1 : 0.35}
                    style={{ transition: "fill-opacity 200ms cubic-bezier(0.16,1,0.3,1)" }}
                  />
                ))}
              </Pie>
              <Tooltip
                content={<DonutTooltip />}
                cursor={false}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Centro absoluto */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <p className="text-[10px] font-medium uppercase tracking-wide text-ink-500">
              Total egresos
            </p>
            <p className="font-display text-lg font-semibold tabular-nums text-ink-900 mt-0.5">
              {formatM(total)}
            </p>
          </div>
        </div>

        {/* Leyenda */}
        <ul className="flex-1 min-w-0 space-y-1.5 max-h-full overflow-y-auto pr-1">
          {slices.map((slice, i) => (
            <li
              key={slice.name}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={cn(
                "flex items-center gap-2 text-xs cursor-default rounded-md px-1.5 py-1 -mx-1.5 transition-colors",
                hoveredIdx === i ? "bg-ink-100/40" : "",
              )}
            >
              <span
                className="inline-block h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: slice.color }}
                aria-hidden
              />
              <span className="flex-1 truncate text-ink-700">{slice.name}</span>
              <span className="tabular-nums text-ink-900 font-medium">
                {formatM(slice.value)}
              </span>
              <span className="tabular-nums text-ink-500 w-10 text-right">
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
        { label: "Total", value: toCLP(slice.value), color: slice.color, emphasis: true },
        { label: "% del total", value: toPct(slice.porcentaje, { digits: 1 }) },
        {
          label: "Movimientos",
          value: String(slice.num_movimientos),
        },
      ]}
    />
  );
}
