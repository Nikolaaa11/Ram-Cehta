"use client";

/**
 * /dashboard/directorio/capital — Round 152
 *
 * Capital Deployment tab:
 *   - G05 NAV Waterfall (NAV bridge desde inception)
 *   - G06 Capital Stack (called vs unfunded)
 *   - G07 Capital Calls Timeline
 *   - Tabla de LPs con commitment + paid-in + ownership
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface LpRow {
  lp_id: string;
  legal_name: string;
  lp_type: string;
  commitment_usd: string;
  paid_in_usd: string;
  distributed_usd: string;
  ownership_pct: string | null;
}

interface JCurvePoint {
  quarter: string;
  quarter_net: string;
  cumulative_net: string;
}

interface FundMetrics {
  commitments_total_usd: string;
  called_total_usd: string;
  distributed_total_usd: string;
  current_nav_usd: string;
  unfunded_commitments_usd: string;
}

const fmtUSD = (v: string | number | null | undefined, opts?: { compact?: boolean }) => {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (opts?.compact && Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (opts?.compact && Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
};

const fmtPct = (v: string | number | null | undefined) => {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  return `${n.toFixed(1)}%`;
};

export default function CapitalPage() {
  const { session } = useSession();

  const { data: lps } = useQuery<LpRow[]>({
    queryKey: ["dashboard", "lps"],
    queryFn: () => apiClient.get<LpRow[]>("/dashboard/lps", session),
    enabled: !!session,
    staleTime: 60_000,
  });

  const { data: metrics } = useQuery<FundMetrics>({
    queryKey: ["dashboard", "fund-metrics"],
    queryFn: () => apiClient.get<FundMetrics>("/dashboard/fund/metrics", session),
    enabled: !!session,
    staleTime: 60_000,
  });

  const { data: jcurve } = useQuery<{ points: JCurvePoint[] }>({
    queryKey: ["dashboard", "jcurve"],
    queryFn: () =>
      apiClient.get<{ fund_codigo: string; points: JCurvePoint[] }>(
        "/dashboard/fund/jcurve",
        session,
      ),
    enabled: !!session,
    staleTime: 60_000,
  });

  // G06 Capital Stack — segmentos del compromiso total
  const capitalStack = useMemo(() => {
    if (!metrics) return [];
    const called = parseFloat(metrics.called_total_usd);
    const distributed = parseFloat(metrics.distributed_total_usd);
    const unfunded = parseFloat(metrics.unfunded_commitments_usd);
    return [
      {
        category: "Capital Stack",
        "Called & Invested": called - distributed,
        Distributed: distributed,
        Unfunded: unfunded,
      },
    ];
  }, [metrics]);

  // G07 Capital Calls Timeline — calls trimestrales (de jcurve quarter_net negativos)
  const capitalCallsTimeline = useMemo(() => {
    let cumPct = 0;
    const totalCommit = metrics ? parseFloat(metrics.commitments_total_usd) : 22_500_000;
    return (jcurve?.points ?? []).map((p) => {
      const callAmount = Math.abs(Math.min(0, parseFloat(p.quarter_net)));
      cumPct += (callAmount / totalCommit) * 100;
      return {
        quarter: new Date(p.quarter).toLocaleDateString("en-US", {
          year: "2-digit",
          month: "short",
        }),
        call: callAmount,
        called_pct: Math.min(100, cumPct),
      };
    });
  }, [jcurve, metrics]);

  // G05 NAV Bridge / Waterfall
  const navWaterfall = useMemo(() => {
    if (!metrics) return [];
    const called = parseFloat(metrics.called_total_usd);
    const distributed = parseFloat(metrics.distributed_total_usd);
    const nav = parseFloat(metrics.current_nav_usd);
    // Unrealized markup = NAV - (called - distributed)
    const unrealized = nav - (called - distributed);
    return [
      { name: "Capital Called", value: called, type: "positive" },
      { name: "Realized", value: distributed, type: "positive" },
      { name: "Unrealized Markup", value: unrealized, type: "positive" },
      { name: "Distributions", value: -distributed, type: "negative" },
      { name: "Current NAV", value: nav, type: "total" },
    ];
  }, [metrics]);

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8 space-y-8">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink-900">
          Capital & Cash Deployment
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Capital calls, distributions, NAV bridge, ownership por LP.
        </p>
      </div>

      {/* G05: NAV Waterfall */}
      <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">NAV Bridge / Waterfall</h2>
            <p className="text-xs text-ink-500 mt-0.5">
              Movimientos desde capital deployed hasta NAV actual.
            </p>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">G05 · ILPA v2.0</div>
        </div>
        <div className="h-[260px]" style={{ fontVariantNumeric: "tabular-nums" }}>
          {navWaterfall.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={navWaterfall} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" />
                <XAxis dataKey="name" stroke="#71717A" tick={{ fontSize: 11 }} />
                <YAxis
                  stroke="#71717A"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => fmtUSD(v, { compact: true })}
                  width={64}
                />
                <Tooltip
                  formatter={(v: number) => fmtUSD(v)}
                  contentStyle={{
                    background: "#FFFFFF",
                    border: "1px solid #E4E4E7",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {navWaterfall.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={
                        entry.type === "total"
                          ? "#1D4ED8"
                          : entry.type === "negative"
                            ? "#C2410C"
                            : "#0E7C66"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink-400">
              Cargando...
            </div>
          )}
        </div>
      </section>

      {/* G06 Capital Stack + G07 Capital Calls Timeline lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* G06: Capital Stack horizontal */}
        <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-ink-900">Capital Stack</h2>
              <p className="text-xs text-ink-500 mt-0.5">Estructura de capital del fondo</p>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-ink-400">G06</div>
          </div>
          <div className="h-[260px]" style={{ fontVariantNumeric: "tabular-nums" }}>
            {capitalStack.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={capitalStack}
                  layout="vertical"
                  margin={{ top: 30, right: 16, left: 16, bottom: 16 }}
                  stackOffset="expand"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" horizontal={false} />
                  <XAxis
                    type="number"
                    stroke="#71717A"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  />
                  <YAxis type="category" dataKey="category" stroke="#71717A" tick={{ fontSize: 11 }} hide />
                  <Tooltip
                    formatter={(v: number) => fmtUSD(v)}
                    contentStyle={{
                      background: "#FFFFFF",
                      border: "1px solid #E4E4E7",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend
                    iconType="square"
                    iconSize={10}
                    wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
                  />
                  <Bar dataKey="Called & Invested" stackId="a" fill="#0E7C66" />
                  <Bar dataKey="Distributed" stackId="a" fill="#65A30D" />
                  <Bar dataKey="Unfunded" stackId="a" fill="#94A3B8" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ink-400">
                Cargando...
              </div>
            )}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            <Metric label="Called" value={fmtUSD(metrics?.called_total_usd, { compact: true })} color="#0E7C66" />
            <Metric label="Distributed" value={fmtUSD(metrics?.distributed_total_usd, { compact: true })} color="#65A30D" />
            <Metric label="Unfunded" value={fmtUSD(metrics?.unfunded_commitments_usd, { compact: true })} color="#94A3B8" />
          </div>
        </section>

        {/* G07: Capital Calls Timeline */}
        <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-ink-900">Capital Calls Timeline</h2>
              <p className="text-xs text-ink-500 mt-0.5">Monto por call + % acumulado called</p>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-ink-400">G07</div>
          </div>
          <div className="h-[260px]" style={{ fontVariantNumeric: "tabular-nums" }}>
            {capitalCallsTimeline.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={capitalCallsTimeline} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" />
                  <XAxis dataKey="quarter" stroke="#71717A" tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="left"
                    stroke="#71717A"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => fmtUSD(v, { compact: true })}
                    width={64}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#71717A"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${v.toFixed(0)}%`}
                    domain={[0, 100]}
                    width={42}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#FFFFFF",
                      border: "1px solid #E4E4E7",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar yAxisId="left" dataKey="call" name="Call" fill="#1D4ED8" radius={[3, 3, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="called_pct"
                    name="% Called acum."
                    stroke="#C2410C"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ink-400">
                Cargando...
              </div>
            )}
          </div>
        </section>
      </div>

      {/* TABLA LPs */}
      <section className="rounded-2xl border border-hairline bg-white shadow-card overflow-hidden">
        <div className="px-6 py-4 border-b border-hairline">
          <h2 className="text-base font-semibold text-ink-900">Limited Partners</h2>
          <p className="text-xs text-ink-500 mt-0.5">
            {lps?.length ?? 0} aportantes · CORFO + privados
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead className="bg-ink-50/50">
              <tr className="text-[10px] uppercase tracking-wider text-ink-500">
                <th className="px-4 py-3 text-left font-semibold">Aportante</th>
                <th className="px-4 py-3 text-left font-semibold">Tipo</th>
                <th className="px-4 py-3 text-right font-semibold">Commitment</th>
                <th className="px-4 py-3 text-right font-semibold">Paid-In</th>
                <th className="px-4 py-3 text-right font-semibold">Called %</th>
                <th className="px-4 py-3 text-right font-semibold">Distribuido</th>
                <th className="px-4 py-3 text-right font-semibold">Ownership</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {lps?.map((lp) => {
                const commit = parseFloat(lp.commitment_usd);
                const paid = parseFloat(lp.paid_in_usd);
                const calledPct = commit > 0 ? (paid / commit) * 100 : 0;
                return (
                  <tr key={lp.lp_id} className="hover:bg-ink-50/40">
                    <td className="px-4 py-2.5 font-medium text-ink-900">{lp.legal_name}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium uppercase ${
                          lp.lp_type === "publico_corfo"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {lp.lp_type === "publico_corfo" ? "CORFO" : "Privado"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmtUSD(commit, { compact: true })}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmtUSD(paid, { compact: true })}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-ink-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-cehta-green rounded-full"
                            style={{ width: `${Math.min(100, calledPct)}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs">{calledPct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmtUSD(lp.distributed_usd, { compact: true })}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmtPct(lp.ownership_pct)}</td>
                  </tr>
                );
              })}
              {(!lps || lps.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-ink-400">
                    Sin acceso o sin LPs configurados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <div>
        <div className="text-ink-500">{label}</div>
        <div className="font-mono font-semibold text-ink-900">{value}</div>
      </div>
    </div>
  );
}
