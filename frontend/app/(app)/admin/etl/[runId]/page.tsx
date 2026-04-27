import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, FileWarning } from "lucide-react";
import { serverApiGet } from "@/lib/api/server";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { RejectedRowsTable } from "@/components/admin/RejectedRowsTable";
import { toDateTime } from "@/lib/format";
import {
  ADMIN_ENDPOINTS,
  etlStatusVariant,
  formatDuration,
  type EtlRunRead,
} from "@/lib/admin/queries";

interface PageProps {
  params: Promise<{ runId: string }>;
}

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await serverApiGet<T>(path);
  } catch {
    return null;
  }
}

export default async function EtlRunDetailPage({ params }: PageProps) {
  const { runId } = await params;
  const run = await safeGet<EtlRunRead>(ADMIN_ENDPOINTS.etlRun(runId));

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* Breadcrumb */}
      <Link
        href={"/admin/etl" as Route}
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        ETL Runs
      </Link>

      {!run ? (
        <Surface className="py-16">
          <div className="flex flex-col items-center text-center">
            <p className="text-base font-semibold text-ink-900">
              Run ETL no encontrado
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              El run <code className="font-mono text-xs">{runId}</code> no existe
              o el endpoint <code className="font-mono">/audit/etl-runs</code>{" "}
              aún no está disponible.
            </p>
            <Link
              href={"/admin/etl" as Route}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700"
            >
              Volver al listado
            </Link>
          </div>
        </Surface>
      ) : (
        <>
          {/* Header */}
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
                Run{" "}
                <code className="font-mono text-xl">
                  {run.run_id.slice(0, 8)}
                </code>
              </h1>
              <Badge variant={etlStatusVariant(run.status)}>
                {run.status === "running" && (
                  <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-sf-blue" />
                )}
                {run.status}
              </Badge>
            </div>
            <p className="mt-2 max-w-3xl truncate text-sm text-ink-500">
              {run.source_file ?? "—"}
            </p>
          </div>

          {/* Meta + KPIs */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Surface padding="compact">
              <p className="text-xs uppercase tracking-wide text-ink-500">
                Iniciado
              </p>
              <p className="mt-1 font-display text-lg font-semibold tracking-tight text-ink-900 tabular-nums">
                {toDateTime(run.started_at)}
              </p>
            </Surface>
            <Surface padding="compact">
              <p className="text-xs uppercase tracking-wide text-ink-500">
                Finalizado
              </p>
              <p className="mt-1 font-display text-lg font-semibold tracking-tight text-ink-900 tabular-nums">
                {run.finished_at ? toDateTime(run.finished_at) : "—"}
              </p>
            </Surface>
            <Surface padding="compact">
              <p className="text-xs uppercase tracking-wide text-ink-500">
                Duración
              </p>
              <p className="mt-1 font-display text-lg font-semibold tracking-tight text-ink-900 tabular-nums">
                {formatDuration(run.started_at, run.finished_at)}
              </p>
            </Surface>
            <Surface padding="compact">
              <p className="text-xs uppercase tracking-wide text-ink-500">
                Disparado por
              </p>
              <p className="mt-1 truncate text-sm font-medium text-ink-900">
                {run.triggered_by ?? "—"}
              </p>
            </Surface>
          </div>

          {/* Resumen filas */}
          <div className="grid gap-4 md:grid-cols-3">
            <Surface padding="compact">
              <p className="text-xs uppercase tracking-wide text-ink-500">
                Filas extraídas
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-ink-900 tabular-nums">
                {run.rows_extracted?.toLocaleString("es-CL") ?? "—"}
              </p>
            </Surface>
            <Surface padding="compact">
              <p className="text-xs uppercase tracking-wide text-ink-500">
                Filas cargadas
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tracking-tight text-positive tabular-nums">
                {run.rows_loaded?.toLocaleString("es-CL") ?? "—"}
              </p>
            </Surface>
            <Surface
              padding="compact"
              className={
                (run.rows_rejected ?? 0) > 0
                  ? "ring-warning/20 bg-warning/5"
                  : ""
              }
            >
              <p className="text-xs uppercase tracking-wide text-ink-500">
                Filas rechazadas
              </p>
              <p
                className={`mt-1 font-display text-2xl font-semibold tracking-tight tabular-nums ${
                  (run.rows_rejected ?? 0) > 0
                    ? "text-negative"
                    : "text-ink-900"
                }`}
              >
                {run.rows_rejected?.toLocaleString("es-CL") ?? "—"}
              </p>
            </Surface>
          </div>

          {/* Error message */}
          {run.error_message && (
            <Surface className="bg-negative/5 ring-negative/20">
              <div className="flex items-start gap-3">
                <FileWarning
                  className="h-5 w-5 flex-shrink-0 text-negative"
                  strokeWidth={1.5}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-negative">
                    Error en la ejecución
                  </p>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-negative/80">
                    {run.error_message}
                  </pre>
                </div>
              </div>
            </Surface>
          )}

          {/* Rejected rows */}
          {(run.status === "failed" ||
            (run.rows_rejected ?? 0) > 0 ||
            run.status === "partial") && (
            <div className="space-y-3">
              <h2 className="font-display text-lg font-semibold tracking-tight text-ink-900">
                Filas rechazadas
              </h2>
              <RejectedRowsTable runId={runId} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
