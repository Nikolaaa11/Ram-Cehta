"use client";

/**
 * Companies (G09 + drill-down) — Tab "Companies" del Dashboard Director.
 * Round 152 — Tabla institucional con benchmark de MOIC y tear-sheet detail.
 *
 * G09: Portfolio Treemap (rendered as ranked table aqui)
 * G10: Marimekko Sector × Stage (simplificado a bar chart agrupado)
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { Briefcase, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";

interface PortfolioCompany {
  empresa_codigo: string;
  ticker: string;
  razon_social: string | null;
  sector: string | null;
  stage: string | null;
  invested_amount_usd: string | null;
  fair_value_usd: string | null;
  moic_net: string | null;
  irr_net: string | null;
  is_public_disclosure: boolean;
  b_corp_score: string | null;
}

interface PortfolioResponse {
  total_portfolio_companies: number;
  total_invested_usd: string;
  total_fair_value_usd: string;
  weighted_moic: string | null;
  companies: PortfolioCompany[];
}

const fmtMoney = (v: string | null | undefined) => {
  if (!v) return "—";
  const n = parseFloat(v);
  if (!isFinite(n) || n === 0) return "—";
  if (Math.abs(n) >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(n) >= 1_000) {
    return `$${(n / 1_000).toFixed(1)}K`;
  }
  return `$${n.toFixed(0)}`;
};

const fmtPct = (v: string | null | undefined) => {
  if (!v) return "—";
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
};

const fmtMultiple = (v: string | null | undefined) => {
  if (!v) return "—";
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  return `${n.toFixed(2)}x`;
};

function MoicBadge({ moic }: { moic: string | null }) {
  if (!moic) return <span className="text-ink-400">—</span>;
  const n = parseFloat(moic);
  let bg = "bg-ink-100 text-ink-700";
  let Icon = TrendingUp;
  if (n >= 2.0) bg = "bg-emerald-100 text-emerald-700";
  else if (n >= 1.5) bg = "bg-cehta-green/15 text-cehta-green";
  else if (n >= 1.0) bg = "bg-amber-100 text-amber-700";
  else {
    bg = "bg-red-100 text-red-700";
    Icon = TrendingDown;
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${bg}`}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <Icon className="size-3" />
      {n.toFixed(2)}x
    </span>
  );
}

function StageChip({ stage }: { stage: string | null }) {
  if (!stage) return <span className="text-ink-400 text-xs">—</span>;
  const colors: Record<string, string> = {
    seed: "bg-purple-100 text-purple-700",
    early: "bg-blue-100 text-blue-700",
    growth: "bg-cehta-green/15 text-cehta-green",
    mature: "bg-ink-100 text-ink-700",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
        colors[stage] ?? "bg-ink-100 text-ink-700"
      }`}
    >
      {stage}
    </span>
  );
}

export default function CompaniesPage() {
  const { session } = useSession();
  const [selected, setSelected] = useState<string | null>(null);

  const { data: portfolio, isLoading } = useQuery<PortfolioResponse>({
    queryKey: ["dashboard", "portfolio"],
    queryFn: () =>
      apiClient.get<PortfolioResponse>("/dashboard/portfolio", session),
    enabled: !!session,
    staleTime: 60_000,
  });

  // G10 simplificado — invested por sector
  const sectorBars = useMemo(() => {
    if (!portfolio?.companies) return [];
    const bySector: Record<string, number> = {};
    for (const c of portfolio.companies) {
      const sec = c.sector || "Sin clasificar";
      bySector[sec] = (bySector[sec] || 0) + parseFloat(c.invested_amount_usd || "0");
    }
    return Object.entries(bySector).map(([sector, invested]) => ({
      sector,
      invested,
    }));
  }, [portfolio]);

  const totalInvested = portfolio ? parseFloat(portfolio.total_invested_usd) : 0;
  const totalFV = portfolio ? parseFloat(portfolio.total_fair_value_usd) : 0;

  return (
    <main className="mx-auto max-w-[1440px] px-6 py-6 space-y-6">
      {/* Resumen header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryTile
          label="Portfolio Companies"
          value={portfolio?.total_portfolio_companies ?? "—"}
          icon={<Briefcase className="size-4 text-cehta-green" />}
        />
        <SummaryTile
          label="Total Invested"
          value={fmtMoney(portfolio?.total_invested_usd ?? null)}
        />
        <SummaryTile
          label="Total Fair Value"
          value={fmtMoney(portfolio?.total_fair_value_usd ?? null)}
          delta={
            totalInvested > 0
              ? `${(((totalFV - totalInvested) / totalInvested) * 100).toFixed(1)}%`
              : undefined
          }
        />
        <SummaryTile
          label="Weighted MOIC"
          value={fmtMultiple(portfolio?.weighted_moic ?? null)}
        />
      </div>

      {/* G10 simplificado — invested por sector */}
      <section className="rounded-2xl bg-card border border-hairline p-5 shadow-1">
        <h3 className="text-sm font-semibold text-ink-900 mb-1">
          Capital invertido por sector
        </h3>
        <p className="text-xs text-ink-500 mb-4">
          USD desplegado, agrupado por sector ESG.
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sectorBars} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis
                dataKey="sector"
                tick={{ fontSize: 11, fill: "#64748B" }}
                angle={-25}
                textAnchor="end"
                interval={0}
                height={50}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#64748B" }}
                tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`}
              />
              <Tooltip
                formatter={(v: number) => fmtMoney(String(v))}
                cursor={{ fill: "#F1F5F9" }}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid #E2E8F0",
                }}
              />
              <Bar dataKey="invested" radius={[6, 6, 0, 0]}>
                {sectorBars.map((_, i) => (
                  <Cell
                    key={i}
                    fill={
                      ["#1d6f42", "#2da55f", "#3fcc7d", "#7cdca7", "#a8e6c4"][i % 5]
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* G09 — Tabla portfolio companies */}
      <section className="rounded-2xl bg-card border border-hairline shadow-1 overflow-hidden">
        <div className="border-b border-hairline px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">Portfolio companies</h3>
            <p className="text-xs text-ink-500 mt-0.5">
              Selecciona una empresa para ver su tear-sheet
            </p>
          </div>
          <span className="text-xs text-ink-500" style={{ fontVariantNumeric: "tabular-nums" }}>
            {portfolio?.total_portfolio_companies ?? 0} compañías
          </span>
        </div>
        {isLoading ? (
          <div className="px-5 py-12 text-center text-sm text-ink-500">Cargando…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50/50 text-xs text-ink-500 uppercase">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">Ticker</th>
                  <th className="px-5 py-3 text-left font-medium">Razón social</th>
                  <th className="px-5 py-3 text-left font-medium">Sector</th>
                  <th className="px-5 py-3 text-left font-medium">Stage</th>
                  <th className="px-5 py-3 text-right font-medium">Invested</th>
                  <th className="px-5 py-3 text-right font-medium">Fair Value</th>
                  <th className="px-5 py-3 text-right font-medium">MOIC</th>
                  <th className="px-5 py-3 text-right font-medium">IRR</th>
                  <th className="px-5 py-3 text-right font-medium">B-Corp</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {portfolio?.companies.map((c) => (
                  <tr
                    key={c.empresa_codigo}
                    className={`border-t border-hairline hover:bg-ink-50/50 cursor-pointer ${
                      selected === c.empresa_codigo ? "bg-cehta-green/5" : ""
                    }`}
                    onClick={() =>
                      setSelected(selected === c.empresa_codigo ? null : c.empresa_codigo)
                    }
                  >
                    <td className="px-5 py-3 font-mono text-xs font-semibold text-ink-900">
                      {c.ticker}
                    </td>
                    <td className="px-5 py-3 text-ink-700">{c.razon_social ?? "—"}</td>
                    <td className="px-5 py-3 text-ink-500 text-xs">{c.sector ?? "—"}</td>
                    <td className="px-5 py-3">
                      <StageChip stage={c.stage} />
                    </td>
                    <td
                      className="px-5 py-3 text-right text-ink-700"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {fmtMoney(c.invested_amount_usd)}
                    </td>
                    <td
                      className="px-5 py-3 text-right font-medium text-ink-900"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {fmtMoney(c.fair_value_usd)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <MoicBadge moic={c.moic_net} />
                    </td>
                    <td
                      className="px-5 py-3 text-right text-ink-700"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {fmtPct(c.irr_net)}
                    </td>
                    <td
                      className="px-5 py-3 text-right text-ink-500 text-xs"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {c.b_corp_score ? `${parseFloat(c.b_corp_score).toFixed(0)}` : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <ChevronRight className="size-4 text-ink-400 inline" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Tear-sheet drill-down (selected company) */}
      {selected && portfolio && (
        <TearSheet
          company={portfolio.companies.find((c) => c.empresa_codigo === selected)!}
        />
      )}
    </main>
  );
}

function SummaryTile({
  label,
  value,
  delta,
  icon,
}: {
  label: string;
  value: string | number;
  delta?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-card p-5 shadow-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-500 uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div
        className="mt-2 text-2xl font-semibold text-ink-900"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </div>
      {delta && (
        <div className="mt-1 text-xs text-cehta-green font-medium">
          {delta}
        </div>
      )}
    </div>
  );
}

function TearSheet({ company }: { company: PortfolioCompany }) {
  return (
    <section className="rounded-2xl bg-card border border-hairline p-6 shadow-1">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-bold bg-cehta-green text-white px-2 py-1 rounded">
              {company.ticker}
            </span>
            <h2 className="text-xl font-bold text-ink-900">
              {company.razon_social ?? company.empresa_codigo}
            </h2>
            {company.is_public_disclosure && (
              <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                Public disclosure
              </span>
            )}
          </div>
          <p className="text-sm text-ink-500 mt-1">
            {company.sector ?? "—"} · <StageChip stage={company.stage} />
          </p>
        </div>
        <MoicBadge moic={company.moic_net} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        <DetailMetric label="Invested" value={fmtMoney(company.invested_amount_usd)} />
        <DetailMetric label="Fair Value" value={fmtMoney(company.fair_value_usd)} />
        <DetailMetric label="IRR Net" value={fmtPct(company.irr_net)} />
        <DetailMetric
          label="B-Corp Score"
          value={company.b_corp_score ? parseFloat(company.b_corp_score).toFixed(0) : "—"}
        />
      </div>

      <div className="mt-6 pt-4 border-t border-hairline text-xs text-ink-500">
        Para ver KPIs operativos (G19) e impacto detallado, consulta el módulo de
        Companies portfolio. Tear-sheet completa próximamente.
      </div>
    </section>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ink-500 uppercase tracking-wide">{label}</div>
      <div
        className="mt-1 text-lg font-semibold text-ink-900"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </div>
    </div>
  );
}
