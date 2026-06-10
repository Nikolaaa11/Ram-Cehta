"use client";

/**
 * /dashboard/inversionistas — Round 152
 *
 * Vista LP / Aportante — PCAP ILPA v2.0 + Impact agregado.
 *
 * Diferencia con /dashboard/directorio:
 *   - Métricas con scope = LP allocation (no fund-level total)
 *   - Portfolio companies solo las is_public_disclosure=TRUE
 *   - KPIs operativos NO visibles (sin revenue/EBITDA/runway)
 *   - Impact agregado (no por compañía)
 *   - Documentos solo los visibles para el LP
 */
import { useMemo } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Building2, CheckCircle2, Download, Sparkles } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface MyPcap {
  lp_legal_name: string;
  fund_codigo: string;
  commitment_usd: string;
  paid_in_to_date_usd: string;
  paid_in_pct: string;
  distributed_to_date_usd: string;
  current_nav_usd: string;
  unfunded_commitment_usd: string;
  tvpi: string | null;
  dpi: string | null;
  rvpi: string | null;
  moic: string | null;
}

interface JCurvePoint {
  quarter: string;
  quarter_net: string;
  cumulative_net: string;
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

const fmtMultiple = (v: string | null | undefined) =>
  v ? `${parseFloat(v).toFixed(2)}x` : "—";

const fmtPct = (v: string | null | undefined) =>
  v ? `${parseFloat(v).toFixed(1)}%` : "—";

export default function InversionistasPage() {
  const { session } = useSession();

  const { data: pcap } = useQuery<MyPcap>({
    queryKey: ["dashboard-lp", "pcap"],
    queryFn: () => apiClient.get<MyPcap>("/dashboard/lps/mine", session),
    enabled: !!session,
    staleTime: 5 * 60_000, // R152zz: datos institucionales cambian lentamente
  });

  const { data: jcurve } = useQuery<{ points: JCurvePoint[] }>({
    queryKey: ["dashboard-lp", "jcurve"],
    queryFn: () =>
      apiClient.get<{ fund_codigo: string; points: JCurvePoint[] }>(
        "/dashboard/fund/jcurve",
        session,
      ),
    enabled: !!session,
    staleTime: 5 * 60_000, // R152zz: datos institucionales cambian lentamente
  });

  const { data: impact } = useQuery<{ period: string; cards: ImpactCard[] }>({
    queryKey: ["dashboard-lp", "impact"],
    queryFn: () =>
      apiClient.get<{ period: string; cards: ImpactCard[] }>("/dashboard/impact", session),
    enabled: !!session,
    staleTime: 5 * 60_000, // R152zz: datos institucionales cambian lentamente
  });

  const jcurveData = useMemo(() => {
    // En vista LP, escalamos el J-curve por ownership_pct
    // (asumimos 50% si no hay info; para demo)
    const lpShare = pcap?.commitment_usd
      ? parseFloat(pcap.commitment_usd) / 22_500_000
      : 0.5;
    return (jcurve?.points ?? []).map((p) => ({
      quarter: new Date(p.quarter).toLocaleDateString("en-US", {
        year: "2-digit",
        month: "short",
      }),
      cumulative: parseFloat(p.cumulative_net) * lpShare,
    }));
  }, [jcurve, pcap]);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-8">
      {/* ============ HEADER ============ */}
      <div>
        <Link
          href={"/dashboard/directorio" as Route}
          className="inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-cehta-green mb-3"
        >
          <ArrowLeft className="size-3" />
          Vista Directorio
        </Link>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cehta-green">
              <Sparkles className="size-3.5" />
              Vista Inversionista · ILPA v2.0
            </div>
            <h1 className="mt-2 font-display text-3xl md:text-4xl font-semibold tracking-tight text-ink-900">
              Bienvenido, {pcap?.lp_legal_name ?? "Aportante"}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              {pcap?.fund_codigo ?? "FIP CEHTA ESG"} ·{" "}
              {new Date().toLocaleDateString("es-CL", { year: "numeric", month: "long" })}
            </p>
          </div>
          {/* R152BBBBBB — Export ILPA v2.0 todavía no implementado.
              Antes había un botón "Próximamente" disabled que confundía.
              Lo ocultamos completamente hasta que el feature esté listo.
              Cuando vuelva, mostrar como `<button disabled>Descargar PCAP</button>`
              con label "Beta" en lugar del tooltip críptico. */}
        </div>
      </div>

      {/* ============ PCAP CARD HERO ============ */}
      <section
        className="rounded-3xl border border-cehta-green/20 bg-gradient-to-br from-cehta-green/5 to-blue-50/30 p-8 shadow-card"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1">
              Mi Compromiso
            </div>
            <div className="text-3xl font-bold text-ink-900">
              {fmtUSD(pcap?.commitment_usd)}
            </div>
            <div className="text-xs text-ink-500 mt-1">USD comprometidos</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1">
              Paid-In
            </div>
            <div className="text-3xl font-bold text-ink-900">
              {fmtUSD(pcap?.paid_in_to_date_usd)}
            </div>
            <div className="text-xs text-cehta-green mt-1 font-semibold">
              {fmtPct(pcap?.paid_in_pct)} called
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1">
              Distribuciones
            </div>
            <div className="text-3xl font-bold text-ink-900">
              {fmtUSD(pcap?.distributed_to_date_usd)}
            </div>
            <div className="text-xs text-ink-500 mt-1">Recibidas a la fecha</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1">
              Current NAV
            </div>
            <div className="text-3xl font-bold text-ink-900">
              {fmtUSD(pcap?.current_nav_usd)}
            </div>
            <div className="text-xs text-ink-500 mt-1">Valor proporcional</div>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-cehta-green/10 grid grid-cols-2 md:grid-cols-4 gap-4">
          <RatioCell label="TVPI" value={fmtMultiple(pcap?.tvpi)} accent="green" />
          <RatioCell label="DPI" value={fmtMultiple(pcap?.dpi)} />
          <RatioCell label="RVPI" value={fmtMultiple(pcap?.rvpi)} />
          <RatioCell label="Unfunded" value={fmtUSD(pcap?.unfunded_commitment_usd, { compact: true })} accent="amber" />
        </div>
      </section>

      {/* ============ J-CURVE SCOPED ============ */}
      <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Mi J-Curve · Net Cashflow</h2>
            <p className="text-xs text-ink-500 mt-0.5">
              Escalado a tu commitment ({fmtUSD(pcap?.commitment_usd, { compact: true })}). Capital calls negativos + distribuciones positivas.
            </p>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">ILPA v2.0</div>
        </div>
        <div className="h-[260px]">
          {jcurveData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={jcurveData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="lpJcurve" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0E7C66" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#C2410C" stopOpacity={0.15} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E4E4E7" />
                <XAxis dataKey="quarter" stroke="#71717A" tick={{ fontSize: 11 }} />
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
                <ReferenceLine y={0} stroke="#71717A" strokeDasharray="2 2" />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  name="Mi neto acumulado"
                  stroke="#0E7C66"
                  strokeWidth={2}
                  fill="url(#lpJcurve)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink-400">
              Cargando...
            </div>
          )}
        </div>
      </section>

      {/* ============ IMPACT AGGREGATED ============ */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Impacto del Fondo</h2>
            <p className="text-xs text-ink-500 mt-0.5">
              IRIS+ v5.3 · agregado del portfolio · período {impact?.period ?? "2025-12-31"}
            </p>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">IRIS+ v5.3</div>
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
            </div>
          ))}
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <div className="text-center text-[11px] text-ink-400 italic pt-6 border-t border-hairline">
        Datos preparados según ILPA Reporting Template v2.0 · IRIS+ v5.3 · OPIM Annual Disclosure
      </div>
    </div>
  );
}

function RatioCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "amber";
}) {
  const cls =
    accent === "green"
      ? "text-cehta-green"
      : accent === "amber"
        ? "text-amber-700"
        : "text-ink-900";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold mb-1">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
