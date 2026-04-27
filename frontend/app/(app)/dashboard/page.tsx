import { Suspense } from "react";
import { serverApiGet } from "@/lib/api/server";
import { Surface } from "@/components/ui/surface";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { KpiHeroSection } from "@/components/dashboard/KpiHeroSection";
import { KpiHeroSkeleton } from "@/components/dashboard/KpiHeroSkeleton";
import { KpiSecondarySection } from "@/components/dashboard/KpiSecondarySection";
import { KpiSecondarySkeleton } from "@/components/dashboard/KpiSecondarySkeleton";
import { DashboardEmptyState } from "@/components/dashboard/DashboardEmptyState";
import { ChartsGrid } from "@/components/dashboard/ChartsGrid";
import { ProyectosRanking } from "@/components/dashboard/ProyectosRanking";
import { ProyectosRankingSkeleton } from "@/components/dashboard/ProyectosRankingSkeleton";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { ActivityFeedSkeleton } from "@/components/dashboard/ActivityFeedSkeleton";
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
      <div className="mx-auto max-w-[1440px] px-6 lg:px-10 py-6">
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
      <div className="mx-auto max-w-[1440px] px-6 lg:px-10 py-6">
        <DashboardHeader lastEtlRun={null} etlStatus={kpis.etl_status} />
        <DashboardEmptyState />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-6 lg:px-10 py-6">
      <DashboardHeader lastEtlRun={kpis.ultimo_etl_run} etlStatus={kpis.etl_status} />

      <div className="space-y-6">
        <Suspense fallback={<KpiHeroSkeleton />}>
          <KpiHeroSection initialData={kpis} />
        </Suspense>

        <Suspense fallback={<KpiSecondarySkeleton />}>
          <KpiSecondarySection initialData={kpis} />
        </Suspense>

        <ErrorBoundary>
          <ChartsGrid />
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
