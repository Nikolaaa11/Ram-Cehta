"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Surface } from "@/components/ui/surface";
import { useDashboardQuery } from "@/lib/dashboard/use-dashboard-query";
import { dashboardKeys } from "@/lib/dashboard/queries";
import { useDashboardFilters } from "@/lib/dashboard/use-dashboard-filters";
import { toCLP } from "@/lib/format";
import { formatM, formatPeriodo, formatPeriodoFull } from "@/lib/dashboard/format-chart";
import { IvaTrendChartSkeleton } from "./IvaTrendChartSkeleton";
import { ChartTooltipShell } from "./ChartTooltip";
import type { IvaPoint } from "@/lib/api/schema";
import { Activity } from "lucide-react";

interface ParsedIva {
  periodo: string;
  iva_credito: number;
  iva_debito: number;
  iva_a_pagar: number;
}

function parseIva(p: IvaPoint): ParsedIva {
  return {
    periodo: p.periodo,
    iva_credito: Number(p.iva_credito),
    iva_debito: Number(p.iva_debito),
    iva_a_pagar: Number(p.iva_a_pagar),
  };
}

const SERIES = [
  { key: "iva_credito" as const, label: "IVA crédito", color: "#0a84ff" },
  { key: "iva_debito" as const, label: "IVA débito", color: "#5e5ce6" },
  { key: "iva_a_pagar" as const, label: "IVA a pagar", color: "#ff3b30" },
];

export function IvaTrendChart() {
  const { filters } = useDashboardFilters();
  const qs = filters.empresa
    ? `?empresa_codigo=${encodeURIComponent(filters.empresa)}&meses=12`
    : `?meses=12`;
  const query = useDashboardQuery<IvaPoint[]>(
    dashboardKeys.ivaTrend(filters),
    `/dashboard/iva-trend${qs}`,
  );

  const subtitleSuffix = filters.empresa ?? "Consolidado";

  if (query.isLoading || (!query.data && !query.isError)) {
    return <IvaTrendChartSkeleton />;
  }

  if (query.isError) {
    return (
      <Surface aria-label="IVA crédito vs débito — error">
        <Surface.Header>
          <Surface.Title>IVA crédito vs débito</Surface.Title>
          <Surface.Subtitle className="text-negative">
            No se pudo cargar la serie de IVA. {query.error?.message}
          </Surface.Subtitle>
        </Surface.Header>
      </Surface>
    );
  }

  const data = (query.data ?? []).map(parseIva);

  if (data.length === 0) {
    return (
      <Surface aria-label="IVA crédito vs débito — sin datos">
        <Surface.Header>
          <Surface.Title>IVA crédito vs débito</Surface.Title>
          <Surface.Subtitle>
            Últimos 12 meses · {subtitleSuffix}
          </Surface.Subtitle>
        </Surface.Header>
        <Surface.Body className="flex h-[300px] flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/40">
            <Activity className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-ink-500">Sin períodos con IVA registrado.</p>
        </Surface.Body>
      </Surface>
    );
  }

  return (
    <Surface aria-label={`IVA crédito vs débito — ${data.length} períodos`}>
      <Surface.Header>
        <Surface.Title>IVA crédito vs débito</Surface.Title>
        <Surface.Subtitle>
          Últimos 12 meses · {subtitleSuffix}
        </Surface.Subtitle>
      </Surface.Header>
      <Surface.Body className="mt-4 h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            barCategoryGap="20%"
            accessibilityLayer
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(0,0,0,0.04)"
              vertical={false}
            />
            <XAxis
              dataKey="periodo"
              axisLine={false}
              tickLine={false}
              tickMargin={12}
              tick={{ fill: "#6e6e73", fontSize: 11 }}
              tickFormatter={formatPeriodo}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              tick={{ fill: "#6e6e73", fontSize: 11 }}
              tickFormatter={(v: number) => formatM(v)}
              width={60}
            />
            <Tooltip
              content={<IvaTooltip />}
              cursor={{ fill: "rgba(0,0,0,0.03)" }}
            />
            <Legend
              verticalAlign="bottom"
              height={28}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, color: "#6e6e73" }}
            />
            {SERIES.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={s.color}
                radius={[4, 4, 0, 0]}
                name={s.label}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Surface.Body>
    </Surface>
  );
}

interface IvaTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ParsedIva }>;
}

function IvaTooltip({ active, payload }: IvaTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <ChartTooltipShell
      title={formatPeriodoFull(p.periodo)}
      rows={[
        {
          label: "IVA crédito",
          value: toCLP(p.iva_credito),
          color: "#0a84ff",
        },
        {
          label: "IVA débito",
          value: toCLP(p.iva_debito),
          color: "#5e5ce6",
        },
        {
          label: "IVA a pagar",
          value: toCLP(p.iva_a_pagar),
          color: "#ff3b30",
          emphasis: true,
        },
      ]}
    />
  );
}
