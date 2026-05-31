import { Suspense } from "react";
import dynamic from "next/dynamic";
import { serverApiGet } from "@/lib/api/server";
import { Surface } from "@/components/ui/surface";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { KpiHeroSection } from "@/components/dashboard/KpiHeroSection";
import { KpiHeroSkeleton } from "@/components/dashboard/KpiHeroSkeleton";
import { KpiSecondarySection } from "@/components/dashboard/KpiSecondarySection";
import { KpiSecondarySkeleton } from "@/components/dashboard/KpiSecondarySkeleton";
import { DashboardEmptyState } from "@/components/dashboard/DashboardEmptyState";

// R152vv — Lazy-load ChartsGrid (4 charts recharts, ~80kB).
// Aparece below the fold, no necesita estar en first-load.
// Loading state: 4 skeletons grid matching final layout.
const ChartsGrid = dynamic(
  () =>
    import("@/components/dashboard/ChartsGrid").then((m) => ({
      default: m.ChartsGrid,
    })),
  {
    loading: () => (
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-72 animate-pulse rounded-2xl bg-ink-100/40 ring-1 ring-hairline"
          />
        ))}
      </div>
    ),
  },
);
import { ProyectosRanking } from "@/components/dashboard/ProyectosRanking";
import { ProyectosRankingSkeleton } from "@/components/dashboard/ProyectosRankingSkeleton";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { ActivityFeedSkeleton } from "@/components/dashboard/ActivityFeedSkeleton";
import { MiDiaWidget } from "@/components/dashboard/MiDiaWidget";
import { MiSemanaWidget } from "@/components/dashboard/MiSemanaWidget";
import { ComplianceLeaderboard } from "@/components/dashboard/ComplianceLeaderboard";
import { PipelineRegulatorio } from "@/components/dashboard/PipelineRegulatorio";
import { VouchersKpiStrip } from "@/components/dashboard/VouchersKpiStrip";
import { AiDataQAWidget } from "@/components/dashboard/AiDataQAWidget";
import { WelcomeBanner } from "@/components/dashboard/WelcomeBanner";
import { ErrorBoundary } from "@/components/shared/error-boundary";
import type { DashboardKPIs } from "@/lib/api/schema";

interface PageProps {
  searchParams: Promise<{
    empresa?: string;
    from?: string;
    to?: string;
  }>;
}

function buildQueryString(params: { empresa?: string; from?: string; to?: string }): string {
  const parts: string[] = [];
  if (params.empresa) parts.push(`empresa_codigo=${encodeURIComponent(params.empresa)}`);
  if (params.from) parts.push(`from=${encodeURIComponent(params.from)}`);
  if (params.to) parts.push(`to=${encodeURIComponent(params.to)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const qs = buildQueryString(sp);

  let kpis: DashboardKPIs | null = null;
  let fetchError: string | null = null;
  try {
    kpis = await serverApiGet<DashboardKPIs>(`/dashboard/kpis${qs}`);
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Error desconocido al cargar el dashboard.";
  }

  if (fetchError || !kpis) {
    return (
      <div className="mx-auto max-w-[1440px] px-3 sm:px-6 lg:px-10 py-4 sm:py-6">
        <Surface className="border border-negative/20 bg-negative/5 ring-1 ring-negative/20">
          <Surface.Header>
            <Surface.Title className="text-negative">
              No se pudo cargar el dashboard
            </Surface.Title>
            <Surface.Subtitle>{fetchError ?? "Sin datos."}</Surface.Subtitle>
          </Surface.Header>
        </Surface>
      </div>
    );
  }

  // ETL nunca corrió → estado vacío de bienvenida.
  if (kpis.ultimo_etl_run === null) {
    return (
      <div className="mx-auto max-w-[1440px] px-3 sm:px-6 lg:px-10 py-4 sm:py-6">
        <DashboardHeader lastEtlRun={null} etlStatus={kpis.etl_status} />
        <DashboardEmptyState />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-3 sm:px-6 lg:px-10 py-4 sm:py-6">
      <DashboardHeader lastEtlRun={kpis.ultimo_etl_run} etlStatus={kpis.etl_status} />

      {/* V5++ ola BD — Banner contextual de bienvenida/acción */}
      <ErrorBoundary>
        <WelcomeBanner />
      </ErrorBoundary>

      <div className="space-y-4 sm:space-y-6">
        {/* V4 fase 7.7 — Widget personal "Mi día" + V4.7.13 Pipeline Regulatorio
            en grid 2-col en lg para combinar info diaria + estado regulatorio. */}
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <ErrorBoundary>
              <MiDiaWidget />
            </ErrorBoundary>
          </div>
          <div className="lg:col-span-5">
            <ErrorBoundary>
              <PipelineRegulatorio />
            </ErrorBoundary>
          </div>
        </div>

        <Suspense fallback={<KpiHeroSkeleton />}>
          <KpiHeroSection initialData={kpis} />
        </Suspense>

        <Suspense fallback={<KpiSecondarySkeleton />}>
          <KpiSecondarySection initialData={kpis} />
        </Suspense>

        {/* V5: Vouchers KPI strip — pendientes de firma, no conciliados, batches Nubox. */}
        {/* R152vv — Suspense permite que el shell aparezca antes de los fetches. */}
        <ErrorBoundary>
          <Suspense fallback={<div className="h-24 animate-pulse rounded-2xl bg-ink-100/40" />}>
            <VouchersKpiStrip />
          </Suspense>
        </ErrorBoundary>

        {/* V5++: Pregunta natural sobre el fondo (Claude + snapshot). */}
        <ErrorBoundary>
          <Suspense fallback={<div className="h-32 animate-pulse rounded-2xl bg-ink-100/40" />}>
            <AiDataQAWidget />
          </Suspense>
        </ErrorBoundary>

        {/* ChartsGrid es lazy (dynamic) arriba — su propio loading state ya provee skeleton. */}
        <ErrorBoundary>
          <ChartsGrid />
        </ErrorBoundary>

        {/* V4 fase 7.15 — Mi semana: timeline horizontal 7 días */}
        <ErrorBoundary>
          <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-ink-100/40" />}>
            <MiSemanaWidget />
          </Suspense>
        </ErrorBoundary>

        {/* V4 fase 7.10 — Compliance leaderboard cross-empresa */}
        <ErrorBoundary>
          <Suspense fallback={<div className="h-48 animate-pulse rounded-2xl bg-ink-100/40" />}>
            <ComplianceLeaderboard />
          </Suspense>
        </ErrorBoundary>

        {/* Bottom row — ranking + activity feed (5/7 split en lg, stack en mobile) */}
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-5">
            <ErrorBoundary>
              <Suspense fallback={<ProyectosRankingSkeleton />}>
                <ProyectosRanking />
              </Suspense>
            </ErrorBoundary>
          </div>
          <div className="col-span-12 lg:col-span-7">
            <ErrorBoundary>
              <Suspense fallback={<ActivityFeedSkeleton />}>
                <ActivityFeed />
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
}
