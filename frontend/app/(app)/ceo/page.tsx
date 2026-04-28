import { Sparkles } from "lucide-react";
import { serverApiGet } from "@/lib/api/server";
import { Surface } from "@/components/ui/surface";
import { HeroKpis } from "@/components/ceo/HeroKpis";
import { ComparadorEmpresas } from "@/components/ceo/ComparadorEmpresas";
import { Heatmap } from "@/components/ceo/Heatmap";
import { TopAlerts } from "@/components/ceo/TopAlerts";
import { toRelative } from "@/lib/format";
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
    <div className="mx-auto max-w-[1440px] px-6 lg:px-10 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
            Dashboard CEO
          </h1>
          <p className="text-sm text-ink-500">
            Vista consolidada del portafolio · actualizado {toRelative(report.last_updated)}
          </p>
        </div>
      </div>

      {/* 1) Hero KPIs */}
      <HeroKpis data={report} />

      {/* 2) Comparador de empresas + 3) Heatmap (lado a lado en desktop) */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-7">
          <ComparadorEmpresas empresas={report.by_empresa} />
        </div>
        <div className="col-span-12 xl:col-span-5">
          <Heatmap heatmap={report.heatmap} />
        </div>
      </div>

      {/* 4) Top Alertas + 5) Insights AI */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-7">
          <TopAlerts alerts={report.top_alerts} />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <Surface className="h-full">
            <Surface.Header>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-cehta-green/10 text-cehta-green">
                  <Sparkles className="h-4 w-4" strokeWidth={1.5} />
                </span>
                <Surface.Title>Insights AI</Surface.Title>
              </div>
              <Surface.Subtitle>
                Resumen ejecutivo generado por Claude
              </Surface.Subtitle>
            </Surface.Header>
            <p className="mt-4 text-sm leading-relaxed text-ink-700">
              {report.insights_ai}
            </p>
          </Surface>
        </div>
      </div>
    </div>
  );
}
