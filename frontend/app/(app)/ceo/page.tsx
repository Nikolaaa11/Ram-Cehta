import { serverApiGet } from "@/lib/api/server";
import { Surface } from "@/components/ui/surface";
import { HeroKpis } from "@/components/ceo/HeroKpis";
import { ComparadorEmpresas } from "@/components/ceo/ComparadorEmpresas";
import { ComparativoChart } from "@/components/ceo/ComparativoChart";
import { Heatmap } from "@/components/ceo/Heatmap";
import { TopAlerts } from "@/components/ceo/TopAlerts";
import { InsightsLivePreview } from "@/components/ceo/InsightsLivePreview";
import { ExecutiveSummaryBanner } from "@/components/ceo/ExecutiveSummaryBanner";
import { CeoToolbar } from "@/components/ceo/CeoToolbar";
import { ComplianceLeaderboard } from "@/components/dashboard/ComplianceLeaderboard";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import { DataFreshness } from "@/components/shared/DataFreshness";
import type { CEOConsolidatedReport } from "@/lib/api/schema";

export const metadata = {
  title: "Dashboard CEO · Cehta Capital",
};

export default async function CeoDashboardPage() {
  let report: CEOConsolidatedReport | null = null;
  let fetchError: string | null = null;
  try {
    report = await serverApiGet<CEOConsolidatedReport>(
      "/dashboard/ceo-consolidated",
    );
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Error desconocido.";
  }

  if (fetchError || !report) {
    return (
      <div className="mx-auto max-w-[1440px] px-6 lg:px-10 py-6">
        <Surface className="border border-negative/20 bg-negative/5 ring-1 ring-negative/20">
          <Surface.Header>
            <Surface.Title className="text-negative">
              No se pudo cargar el Dashboard CEO
            </Surface.Title>
            <Surface.Subtitle>
              {fetchError ??
                "Sin datos. Verificar permisos (scope ceo:read) y conexión con el backend."}
            </Surface.Subtitle>
          </Surface.Header>
        </Surface>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-6 lg:px-10 py-6 space-y-6 print:px-0 print:py-0 print:max-w-full">
      {/* Header con toolbar (PDF / Presentar / Período) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
            Dashboard CEO
          </h1>
          <p className="flex items-center gap-2 text-sm text-ink-500">
            Vista consolidada del portafolio
            <span aria-hidden>·</span>
            <DataFreshness updatedAt={report.last_updated} />
          </p>
        </div>
        <CeoToolbar />
      </div>

      {/* Header print-only */}
      <div className="hidden print:block">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Cehta Capital · Dashboard CEO
        </p>
        <p className="text-xs text-ink-700">
          Generado el{" "}
          {new Date().toLocaleString("es-CL", {
            day: "2-digit",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>

      {/* 0) Executive Summary banner — AI-generated context setting */}
      <section data-presentation-section>
        <ErrorBoundary>
          <ExecutiveSummaryBanner />
        </ErrorBoundary>
      </section>

      {/* 1) Hero KPIs */}
      <section data-presentation-section>
        <HeroKpis data={report} />
      </section>

      {/* 2) Comparador de empresas + 3) Heatmap (lado a lado en desktop) */}
      <section data-presentation-section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-7">
          <ComparadorEmpresas empresas={report.by_empresa} />
        </div>
        <div className="col-span-12 xl:col-span-5">
          <Heatmap heatmap={report.heatmap} />
        </div>
      </section>

      {/* 2.5) Comparativo overlay chart — líneas superpuestas por empresa */}
      <section data-presentation-section>
        <ComparativoChart />
      </section>

      {/* 4) Top Alertas + 5) Insights AI Live (V4.7.13) */}
      <section data-presentation-section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-7">
          <TopAlerts alerts={report.top_alerts} />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <ErrorBoundary>
            <InsightsLivePreview fallbackText={report.insights_ai} />
          </ErrorBoundary>
        </div>
      </section>

      {/* 6) Compliance Leaderboard cross-empresa — V4.7.13 */}
      <section data-presentation-section>
        <ErrorBoundary>
          <ComplianceLeaderboard />
        </ErrorBoundary>
      </section>
    </div>
  );
}
