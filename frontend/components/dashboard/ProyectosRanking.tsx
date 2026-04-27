"use client";

/**
 * ProyectosRanking — Top 5 proyectos por gasto (últimos 12 meses).
 *
 * Lista numerada con barra de progreso inline (normalizada al máximo del
 * conjunto). Empty state si no hay data. Loading delegado al skeleton sibling.
 *
 * Integración (lo hace el agente final en page.tsx):
 *
 *   <Suspense fallback={<ProyectosRankingSkeleton />}>
 *     <ProyectosRanking />
 *   </Suspense>
 */
import { FolderOpen } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { useDashboardQuery } from "@/lib/dashboard/use-dashboard-query";
import { dashboardKeys } from "@/lib/dashboard/queries";
import { useDashboardFilters } from "@/lib/dashboard/use-dashboard-filters";
import { toCLP } from "@/lib/format";
import type { ProyectoRanking } from "@/lib/api/schema";
import { ProyectosRankingSkeleton } from "./ProyectosRankingSkeleton";

export function ProyectosRanking() {
  const { filters } = useDashboardFilters();
  const query = useDashboardQuery<ProyectoRanking[]>(
    dashboardKeys.projectsRanking(filters),
    "/dashboard/proyectos-ranking?limit=5",
  );

  if (query.isLoading || query.isPending) return <ProyectosRankingSkeleton />;

  if (query.isError) {
    return (
      <Surface className="border border-negative/20 bg-negative/5">
        <Surface.Header>
          <Surface.Title className="text-negative">
            No se pudo cargar el ranking
          </Surface.Title>
          <Surface.Subtitle>{query.error.message}</Surface.Subtitle>
        </Surface.Header>
      </Surface>
    );
  }

  const data = query.data ?? [];

  if (data.length === 0) {
    return (
      <Surface>
        <Surface.Header divider>
          <Surface.Title>Top proyectos</Surface.Title>
          <Surface.Subtitle>Por gasto · últimos 12 meses</Surface.Subtitle>
        </Surface.Header>
        <Surface.Body>
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60 text-ink-500">
              <FolderOpen className="h-6 w-6" strokeWidth={1.5} />
            </span>
            <p className="text-sm text-ink-500">
              Sin proyectos con gasto registrado
            </p>
          </div>
        </Surface.Body>
      </Surface>
    );
  }

  const maxValue = data.reduce(
    (acc, p) => Math.max(acc, Number(p.total_egreso) || 0),
    0,
  );

  return (
    <Surface>
      <Surface.Header divider>
        <Surface.Title>Top proyectos</Surface.Title>
        <Surface.Subtitle>Por gasto · últimos 12 meses</Surface.Subtitle>
      </Surface.Header>
      <Surface.Body>
        <ol className="space-y-3">
          {data.map((p, i) => {
            const total = Number(p.total_egreso) || 0;
            const pct = maxValue > 0 ? (total / maxValue) * 100 : 0;
            return (
              <li
                key={p.proyecto}
                className="grid grid-cols-[24px_1fr_auto] items-center gap-3"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold tabular-nums text-ink-700">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">
                    {p.proyecto}
                  </p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className="h-full rounded-full bg-cehta-green transition-all duration-500 ease-apple"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {p.num_movimientos} mov · {p.empresas.length}{" "}
                    {p.empresas.length === 1 ? "empresa" : "empresas"}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-ink-900">
                  {toCLP(total)}
                </span>
              </li>
            );
          })}
        </ol>
      </Surface.Body>
      <Surface.Footer>
        <a
          href="/movimientos?proyecto"
          className="text-sm text-cehta-green transition-colors hover:underline"
        >
          Ver todos los proyectos →
        </a>
      </Surface.Footer>
    </Surface>
  );
}
