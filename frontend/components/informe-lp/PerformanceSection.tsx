"use client";

/**
 * PerformanceSection — números clave del portafolio en grid.
 *
 * No reemplaza dashboards profundos — su rol es contar la historia
 * del trimestre con 4-6 números que duelan ver.
 */
import { CountUp } from "./CountUp";
import type { InformeLpPublicView } from "@/lib/api/schema";

interface Props {
  informe: InformeLpPublicView;
}

function formatCLP(amount: number | null | undefined): string {
  if (!amount) return "—";
  if (amount >= 1_000_000_000)
    return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${Math.round(amount / 1_000_000)}M`;
  if (amount >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

export function PerformanceSection({ informe }: Props) {
  const kpis = informe.live_data?.portfolio_kpis;
  if (!kpis) return null;

  return (
    <section className="bg-white px-6 py-20 sm:py-24">
      <div className="mx-auto max-w-5xl">
        <header className="mb-12 max-w-2xl">
          <p className="text-sm uppercase tracking-[0.2em] text-cehta-green">
            Performance del trimestre
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Cómo va el portafolio
          </h2>
          <p className="mt-3 text-base leading-relaxed text-ink-600">
            Datos en vivo de los {kpis.empresas_con_actividad ?? 0} proyectos en
            ejecución del FIP CEHTA ESG, agregados a través de las{" "}
            {kpis.empresas_total_catalogo ?? 9} empresas del portafolio.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <KpiBlock
            label="AUM total"
            value={formatCLP(kpis.aum_total_clp)}
            sub={`${kpis.empresas_con_actividad ?? 0} empresas activas`}
            tone="cehta"
          />
          <KpiBlock
            label="Proyectos"
            value={
              <CountUp end={kpis.proyectos_total ?? 0} duration={1500} />
            }
            sub={`${kpis.proyectos_en_progreso ?? 0} en progreso`}
            tone="info"
          />
          <KpiBlock
            label="Hitos cumplidos"
            value={
              <>
                <CountUp
                  end={kpis.hitos_completados ?? 0}
                  duration={1500}
                />
                <span className="text-2xl font-light text-ink-400">
                  {" "}
                  / {(kpis.hitos_total ?? 0).toLocaleString("es-CL")}
                </span>
              </>
            }
            sub={`${kpis.pct_avance_global ?? 0}% del total`}
            tone="positive"
          />
          <KpiBlock
            label="Avance global"
            value={
              <CountUp
                end={kpis.pct_avance_global ?? 0}
                duration={1800}
                suffix="%"
              />
            }
            sub="del roadmap completo"
            tone="cehta"
          />
        </div>
      </div>
    </section>
  );
}

function KpiBlock({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  tone: "cehta" | "info" | "positive";
}) {
  const accent = {
    cehta: "border-cehta-green/30",
    info: "border-info/30",
    positive: "border-positive/30",
  }[tone];
  const valueColor = {
    cehta: "text-cehta-green",
    info: "text-info",
    positive: "text-positive",
  }[tone];
  return (
    <div className={`rounded-2xl border ${accent} bg-white p-6`}>
      <p className="text-xs uppercase tracking-[0.15em] text-ink-500">
        {label}
      </p>
      <p
        className={`mt-3 font-display text-4xl font-semibold tabular-nums ${valueColor} sm:text-5xl`}
      >
        {value}
      </p>
      <p className="mt-2 text-xs text-ink-500">{sub}</p>
    </div>
  );
}
