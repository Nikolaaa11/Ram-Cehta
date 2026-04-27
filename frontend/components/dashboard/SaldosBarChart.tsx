"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Surface } from "@/components/ui/surface";
import { useDashboardQuery } from "@/lib/dashboard/use-dashboard-query";
import { dashboardKeys } from "@/lib/dashboard/queries";
import { useDashboardFilters } from "@/lib/dashboard/use-dashboard-filters";
import { toCLP, toRelative } from "@/lib/format";
import { formatM } from "@/lib/dashboard/format-chart";
import { SaldosBarChartSkeleton } from "./SaldosBarChartSkeleton";
import { ChartTooltipShell } from "./ChartTooltip";
import type { SaldoEmpresaDetalle } from "@/lib/api/schema";
import { BarChart3 } from "lucide-react";

interface BarRow {
  empresa_codigo: string;
  razon_social: string;
  saldo_contable: number;
  saldo_cehta: number;
  saldo_corfo: number;
  delta_30d: number;
  ultima_actualizacion: string | null;
  hasData: boolean;
}

function parseRow(item: SaldoEmpresaDetalle): BarRow {
  const saldo_contable = item.saldo_contable === null ? 0 : Number(item.saldo_contable);
  const saldo_cehta = item.saldo_cehta === null ? 0 : Number(item.saldo_cehta);
  const saldo_corfo = item.saldo_corfo === null ? 0 : Number(item.saldo_corfo);
  return {
    empresa_codigo: item.empresa_codigo,
    razon_social: item.razon_social,
    saldo_contable,
    saldo_cehta,
    saldo_corfo,
    delta_30d: Number(item.delta_30d ?? 0),
    ultima_actualizacion: item.ultima_actualizacion,
    hasData: item.saldo_contable !== null,
  };
}

export function SaldosBarChart() {
  const { filters, setEmpresa } = useDashboardFilters();
  const query = useDashboardQuery<SaldoEmpresaDetalle[]>(
    dashboardKeys.saldosPorEmpresa(filters),
    "/dashboard/saldos-por-empresa",
  );

  if (query.isLoading || (!query.data && !query.isError)) {
    return <SaldosBarChartSkeleton />;
  }

  if (query.isError) {
    return (
      <Surface aria-label="Saldos por empresa — error">
        <Surface.Header>
          <Surface.Title>Saldos por empresa</Surface.Title>
          <Surface.Subtitle className="text-negative">
            No se pudo cargar los saldos. {query.error?.message}
          </Surface.Subtitle>
        </Surface.Header>
      </Surface>
    );
  }

  const items = (query.data ?? []).map(parseRow);
  const sorted = [...items].sort((a, b) => b.saldo_contable - a.saldo_contable);
  const noData = items.length === 0 || items.every((x) => !x.hasData);

  const lastUpdate = items
    .map((x) => x.ultima_actualizacion)
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);

  if (noData) {
    return (
      <Surface aria-label="Saldos por empresa — sin datos">
        <Surface.Header>
          <Surface.Title>Saldos por empresa</Surface.Title>
          <Surface.Subtitle>
            {items.length} empresas del portfolio
          </Surface.Subtitle>
        </Surface.Header>
        <Surface.Body className="flex h-[300px] flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/40">
            <BarChart3 className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-ink-500">
            Sin datos de saldos. ETL no ha corrido aún.
          </p>
        </Surface.Body>
      </Surface>
    );
  }

  return (
    <Surface aria-label={`Saldos por empresa — ${sorted.length} empresas`}>
      <Surface.Header>
        <Surface.Title>Saldos por empresa</Surface.Title>
        <Surface.Subtitle>
          {sorted.length} empresas del portfolio
          {lastUpdate ? ` · última actualización ${toRelative(lastUpdate)}` : ""}
        </Surface.Subtitle>
      </Surface.Header>
      <Surface.Body className="mt-4 h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={sorted}
            margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            accessibilityLayer
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(0,0,0,0.04)"
              horizontal={false}
            />
            <XAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              tick={{ fill: "#6e6e73", fontSize: 11 }}
              tickFormatter={(v: number) => formatM(v)}
            />
            <YAxis
              type="category"
              dataKey="empresa_codigo"
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              tick={{ fill: "#6e6e73", fontSize: 11 }}
              width={96}
            />
            <Tooltip
              content={<SaldosTooltip />}
              cursor={{ fill: "rgba(0,0,0,0.03)" }}
            />
            <Bar
              dataKey="saldo_contable"
              radius={[0, 4, 4, 0]}
              barSize={18}
              onClick={(d) => {
                const code = (d as unknown as BarRow)?.empresa_codigo;
                if (code) setEmpresa(code);
              }}
              style={{ cursor: "pointer" }}
            >
              {sorted.map((row) => (
                <Cell
                  key={row.empresa_codigo}
                  fill={row.saldo_contable < 0 ? "#ff3b30" : "#1d6f42"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Surface.Body>
    </Surface>
  );
}

interface SaldosTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: BarRow }>;
}

function SaldosTooltip({ active, payload }: SaldosTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const r = payload[0]?.payload;
  if (!r) return null;

  const deltaColor =
    r.delta_30d > 0
      ? "text-positive"
      : r.delta_30d < 0
        ? "text-negative"
        : "text-ink-700";

  return (
    <ChartTooltipShell
      title={r.empresa_codigo}
      subtitle={r.razon_social}
      rows={[
        {
          label: "Saldo contable",
          value: toCLP(r.saldo_contable),
          color: "#1d6f42",
          emphasis: true,
        },
        { label: "Cehta", value: toCLP(r.saldo_cehta) },
        { label: "CORFO", value: toCLP(r.saldo_corfo) },
        {
          label: "Δ 30 días",
          value: toCLP(r.delta_30d),
          valueClassName: deltaColor,
        },
      ]}
    />
  );
}
