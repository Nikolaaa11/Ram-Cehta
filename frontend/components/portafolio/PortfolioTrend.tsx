"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { APPLE_PALETTE } from "@/lib/dashboard/chart-palette";
import { formatPeriodo, formatM } from "@/lib/dashboard/format-chart";
import { toCLP } from "@/lib/format";
import type { PortfolioMonthlyPoint } from "@/lib/api/schema";

interface Props {
  trend: PortfolioMonthlyPoint[];
  hasUsdRate: boolean;
}

export function PortfolioTrend({ trend, hasUsdRate }: Props) {
  if (trend.length === 0) {
    return (
      <Surface aria-label="Trend 12 meses — sin datos">
        <Surface.Header>
          <Surface.Title>Trend 12 meses</Surface.Title>
          <Surface.Subtitle>Sin datos históricos</Surface.Subtitle>
        </Surface.Header>
        <Surface.Body className="flex h-[280px] flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/40">
            <TrendingUp className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-ink-500">Cargá movimientos para ver el trend.</p>
        </Surface.Body>
      </Surface>
    );
  }

  const data = trend.map((p) => ({
    periodo: p.periodo,
    label: formatPeriodo(p.periodo),
    total_clp: Number(p.total_clp),
    total_usd: p.total_usd != null ? Number(p.total_usd) : null,
  }));

  const useUsd = hasUsdRate && data.some((d) => d.total_usd != null);
  const dataKey = useUsd ? "total_usd" : "total_clp";

  return (
    <Surface aria-label="Trend del portafolio últimos 12 meses">
      <Surface.Header>
        <Surface.Title>Trend 12 meses</Surface.Title>
        <Surface.Subtitle>
          {useUsd
            ? "Saldo total en USD al cierre de cada mes"
            : "Saldo total en CLP al cierre de cada mes"}
        </Surface.Subtitle>
      </Surface.Header>
      <Surface.Body className="mt-4 h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e5e7eb"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              fontSize={11}
              stroke="#86868b"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              fontSize={11}
              stroke="#86868b"
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) =>
                useUsd
                  ? `$${(v / 1000).toFixed(0)}K`
                  : formatM(v)
              }
            />
            <Tooltip
              content={<TrendTooltip useUsd={useUsd} />}
              cursor={{ stroke: "#86868b", strokeDasharray: "3 3" }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={APPLE_PALETTE[0]}
              strokeWidth={2.5}
              dot={{ r: 3, fill: APPLE_PALETTE[0] }}
              activeDot={{ r: 5 }}
              isAnimationActive
              animationDuration={500}
            />
          </LineChart>
        </ResponsiveContainer>
      </Surface.Body>
    </Surface>
  );
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      label: string;
      total_clp: number;
      total_usd: number | null;
    };
  }>;
  useUsd: boolean;
}

function TrendTooltip({ active, payload, useUsd }: TrendTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-lg bg-ink-900/95 px-3 py-2 text-white shadow-lg backdrop-blur-sm min-w-[160px]">
      <p className="text-xs font-medium">{p.label}</p>
      <div className="mt-1 flex flex-col gap-0.5">
        <div className="flex justify-between gap-3 text-xs">
          <span className="text-white/70">CLP</span>
          <span className="tabular-nums">{toCLP(p.total_clp)}</span>
        </div>
        {useUsd && p.total_usd != null && (
          <div className="flex justify-between gap-3 text-xs">
            <span className="text-white/70">USD</span>
            <span className="tabular-nums">
              {new Intl.NumberFormat("es-CL", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              }).format(p.total_usd)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
