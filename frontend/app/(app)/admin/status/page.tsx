"use client";

import { Activity, RefreshCcw } from "lucide-react";
import { useSystemStatus } from "@/hooks/use-system-status";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusCard } from "@/components/admin/StatusCard";
import type { CheckState } from "@/hooks/use-system-status";

const OVERALL_BADGE: Record<
  CheckState,
  { label: string; bgClass: string; textClass: string }
> = {
  ok: {
    label: "Todo operacional",
    bgClass: "bg-positive/10",
    textClass: "text-positive",
  },
  degraded: {
    label: "Funcionalidad degradada",
    bgClass: "bg-warning/15",
    textClass: "text-warning",
  },
  down: {
    label: "Sistema caído",
    bgClass: "bg-negative/15",
    textClass: "text-negative",
  },
  disabled: {
    label: "Modo limitado",
    bgClass: "bg-ink-100/40",
    textClass: "text-ink-500",
  },
  unknown: {
    label: "Estado desconocido",
    bgClass: "bg-ink-100/40",
    textClass: "text-ink-500",
  },
};

/**
 * Página `/admin/status` — vista única del estado de la plataforma.
 *
 * Auto-refresh cada 30s (vive en `useSystemStatus`). Botón manual recarga
 * inmediatamente. Si el endpoint da 403, mostramos mensaje claro (este
 * dashboard requiere admin).
 */
export default function StatusPage() {
  const { data, isLoading, error, refetch, isFetching } = useSystemStatus();

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
            Status del sistema
          </h1>
          <p className="text-sm text-ink-500">
            Estado de integraciones + métricas operativas · auto-refresh cada 30s
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors duration-150 ease-apple hover:bg-ink-50 disabled:opacity-50"
        >
          <RefreshCcw
            className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
            strokeWidth={1.75}
          />
          {isFetching ? "Comprobando…" : "Refrescar"}
        </button>
      </div>

      {/* Error de auth o conexión */}
      {error && (
        <Surface className="border border-negative/20 bg-negative/5 ring-1 ring-negative/20">
          <Surface.Title className="text-negative">
            No se pudo cargar el status
          </Surface.Title>
          <Surface.Subtitle>
            {error.message}. Esta página requiere rol admin (scope{" "}
            <code className="rounded bg-ink-100/60 px-1 py-0.5 text-xs">
              audit:read
            </code>
            ).
          </Surface.Subtitle>
        </Surface>
      )}

      {/* Loading inicial */}
      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {/* Datos */}
      {data && !isLoading && !error && (
        <>
          {/* Overall banner */}
          <Surface
            className={`${OVERALL_BADGE[data.overall].bgClass} ring-1 ring-hairline`}
          >
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/60 ${OVERALL_BADGE[data.overall].textClass}`}
              >
                <Activity className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-base font-semibold ${OVERALL_BADGE[data.overall].textClass}`}
                >
                  {OVERALL_BADGE[data.overall].label}
                </p>
                <p className="text-xs text-ink-500 tabular-nums">
                  Snapshot generado:{" "}
                  {new Date(data.generated_at).toLocaleString("es-CL")}
                </p>
              </div>
            </div>
          </Surface>

          {/* Métricas operativas como tiles */}
          {data.metrics.length > 0 && (
            <Surface padding="none">
              <Surface.Header className="border-b border-hairline px-6 py-4">
                <Surface.Title>Métricas operativas</Surface.Title>
                <Surface.Subtitle>
                  Visión rápida del estado del sistema y la data
                </Surface.Subtitle>
              </Surface.Header>
              <div className="grid grid-cols-2 gap-4 p-6 md:grid-cols-3 lg:grid-cols-5">
                {data.metrics.map((m) => (
                  <div
                    key={m.label}
                    className="rounded-xl border border-hairline bg-ink-50/40 p-3"
                  >
                    <p className="text-[11px] uppercase tracking-wider text-ink-400">
                      {m.label}
                    </p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
                      {m.value}
                    </p>
                    {m.hint && (
                      <p className="mt-0.5 text-[11px] text-ink-500">{m.hint}</p>
                    )}
                  </div>
                ))}
              </div>
            </Surface>
          )}

          {/* Cards de integraciones */}
          <Surface padding="none">
            <Surface.Header className="border-b border-hairline px-6 py-4">
              <Surface.Title>Integraciones</Surface.Title>
              <Surface.Subtitle>
                Postgres responde en cada request; el resto se chequea por presencia de credencial (no se gastan llamadas a APIs externas)
              </Surface.Subtitle>
            </Surface.Header>
            <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
              {data.checks.map((c) => (
                <StatusCard key={c.name} check={c} />
              ))}
            </div>
          </Surface>
        </>
      )}
    </div>
  );
}
