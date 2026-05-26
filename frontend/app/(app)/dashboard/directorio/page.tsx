"use client";

/**
 * /dashboard/directorio — Round 152
 *
 * Dashboard Institucional CEHTA Capital — Vista Directorio / GG.
 * Diseño nivel Blackstone/KKR/Juniper Square + estándar ILPA v2.0.
 *
 * Tabs:
 *   - Overview (este componente)
 *   - Companies (drill-down portfolio)
 *   - Capital (NAV bridge, capital calls)
 *   - Compliance (OPIM + CMF + CORFO)
 *   - Impact (IRIS+ + SDG + B-Corp)
 *
 * Charts implementados en MVP (Fase 1-2 del prompt):
 *   - G01: KPI Row (8 tiles fund-level)
 *   - G02: J-Curve (cumulative net cashflow)
 *   - G09: Portfolio Table con MOIC + FV
 *   - G16: Impact KPI Cards agregadas
 */
import { useMemo } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

// ============================================================
// Types
// ============================================================
interface FundMetrics {
  fund_codigo: string;
  fund_nombre: string;
  commitments_total_usd: string;
  called_total_usd: string;
  called_pct: string;
  distributed_total_usd: string;
  current_nav_usd: string;
  unfunded_commitments_usd: string;
  tvpi: string | null;
  dpi: string | null;
  rvpi: string | null;
  net_irr: string | null;
  moic: string | null;
}

interface JCurvePoint {
  quarter: string;
  quarter_net: string;
  cumulative_net: string;
}

interface PortfolioCompany {
  empresa_codigo: string;
  ticker: string;
  razon_social: string | null;
  sector: string | null;
  stage: string | null;
  invested_amount_usd: string;
  fair_value_usd: string;
  moic_net: string | null;
  irr_net: string | null;
  b_corp_score: string | null;
}

interface PortfolioResponse {
  total_portfolio_companies: number;
  total_invested_usd: string;
  total_fair_value_usd: string;
  weighted_moic: string | null;
  companies: PortfolioCompany[];
}

interface ImpactCard {
  iris_metric_id: string;
  metric_name: string;
  aggregate_value: string;
  unit: string;
  framework: string;
  companies_count: number;
  verified_count: number;
}

interface ImpactResponse {
  period: string;
  cards: ImpactCard[];
}

