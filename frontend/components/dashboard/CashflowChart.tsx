"use client";

import * as React from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Surface } from "@/components/ui/surface";
import { useDashboardQuery } from "@/lib/dashboard/use-dashboard-query";
import { dashboardKeys } from "@/lib/dashboard/queries";
import { useDashboardFilters } from "@/lib/dashboard/use-dashboard-filters";
import { formatM, formatPeriodo, formatPeriodoFull } from "@/lib/dashboard/format-chart";
import { toCLP } from "@/lib/format";
import { CashflowChartSkeleton } from "./CashflowChartSkeleton";
import { ChartTooltipShell, type ChartTooltipRow } from "./ChartTooltip";
import type { CashflowResponse, CashflowPoint } from "@/lib/api/schema";
import { cn } from "@/lib/utils";
import { LineChart as LineIcon } from "lucide-react";

type Tab = "real" | "proyectado" | "acumulado";

const TABS: { key: Tab; label: string }[] = [
  { key: "real", label: "Real" },
  { key: "proyectado", label: "Proyectado" },
  { key: "acumulado", label: "Acumulado" },
];

interface PointParsed {
  periodo: string;
  abono_real: number;
  egreso_real: number;
  abono_proyectado: number;
  egreso_proyectado: number;
  flujo_neto_real: number;
  flujo_neto_proyectado: number;
  saldo_acumulado: number;
}

function parsePoint(p: CashflowPoint): PointParsed {
  return {
    periodo: p.periodo,
    abono_real: Number(p.abono_real),
    egreso_real: Number(p.egreso_real),
    abono_proyectado: Number(p.abono_proyectado),
    egreso_proyectado: Number(p.egreso_proyectado),
    flujo_neto_real: Number(p.flujo_neto_real),
    flujo_neto_proyectado: Number(p.flujo_neto_proyectado),
    saldo_acumulado: Number(p.saldo_acumulado),
  };
}

export function CashflowChart() {
  const { filters } = useDashboardFilters();
  const [tab, setTab] = React.useState<Tab>("real");

  const qs = filters.empresa
    ? `?empresa_codigo=${encodeURIComponent(filters.empresa)}&meses=12`
    : `?meses=12`;
  const query = useDashboardQuery<CashflowResponse>(
    dashboardKeys.cashflow(filters),
    `/dashboard/cashflow${qs}`,
  );

  const subtitleSuffix = filters.empresa
    ? filters.empresa
    : "Consolidado";

  if (query.isLoading || (!query.data && !query.isError)) {
    return <CashflowChartSkeleton />;
  }

  if (query.isError) {
    return (
      <Surface aria-label="Flujo de caja — error">
        <Surface.Header>
          <Surface.Title>Flujo de caja</Surface.Title>
          <Surface.Subtitle className="text-negative">
            No se pudo cargar el cashflow. {query.error?.message}
          </Surface.Subtitle>
        </Surface.Header>
      </Surface>
    );
  }

  const data = (query.data?.points ?? []).map(parsePoint);

  if (data.length === 0) {
    return (
      <Surface aria-label="Flujo de caja — sin datos">
        <Surface.Header>
          <Surface.Title>Flujo de caja</Surface.Title>
          <Surface.Subtitle>
            Últimos 12 meses · {subtitleSuffix}
          </Surface.Subtitle>
        </Surface.Header>
        <Surface.Body className="flex h-[300px] flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/40">
            <LineIcon className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-ink-500">Sin movimientos en el período.</p>
        </Surface.Body>
      </Surface>
    );
  }

  return (
    <Surface aria-label={`Flujo de caja últimos 12 meses, vista ${tab}`}>
      <Surface.Header className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Surface.Title>Flujo de caja</Surface.Title>
          <Surface.Subtitle>
            Últimos 12 meses · {subtitleSuffix}
          </Surface.Subtitle>
        </div>
        <div
          role="tablist"
          aria-label="Vista del flujo"
          className="inline-flex shrink-0 rounded-xl bg-ink-100/50 p-0.5"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-lg transition-all duration-200 ease-apple",
                tab === t.key
                  ? "bg-white text-ink-900 shadow-card"
                  : "text-ink-500 hover:text-ink-700",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Surface.Header>
      <Surface.Body className="mt-4 h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            accessibilityLayer
          >
            <defs>
              <linearGradient id="cehtaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1d6f42" stopOpacity={0.30} />
                <stop offset="100%" stopColor="#1d6f42" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="negativeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ff3b30" stopOpacity={0.10} />
                <stop offset="100%" stopColor="#ff3b30" stopOpacity={0} />
              </linearGradient>
            </defs>
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
            {tab === "acumulado" && (
              <YAxis
                yAxisId="right"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tickMargin={8}
                tick={{ fill: "#6e6e73", fontSize: 11 }}
                tickFormatter={(v: number) => formatM(v)}
                width={60}
              />
            )}
            <Tooltip
              content={<CashflowTooltip tab={tab} />}
              cursor={{ stroke: "rgba(0,0,0,0.06)" }}
            />

            {tab === "real" && (
              <>
                <Area
                  type="monotone"
                  dataKey="abono_real"
                  fill="url(#cehtaGradient)"
                  stroke="#1d6f42"
                  strokeWidth={2}
                  name="Abonos"
                />
                <Area
                  type="monotone"
                  dataKey="egreso_real"
                  fill="url(#negativeGradient)"
                  stroke="#ff3b30"
                  strokeWidth={2}
                  name="Egresos"
                />
              </>
            )}

            {tab === "proyectado" && (
              <>
                <Area
                  type="monotone"
                  dataKey="abono_real"
                  fill="url(#cehtaGradient)"
                  stroke="#1d6f42"
                  strokeWidth={2}
                  name="Abonos reales"
                />
                <Line
                  type="monotone"
                  dataKey="flujo_neto_proyectado"
                  stroke="#0a84ff"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                  name="Flujo proyectado"
                />
              </>
            )}

            {tab === "acumulado" && (
              <Line
                type="monotone"
                dataKey="saldo_acumulado"
                stroke="#1d1d1f"
                strokeWidth={2}
                dot={false}
                yAxisId="right"
                name="Saldo acumulado"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </Surface.Body>
    </Surface>
  );
}

interface RechartsTooltipPayload {
  active?: boolean;
  payload?: Array<{ payload: PointParsed }>;
}

function CashflowTooltip({
  active,
  payload,
  tab,
}: RechartsTooltipPayload & { tab: Tab }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;

  const flujoColor =
    p.flujo_neto_real > 0
      ? "text-positive"
      : p.flujo_neto_real < 0
        ? "text-negative"
        : "text-ink-700";

  const rows: ChartTooltipRow[] = [
    {
      label: "Abonos",
      value: toCLP(p.abono_real),
      color: "#1d6f42",
    },
    {
      label: "Egresos",
      value: toCLP(p.egreso_real),
      color: "#ff3b30",
    },
    {
      label: "Flujo neto",
      value: toCLP(p.flujo_neto_real),
      emphasis: true,
      valueClassName: flujoColor,
    },
  ];
  if (tab === "proyectado") {
    rows.push({
      label: "Proyectado",
      value: toCLP(p.flujo_neto_proyectado),
      color: "#0a84ff",
    });
  }
  if (tab === "acumulado") {
    rows.push({
      label: "Saldo acum.",
      value: toCLP(p.saldo_acumulado),
      color: "#1d1d1f",
      emphasis: true,
    });
  }

  return <ChartTooltipShell title={formatPeriodoFull(p.periodo)} rows={rows} />;
}
