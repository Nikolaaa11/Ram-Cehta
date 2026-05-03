"use client";

/**
 * ActivityFeed — timeline de los últimos 10 movimientos.
 *
 * Cada fila: dot positive/negative + descripción + meta (tiempo relativo,
 * proyecto badge, concepto) + monto firmado. El backend devuelve `abono`
 * y `egreso` como strings — castear a Number antes de presentar.
 *
 * Integración (lo hace el agente final en page.tsx):
 *
 *   <Suspense fallback={<ActivityFeedSkeleton />}>
 *     <ActivityFeed />
 *   </Suspense>
 */
import { Inbox } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { useDashboardQuery } from "@/lib/dashboard/use-dashboard-query";
import { dashboardKeys } from "@/lib/dashboard/queries";
import { toCLP, toRelative } from "@/lib/format";
import { ErrorState } from "@/components/shared/ErrorState";
import type { MovimientoReciente } from "@/lib/api/schema";
import { ActivityFeedSkeleton } from "./ActivityFeedSkeleton";

export function ActivityFeed() {
  const query = useDashboardQuery<MovimientoReciente[]>(
    dashboardKeys.recentActivity(),
    "/dashboard/movimientos-recientes?limit=10",
  );

  if (query.isLoading || query.isPending) return <ActivityFeedSkeleton />;

  if (query.isError) {
    return (
      <ErrorState
        title="No se pudo cargar la actividad"
        error={query.error}
        onRetry={() => query.refetch()}
      />
    );
  }

  const data = query.data ?? [];

  if (data.length === 0) {
    return (
      <Surface>
        <Surface.Header divider>
          <Surface.Title>Actividad reciente</Surface.Title>
          <Surface.Subtitle>Últimos 10 movimientos</Surface.Subtitle>
        </Surface.Header>
        <Surface.Body>
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60 text-ink-500">
              <Inbox className="h-6 w-6" strokeWidth={1.5} />
            </span>
            <p className="text-sm text-ink-500">Sin movimientos recientes</p>
          </div>
        </Surface.Body>
      </Surface>
    );
  }

  return (
    <Surface>
      <Surface.Header divider>
        <Surface.Title>Actividad reciente</Surface.Title>
        <Surface.Subtitle>Últimos 10 movimientos</Surface.Subtitle>
      </Surface.Header>
      <Surface.Body>
        <ul className="space-y-4">
          {data.map((m) => {
            const abono = Number(m.abono) || 0;
            const egreso = Number(m.egreso) || 0;
            const isAbono = abono > 0;
            const monto = isAbono ? abono : egreso;
            return (
              <li key={m.movimiento_id} className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <div
                    className={`mt-1.5 h-2 w-2 rounded-full ${
                      isAbono ? "bg-positive" : "bg-negative"
                    }`}
                    aria-hidden
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-900">
                    <span className="font-medium">{m.empresa_codigo}</span>
                    {m.descripcion && (
                      <span className="text-ink-700"> · {m.descripcion}</span>
                    )}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                    <span>{toRelative(m.fecha)}</span>
                    {m.proyecto && (
                      <Badge variant="neutral">{m.proyecto}</Badge>
                    )}
                    {m.concepto_general && (
                      <span className="truncate">· {m.concepto_general}</span>
                    )}
                  </div>
                </div>
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    isAbono ? "text-positive" : "text-negative"
                  }`}
                >
                  {isAbono ? "+" : "−"}
                  {toCLP(monto)}
                </span>
              </li>
            );
          })}
        </ul>
      </Surface.Body>
    </Surface>
  );
}