// ============================================================
// Helpers de formato
// ============================================================
const fmtUSD = (v: string | number | null | undefined, opts?: { compact?: boolean }) => {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (opts?.compact && Math.abs(n) >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(1)}M`;
  }
  if (opts?.compact && Math.abs(n) >= 1_000) {
    return `$${(n / 1_000).toFixed(0)}k`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
};

const fmtMultiple = (v: string | null | undefined) => {
  if (!v) return "—";
  return `${parseFloat(v).toFixed(2)}x`;
};

const fmtPct = (v: string | null | undefined) => {
  if (!v) return "—";
  return `${parseFloat(v).toFixed(1)}%`;
};

const fmtIRR = (v: string | null | undefined) => {
  if (!v) return "—";
  const n = parseFloat(v) * 100;
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
};

// ============================================================
// Componente principal
// ============================================================
export default function DirectorioPage() {
  const { session } = useSession();

  // Queries
  const { data: metrics } = useQuery<FundMetrics>({
    queryKey: ["dashboard", "fund-metrics"],
    queryFn: () => apiClient.get<FundMetrics>("/dashboard/fund/metrics", session),
    enabled: !!session,
    staleTime: 60_000,
  });

  const { data: jcurve } = useQuery<{ fund_codigo: string; points: JCurvePoint[] }>({
    queryKey: ["dashboard", "jcurve"],
    queryFn: () =>
      apiClient.get<{ fund_codigo: string; points: JCurvePoint[] }>(
        "/dashboard/fund/jcurve",
        session,
      ),
    enabled: !!session,
    staleTime: 60_000,
  });

  const { data: portfolio } = useQuery<PortfolioResponse>({
    queryKey: ["dashboard", "portfolio"],
    queryFn: () =>
      apiClient.get<PortfolioResponse>("/dashboard/portfolio", session),
    enabled: !!session,
    staleTime: 60_000,
  });

  const { data: impact } = useQuery<ImpactResponse>({
    queryKey: ["dashboard", "impact"],
    queryFn: () => apiClient.get<ImpactResponse>("/dashboard/impact", session),
    enabled: !!session,
    staleTime: 60_000,
  });

  // J-Curve data prep para Recharts
  const jcurveData = useMemo(() => {
    return (jcurve?.points ?? []).map((p) => ({
      quarter: new Date(p.quarter).toLocaleDateString("en-US", {
        year: "2-digit",
        month: "short",
      }),
      cumulative: parseFloat(p.cumulative_net),
      quarter_net: parseFloat(p.quarter_net),
    }));
  }, [jcurve]);

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8 space-y-8">
      {/* ============ HEADER ============ */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cehta-green">
            <Sparkles className="size-3.5" />
            Dashboard Institucional
          </div>
          <h1 className="mt-2 font-display text-3xl md:text-4xl font-semibold tracking-tight text-ink-900">
            {metrics?.fund_nombre ?? "FIP CEHTA ESG"}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Vista Directorio · {new Date().toLocaleDateString("es-CL", { year: "numeric", month: "long" })}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-500">
          <Link
            href={"/dashboard/inversionistas" as Route}
            className="rounded-lg border border-hairline bg-white px-3 py-1.5 font-medium hover:bg-ink-50"
          >
            → Vista Inversionistas
          </Link>
        </div>
      </div>

      {/* ============ G01: KPI ROW ============ */}
      <section>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" style={{ fontVariantNumeric: "tabular-nums" }}>
          <KpiTile
            label="AUM"
            value={fmtUSD(metrics?.current_nav_usd, { compact: true })}
            sublabel="Net Asset Value"
            accent="green"
          />
          <KpiTile
            label="Commitments"
            value={fmtUSD(metrics?.commitments_total_usd, { compact: true })}
            sublabel="Total committed"
          />
          <KpiTile
            label="Called"
            value={fmtPct(metrics?.called_pct)}
            sublabel={fmtUSD(metrics?.called_total_usd, { compact: true })}
            delta={metrics?.called_pct ? parseFloat(metrics.called_pct) : null}
            deltaSuffix="%"
            accent="blue"
          />
          <KpiTile
            label="Distributed"
            value={fmtUSD(metrics?.distributed_total_usd, { compact: true })}
            sublabel="To LPs"
          />
          <KpiTile
            label="TVPI"
            value={fmtMultiple(metrics?.tvpi)}
            sublabel="Total Value / Paid-In"
            accent="green"
          />
          <KpiTile
            label="DPI"
            value={fmtMultiple(metrics?.dpi)}
            sublabel="Distributions / Paid-In"
          />
          <KpiTile
            label="RVPI"
            value={fmtMultiple(metrics?.rvpi)}
            sublabel="NAV / Paid-In"
          />
          <KpiTile
            label="Unfunded"
            value={fmtUSD(metrics?.unfunded_commitments_usd, { compact: true })}
            sublabel="Capital available"
            accent="amber"
          />
        </div>
        <p className="mt-3 text-[10px] text-ink-400 italic">
          Source: ILPA Reporting Template v2.0 · valores calculados sobre cashflows fund-level
        </p>
      </section>

      {/* ============ G02: J-CURVE ============ */}
      <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">J-Curve · Net Cashflow Acumulado</h2>
            <p className="text-xs text-ink-500 mt-0.5">
              Capital calls (negativo) + Distribuciones (positivo). Trimestral desde inception.
            </p>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">G02 · ILPA v2.0</div>
        </div>
        <div className="h-[280px]">
          {jcurveData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={jcurveData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="jcurveColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0E7C66" stopOpacity={0.3} />
                    <stop offset="50%" stopColor="#0E7C66" stopOpacity={0.08} />
                    <stop offset="100%" stopColor="#C2410C" stopOpacity={0.15} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" />
                <XAxis
                  dataKey="quarter"
                  stroke="#71717A"
                  tick={{ fontSize: 11 }}
                  tickMargin={8}
                />
                <YAxis
                  stroke="#71717A"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => fmtUSD(v, { compact: true })}
                  width={64}
                />
                <Tooltip
                  formatter={(v: number) => fmtUSD(v)}
                  labelStyle={{ color: "#18181B", fontWeight: 600 }}
                  contentStyle={{
                    background: "#FFFFFF",
                    border: "1px solid #E4E4E7",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <ReferenceLine y={0} stroke="#71717A" strokeDasharray="2 2" />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  name="Cumulative Net"
                  stroke="#0E7C66"
                  strokeWidth={2}
                  fill="url(#jcurveColor)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink-400">
              Cargando J-Curve...
            </div>
          )}
        </div>
      </section>

      {/* ============ G09: PORTFOLIO TABLE ============ */}
      <section className="rounded-2xl border border-hairline bg-white shadow-card overflow-hidden">
        <div className="px-6 py-4 border-b border-hairline flex items-end justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Portfolio Companies</h2>
            <p className="text-xs text-ink-500 mt-0.5">
              {portfolio?.total_portfolio_companies ?? 0} compañías ·
              FV total {fmtUSD(portfolio?.total_fair_value_usd, { compact: true })} ·
              MOIC ponderado {fmtMultiple(portfolio?.weighted_moic ?? null)}
            </p>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">G09 · Treemap source</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead className="bg-ink-50/50">
              <tr className="text-[10px] uppercase tracking-wider text-ink-500">
                <th className="px-4 py-3 text-left font-semibold">Ticker</th>
                <th className="px-4 py-3 text-left font-semibold">Sector</th>
                <th className="px-4 py-3 text-left font-semibold">Stage</th>
                <th className="px-4 py-3 text-right font-semibold">Invested</th>
                <th className="px-4 py-3 text-right font-semibold">Fair Value</th>
                <th className="px-4 py-3 text-right font-semibold">MOIC</th>
                <th className="px-4 py-3 text-right font-semibold">IRR</th>
                <th className="px-4 py-3 text-center font-semibold">B-Corp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {portfolio?.companies?.map((c) => (
                <tr key={c.empresa_codigo} className="hover:bg-ink-50/40">
                  <td className="px-4 py-2.5">
                    <div className="font-mono font-semibold text-ink-900">{c.ticker}</div>
                    <div className="text-[11px] text-ink-500 truncate max-w-[140px]">{c.razon_social}</div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-700">{c.sector}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-ink-100 text-ink-700 uppercase">
                      {c.stage}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmtUSD(c.invested_amount_usd, { compact: true })}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmtUSD(c.fair_value_usd, { compact: true })}</td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    <MoicBadge moic={c.moic_net} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmtIRR(c.irr_net)}</td>
                  <td className="px-4 py-2.5 text-center">
                    {c.b_corp_score ? (
                      <span className="inline-block rounded-full bg-cehta-green/10 px-2 py-0.5 text-[10px] font-semibold text-cehta-green">
                        {c.b_corp_score}
                      </span>
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {(!portfolio || portfolio.companies.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-ink-400">
                    Cargando portfolio...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============ G16: IMPACT KPI CARDS ============ */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Impact Metrics</h2>
            <p className="text-xs text-ink-500 mt-0.5">
              IRIS+ v5.3 agregado · período {impact?.period ?? "2025-12-31"}
            </p>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">G16 · IRIS+ v5.3</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" style={{ fontVariantNumeric: "tabular-nums" }}>
          {impact?.cards?.map((card) => (
            <div
              key={card.iris_metric_id}
              className="rounded-xl border border-hairline bg-white p-4 shadow-card-sm"
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider text-cehta-green font-bold">
                  {card.iris_metric_id}
                </span>
                {card.verified_count > 0 && (
                  <CheckCircle2 className="size-3.5 text-cehta-green" />
                )}
              </div>
              <div className="text-2xl font-bold text-ink-900 tabular-nums">
                {parseFloat(card.aggregate_value).toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </div>
              <div className="text-[11px] text-ink-500 font-medium uppercase tracking-wider mt-0.5">
                {card.unit}
              </div>
              <div className="text-xs text-ink-700 mt-2 leading-tight">{card.metric_name}</div>
              <div className="text-[10px] text-ink-400 mt-2 flex items-center justify-between">
                <span>{card.companies_count} cías · {card.verified_count} verif.</span>
                <span className="text-cehta-green font-medium">{card.framework}</span>
              </div>
            </div>
          ))}
          {(!impact || impact.cards.length === 0) && (
            <div className="col-span-full text-center text-sm text-ink-400 py-8">
              Cargando impact metrics...
            </div>
          )}
        </div>
      </section>

      {/* ============ FOOTER ATTRIBUTION ============ */}
      <div className="text-center text-[11px] text-ink-400 italic pt-6 border-t border-hairline">
        ILPA Reporting Template v2.0 · IRIS+ v5.3 · OPIM Annual Disclosure
        · Datos demo — reemplazar con figures reales antes de presentar a LPs
      </div>
    </div>
  );
}

// ============================================================
// Sub-componentes
// ============================================================
function KpiTile({
  label,
  value,
  sublabel,
  delta,
  deltaSuffix = "",
  accent,
}: {
  label: string;
  value: string;
  sublabel?: string;
  delta?: number | null;
  deltaSuffix?: string;
  accent?: "green" | "blue" | "amber" | "red";
}) {
  const accentClass =
    accent === "green"
      ? "border-cehta-green/30 bg-cehta-green/5"
      : accent === "blue"
        ? "border-blue-200 bg-blue-50/40"
        : accent === "amber"
          ? "border-amber-200 bg-amber-50/40"
          : accent === "red"
            ? "border-red-200 bg-red-50/40"
            : "border-hairline bg-white";

  return (
    <div className={`rounded-xl border p-4 shadow-card-sm ${accentClass}`}>
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1">
        {label}
      </div>
      <div className="text-2xl font-bold text-ink-900 tabular-nums">{value}</div>
      {(sublabel || delta !== undefined) && (
        <div className="mt-1 flex items-center justify-between text-[11px]">
          {sublabel && <span className="text-ink-500">{sublabel}</span>}
          {delta !== null && delta !== undefined && (
            <span
              className={`inline-flex items-center gap-0.5 font-semibold ${
                delta >= 0 ? "text-cehta-green" : "text-negative"
              }`}
            >
              {delta >= 0 ? (
                <ArrowUpRight className="size-3" />
              ) : (
                <ArrowDownRight className="size-3" />
              )}
              {Math.abs(delta).toFixed(1)}
              {deltaSuffix}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function MoicBadge({ moic }: { moic: string | null }) {
  if (!moic) return <span className="text-ink-300">—</span>;
  const n = parseFloat(moic);
  const cls =
    n >= 1.5
      ? "bg-cehta-green/10 text-cehta-green"
      : n >= 1.0
        ? "bg-blue-50 text-blue-700"
        : n >= 0.9
          ? "bg-amber-50 text-amber-700"
          : "bg-red-50 text-red-700";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold tabular-nums ${cls}`}>
      {n.toFixed(2)}x
    </span>
  );
}
