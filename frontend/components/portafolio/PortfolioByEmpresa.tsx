"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Building2 } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { APPLE_PALETTE } from "@/lib/dashboard/chart-palette";
import { formatM } from "@/lib/dashboard/format-chart";
import { toCLP, toPct } from "@/lib/format";
import type { EmpresaPortfolioRow } from "@/lib/api/schema";

interface Props {
  empresas: EmpresaPortfolioRow[];
  hasUsdRate: boolean;
}

export function PortfolioByEmpresa({ empresas, hasUsdRate }: Props) {
  // Ordenar descendente por saldo CLP (que equivale a USD si todas son CLP).
  const sorted = [...empresas].sort(
    (a, b) => Number(b.saldo_clp) - Number(a.saldo_clp),
  );

  if (sorted.length === 0) {
    return (
      <Surface aria-label="Portfolio por empresa — sin datos">
        <Surface.Header>
          <Surface.Title>Por empresa</Surface.Title>
          <Surface.Subtitle>Sin saldos disponibles</Surface.Subtitle>
        </Surface.Header>
        <Surface.Body className="flex h-[280px] flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/40">
            <Building2 className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-ink-500">Sin empresas activas.</p>
        </Surface.Body>
      </Surface>
    );
  }

  const data = sorted.map((e) => ({
    name: e.empresa_codigo,
    saldo_usd: e.saldo_usd != null ? Number(e.saldo_usd) : 0,
    saldo_clp: Number(e.saldo_clp),
    razon_social: e.razon_social,
    pct: Number(e.percent_of_portfolio),
  }));

  const dataKey = hasUsdRate ? "saldo_usd" : "saldo_clp";

  return (
    <Surface aria-label="Portfolio por empresa">
      <Surface.Header>
        <Surface.Title>Por empresa</Surface.Title>
        <Surface.Subtitle>
          {hasUsdRate
            ? `Saldo equivalente USD · ${sorted.length} empresas`
            : `Saldo CLP · ${sorted.length} empresas (USD no disponible)`}
        </Surface.Subtitle>
      </Surface.Header>
      <Surface.Body className="mt-4 h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e5e7eb"
              vertical={false}
            />
            <XAxis
              dataKey="name"
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
                hasUsdRate
                  ? `$${(v / 1000).toFixed(0)}K`
                  : formatM(v)
              }
            />
            <Tooltip
              content={<EmpresaTooltip hasUsdRate={hasUsdRate} />}
              cursor={{ fill: "#f5f5f7", opacity: 0.5 }}
            />
            <Bar
              dataKey={dataKey}
              fill={APPLE_PALETTE[0]}
              radius={[6, 6, 0, 0]}
              isAnimationActive
              animationDuration={400}
            />
          </BarChart>
        </ResponsiveContainer>
      </Surface.Body>
    </Surface>
  );
}

interface EmpresaTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: {
      name: string;
      saldo_usd: number;
      saldo_clp: number;
      razon_social: string;
      pct: number;
    };
  }>;
  hasUsdRate: boolean;
}

function EmpresaTooltip({ active, payload, hasUsdRate }: EmpresaTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-lg bg-ink-900/95 px-3 py-2 text-white shadow-lg backdrop-blur-sm min-w-[180px]">
      <p className="text-xs font-semibold">{p.name}</p>
      <p className="text-[10px] text-white/60 truncate">{p.razon_social}</p>
      <div className="mt-1.5 flex flex-col gap-0.5">
        <div className="flex justify-between gap-3 text-xs">
          <span className="text-white/70">CLP</span>
          <span className="tabular-nums">{toCLP(p.saldo_clp)}</span>
        </div>
        {hasUsdRate && (
          <div className="flex justify-between gap-3 text-xs">
            <span className="text-white/70">USD</span>
            <span className="tabular-nums">
              {new Intl.NumberFormat("es-CL", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              }).format(p.saldo_usd)}
            </span>
          </div>
        )}
        <div className="flex justify-between gap-3 text-xs mt-0.5">
          <span className="text-white/70">% portafolio</span>
          <span className="tabular-nums">{toPct(p.pct, { digits: 1 })}</span>
        </div>
      </div>
    </div>
  );
}
