"use client";

/**
 * /empresa/[codigo]/kpis — Round 152d
 *
 * Vista de KPIs Operativos (company_operational_kpis):
 *   - Cards con último valor + delta vs mes anterior
 *   - Sparklines últimos 6 meses
 */
import { use, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Line,
  LineChart,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface KpiPoint {
  period: string;
  metric_name: string;
  metric_value: string | number;
  unit: string | null;
}

const numeric: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

export default function KpisPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = use(params);
  const { session } = useSession();

  const { data, isLoading, error } = useQuery<{ rows: KpiPoint[] }>({
    queryKey: ["empresa", codigo, "kpis"],
    queryFn: () =>
      apiClient.get<{ rows: KpiPoint[] }>(
        `/empresa/${encodeURIComponent(codigo)}/kpis`,
        session,
      ),
    enabled: !!session,
  });

  // Agrupar por metric_name y ordenar por period asc
  const grouped = useMemo(() => {
    const rows = data?.rows ?? [];
    const map = new Map<string, KpiPoint[]>();
    for (const r of rows) {
      const arr = map.get(r.metric_name) ?? [];
      arr.push(r);
      map.set(r.metric_name, arr);
    }
    return Array.from(map.entries()).map(([name, points]) => {
      const sorted = [...points].sort((a, b) =>
        a.period.localeCompare(b.period),
      );
      const last = sorted.at(-1);
      const prev = sorted.at(-2);
      const lastVal = last ? Number(last.metric_value) : 0;
      const prevVal = prev ? Number(prev.metric_value) : 0;
      const delta = prev ? lastVal - prevVal : null;
      const deltaPct =
        prev && prevVal !== 0 ? ((lastVal - prevVal) / Math.abs(prevVal)) * 100 : null;
      return {
        name,
        unit: last?.unit ?? "",
        lastVal,
        delta,
        deltaPct,
        series: sorted.map((p) => ({
          period: p.period,
          value: Number(p.metric_value),
        })),
      };
    });
  }, [data]);

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/50 p-6 text-sm text-red-900">
        <p className="font-semibold">No se pudieron cargar los KPIs</p>
        <p className="mt-1 text-xs text-red-700">
          {error instanceof Error ? error.message : "Error desconocido"}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <p className="py-12 text-center text-sm text-ink-400">Cargando KPIs…</p>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="rounded-2xl border border-hairline bg-white p-12 text-center shadow-card">
        <p className="text-sm font-medium text-ink-700">Sin KPIs operativos</p>
        <p className="mt-1 text-xs text-ink-500">
          Esta empresa aún no reporta indicadores operativos mensuales. Si es
          portfolio company y necesita trackearlos, carga datos en{" "}
          <code>core.company_operational_kpis</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {grouped.map((k) => {
        const isUp = k.delta != null && k.delta > 0;
        const isDown = k.delta != null && k.delta < 0;
        const Trend = isUp ? TrendingUp : isDown ? TrendingDown : Minus;
        const trendColor = isUp
          ? "text-emerald-600"
          : isDown
            ? "text-red-500"
            : "text-ink-400";

        return (
          <div
            key={k.name}
            className="rounded-2xl border border-hairline bg-white p-5 shadow-card"
          >
            <p className="text-[11px] uppercase tracking-wider text-ink-500">
              {k.name}
            </p>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-2xl font-semibold text-ink-900" style={numeric}>
                {k.lastVal.toLocaleString("es-CL", {
                  maximumFractionDigits: 1,
                })}
              </p>
              {k.unit && (
                <span className="text-xs text-ink-500">{k.unit}</span>
              )}
            </div>
            {k.delta != null && (
              <div className={`mt-1 flex items-center gap-1 text-xs ${trendColor}`}>
                <Trend className="size-3.5" />
                <span style={numeric}>
                  {k.delta > 0 ? "+" : ""}
                  {k.delta.toLocaleString("es-CL", { maximumFractionDigits: 1 })}
                  {k.deltaPct != null && (
                    <span className="ml-1 text-ink-400">
                      ({k.deltaPct > 0 ? "+" : ""}
                      {k.deltaPct.toFixed(1)}%)
                    </span>
                  )}
                </span>
                <span className="text-ink-400">vs mes anterior</span>
              </div>
            )}
            {/* Sparkline */}
            <div className="mt-3" style={{ width: "100%", height: 40 }}>
              <ResponsiveContainer>
                <LineChart data={k.series}>
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#1D6F42"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
