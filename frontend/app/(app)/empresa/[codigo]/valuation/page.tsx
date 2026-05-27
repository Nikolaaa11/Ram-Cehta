"use client";

/**
 * /empresa/[codigo]/valuation — Round 152d
 *
 * Vista de Valuación por empresa portfolio:
 *   - Timeline de invested vs fair_value (AreaChart)
 *   - MOIC + IRR + Gross/Net por trimestre (tabla)
 *   - KPI tiles: invested total, current FV, MOIC, IRR
 */
import { use, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface ValuationRow {
  as_of_date: string;
  invested_amount_usd: string | number;
  realized_value_usd: string | number;
  unrealized_fv_usd: string | number;
  moic_net: string | number | null;
  irr_net: string | number | null;
}

const fmtUsd = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

const numeric: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

export default function ValuationPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = use(params);
  const { session } = useSession();

  const { data, isLoading, error } = useQuery<{ rows: ValuationRow[] }>({
    queryKey: ["empresa", codigo, "valuation"],
    queryFn: () =>
      apiClient.get<{ rows: ValuationRow[] }>(
        `/empresa/${encodeURIComponent(codigo)}/valuation`,
        session,
      ),
    enabled: !!session,
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        date: r.as_of_date.slice(0, 7),
        invested: Number(r.invested_amount_usd ?? 0),
        fv: Number(r.unrealized_fv_usd ?? 0),
        moic: r.moic_net != null ? Number(r.moic_net) : null,
      })),
    [rows],
  );

  const latest = rows.at(-1);

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/50 p-6 text-sm text-red-900">
        <p className="font-semibold">No se pudo cargar la valuación</p>
        <p className="mt-1 text-xs text-red-700">
          {error instanceof Error ? error.message : "Error desconocido"}
        </p>
        <p className="mt-2 text-xs text-red-700">
          Si esta empresa no es portfolio company, no tiene valuación trackeada.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Invested (acum)"
          value={
            latest
              ? fmtUsd(Number(latest.invested_amount_usd ?? 0))
              : "—"
          }
          loading={isLoading}
        />
        <KpiTile
          label="Fair Value"
          value={
            latest ? fmtUsd(Number(latest.unrealized_fv_usd ?? 0)) : "—"
          }
          loading={isLoading}
        />
        <KpiTile
          label="MOIC"
          value={
            latest?.moic_net != null
              ? `${Number(latest.moic_net).toFixed(2)}x`
              : "—"
          }
          loading={isLoading}
        />
        <KpiTile
          label="IRR"
          value={
            latest?.irr_net != null
              ? `${(Number(latest.irr_net) * 100).toFixed(1)}%`
              : "—"
          }
          loading={isLoading}
        />
      </div>

      {/* Chart timeline */}
      <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
        <header className="mb-4">
          <h3 className="text-base font-semibold text-ink-900">
            Invested vs Fair Value · timeline
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            USD. Datos por valuación trimestral.
          </p>
        </header>
        {chartData.length === 0 ? (
          <p className="py-12 text-center text-sm text-ink-400">
            Sin valuaciones registradas.
          </p>
        ) : (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <AreaChart data={chartData}>
                <CartesianGrid stroke="#F0F0F0" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={fmtUsd} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number) => fmtUsd(v)}
                  labelStyle={{ fontSize: 12 }}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="invested"
                  stroke="#9CA3AF"
                  fill="#E5E7EB"
                  fillOpacity={0.6}
                  name="Invested"
                />
                <Area
                  type="monotone"
                  dataKey="fv"
                  stroke="#1D6F42"
                  fill="#1D6F42"
                  fillOpacity={0.3}
                  name="Fair Value"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Tabla histórica */}
      <section className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
        <header className="border-b border-hairline px-6 py-4">
          <h3 className="text-base font-semibold text-ink-900">
            Historial de valuaciones
          </h3>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={numeric}>
            <thead className="bg-ink-50/50">
              <tr className="text-[10px] uppercase tracking-wider text-ink-500">
                <th className="px-4 py-3 text-left font-semibold">Fecha</th>
                <th className="px-4 py-3 text-right font-semibold">Invested</th>
                <th className="px-4 py-3 text-right font-semibold">Realized</th>
                <th className="px-4 py-3 text-right font-semibold">Fair Value</th>
                <th className="px-4 py-3 text-right font-semibold">MOIC</th>
                <th className="px-4 py-3 text-right font-semibold">IRR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-ink-400">
                    Sin valuaciones.
                  </td>
                </tr>
              ) : (
                [...rows].reverse().map((r, i) => (
                  <tr key={i} className="hover:bg-ink-50/40">
                    <td className="px-4 py-2.5">{r.as_of_date}</td>
                    <td className="px-4 py-2.5 text-right">
                      {fmtUsd(Number(r.invested_amount_usd ?? 0))}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {fmtUsd(Number(r.realized_value_usd ?? 0))}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {fmtUsd(Number(r.unrealized_fv_usd ?? 0))}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.moic_net != null
                        ? `${Number(r.moic_net).toFixed(2)}x`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.irr_net != null
                        ? `${(Number(r.irr_net) * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function KpiTile({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-4 shadow-card">
      <p className="text-[10px] uppercase tracking-wider text-ink-400">{label}</p>
      <p
        className="mt-1 text-2xl font-semibold text-ink-900"
        style={numeric}
      >
        {loading ? "…" : value}
      </p>
    </div>
  );
}
