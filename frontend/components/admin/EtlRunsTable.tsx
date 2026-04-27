"use client";

/**
 * EtlRunsTable — lista de runs ETL con filtros y paginación.
 *
 * Cliente: usa `useApiQuery` para revalidación automática y permite filtrar
 * por status sin recargar la página. Si el endpoint aún no existe (backend en
 * construcción) cae a empty state amistoso.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  PlugZap,
} from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api/client";
import { toDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Page } from "@/lib/api/schema";
import {
  ADMIN_ENDPOINTS,
  etlStatusVariant,
  formatDuration,
  type EtlRunRead,
} from "@/lib/admin/queries";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
  { value: "running", label: "Running" },
  { value: "partial", label: "Partial" },
];

const COLUMNS = [
  { key: "run_id", label: "Run ID", align: "left" as const },
  { key: "started_at", label: "Iniciado", align: "left" as const },
  { key: "duration", label: "Duración", align: "right" as const },
  { key: "status", label: "Status", align: "left" as const },
  { key: "source_file", label: "Archivo", align: "left" as const },
  { key: "rows_loaded", label: "Cargadas", align: "right" as const },
  { key: "rows_rejected", label: "Rechazadas", align: "right" as const },
  { key: "triggered_by", label: "Disparado por", align: "left" as const },
];

function TableSkeleton() {
  return (
    <Surface padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-hairline text-sm">
          <thead className="bg-ink-100/40">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-4 py-3 text-xs uppercase tracking-wide text-ink-500 font-medium",
                    c.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="px-4 py-3">
                    <Skeleton
                      className={cn(
                        "h-4",
                        c.align === "right" ? "ml-auto w-16" : "w-24",
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

export function EtlRunsTable() {
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(1);
  const SIZE = 25;

  const path = useMemo(
    () =>
      ADMIN_ENDPOINTS.etlRuns({
        status: status || undefined,
        page,
        size: SIZE,
      }),
    [status, page],
  );

  const { data, isLoading, error } = useApiQuery<Page<EtlRunRead>>(
    ["admin-etl-runs", status, String(page)],
    path,
  );

  const isEndpointMissing =
    error instanceof ApiError && (error.status === 404 || error.status === 405);

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Surface variant="glass" padding="compact">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-ink-500 font-medium">
              Status
            </span>
            <div
              role="tablist"
              aria-label="Filtro de status"
              className="inline-flex h-9 items-center rounded-xl bg-ink-100/60 p-1 ring-1 ring-hairline"
            >
              {STATUS_OPTIONS.map((opt) => {
                const active = status === opt.value;
                return (
                  <button
                    key={opt.value || "all"}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setStatus(opt.value);
                      setPage(1);
                    }}
                    className={cn(
                      "inline-flex h-7 items-center rounded-lg px-3 text-xs font-medium transition-colors duration-150 ease-apple",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                      active
                        ? "bg-white text-ink-900 shadow-glass"
                        : "text-ink-500 hover:text-ink-900",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          {data && (
            <div className="ml-auto text-xs text-ink-500 tabular-nums">
              {data.total.toLocaleString("es-CL")} run
              {data.total !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      </Surface>

      {/* Loading */}
      {isLoading && <TableSkeleton />}

      {/* Endpoint missing */}
      {!isLoading && isEndpointMissing && (
        <Surface className="py-16">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
              <PlugZap className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
            </div>
            <p className="text-base font-semibold text-ink-900">
              Endpoint ETL no disponible
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              El backend aún no expone <code className="font-mono text-xs">/audit/etl-runs</code>.
              Coordiná con el equipo de infra para deployar.
            </p>
          </div>
        </Surface>
      )}

      {/* Error */}
      {!isLoading && error && !isEndpointMissing && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm font-medium text-negative">
            Error al cargar runs ETL
          </p>
          <p className="mt-1 text-xs text-negative/80">
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
        </Surface>
      )}

      {/* Empty */}
      {!isLoading && !error && items.length === 0 && (
        <Surface className="py-16">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
              <Database className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
            </div>
            <p className="text-base font-semibold text-ink-900">
              No hay runs ETL todavía
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              {status
                ? "Probá quitar el filtro de status."
                : "Cuando se ejecute el primer ETL, aparecerá aquí con su trazabilidad completa."}
            </p>
          </div>
        </Surface>
      )}

      {/* Table */}
      {!isLoading && !error && items.length > 0 && (
        <Surface padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-hairline text-sm">
              <thead className="bg-ink-100/40">
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={cn(
                        "px-4 py-3 text-xs uppercase tracking-wide text-ink-500 font-medium",
                        c.align === "right" ? "text-right" : "text-left",
                      )}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {items.map((r) => {
                  const href = `/admin/etl/${r.run_id}` as Route;
                  return (
                    <tr
                      key={r.run_id}
                      className="cursor-pointer transition-colors duration-150 hover:bg-ink-100/30"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-700">
                        <Link href={href} className="hover:underline">
                          {r.run_id.slice(0, 8)}…
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-700">
                        <Link href={href} className="block">
                          {toDateTime(r.started_at)}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-900">
                        <Link href={href} className="block">
                          {formatDuration(r.started_at, r.finished_at)}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Link href={href} className="block">
                          <Badge variant={etlStatusVariant(r.status)}>
                            {r.status === "running" && (
                              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-sf-blue" />
                            )}
                            {r.status}
                          </Badge>
                        </Link>
                      </td>
                      <td className="max-w-[16rem] truncate px-4 py-3 text-ink-700">
                        <Link
                          href={href}
                          className="block truncate"
                          title={r.source_file ?? undefined}
                        >
                          {r.source_file ?? "—"}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-900">
                        <Link href={href} className="block">
                          {r.rows_loaded?.toLocaleString("es-CL") ?? "—"}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        <Link href={href} className="block">
                          <span
                            className={cn(
                              "tabular-nums",
                              (r.rows_rejected ?? 0) > 0
                                ? "font-medium text-negative"
                                : "text-ink-700",
                            )}
                          >
                            {r.rows_rejected?.toLocaleString("es-CL") ?? "—"}
                          </span>
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500">
                        <Link href={href} className="block">
                          {r.triggered_by ?? "—"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-500 tabular-nums">
            Página {data.page} de {data.pages} ·{" "}
            {data.total.toLocaleString("es-CL")} resultados
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-50 disabled:hover:bg-white"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={data.page >= data.pages}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-50 disabled:hover:bg-white"
            >
              Siguiente
              <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
