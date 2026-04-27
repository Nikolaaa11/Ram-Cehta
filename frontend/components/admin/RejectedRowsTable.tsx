"use client";

/**
 * RejectedRowsTable — filas rechazadas por un run ETL, con JSON expandible.
 */
import { Fragment, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Inbox } from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { Page } from "@/lib/api/schema";
import {
  ADMIN_ENDPOINTS,
  type RejectedRowRead,
} from "@/lib/admin/queries";

interface RejectedRowsTableProps {
  runId: string;
}

function TableSkeleton() {
  return (
    <Surface padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-hairline text-sm">
          <thead className="bg-ink-100/40">
            <tr>
              {["Sheet", "Row", "Razón", "Datos"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs uppercase tracking-wide text-ink-500 font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {Array.from({ length: 4 }).map((_, i) => (
              <tr key={i}>
                {[0, 1, 2, 3].map((j) => (
                  <td key={j} className="px-4 py-3">
                    <Skeleton className="h-4 w-24" />
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

export function RejectedRowsTable({ runId }: RejectedRowsTableProps) {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const SIZE = 25;

  const { data, isLoading, error } = useApiQuery<Page<RejectedRowRead>>(
    ["admin-rejected-rows", runId, String(page)],
    ADMIN_ENDPOINTS.etlRunRejectedRows(runId, { page, size: SIZE }),
  );

  const isEndpointMissing =
    error instanceof ApiError && (error.status === 404 || error.status === 405);

  const items = data?.items ?? [];

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  if (isLoading) return <TableSkeleton />;

  if (isEndpointMissing) {
    return (
      <Surface className="py-12">
        <div className="flex flex-col items-center text-center">
          <p className="text-sm font-medium text-ink-900">
            Filas rechazadas no disponibles
          </p>
          <p className="mt-1 text-xs text-ink-500">
            El endpoint{" "}
            <code className="font-mono">/audit/etl-runs/[id]/rejected-rows</code>{" "}
            aún no está expuesto.
          </p>
        </div>
      </Surface>
    );
  }

  if (error) {
    return (
      <Surface className="bg-negative/5 ring-negative/20">
        <p className="text-sm font-medium text-negative">
          Error al cargar filas rechazadas
        </p>
        <p className="mt-1 text-xs text-negative/80">
          {error instanceof Error ? error.message : "Error desconocido"}
        </p>
      </Surface>
    );
  }

  if (items.length === 0) {
    return (
      <Surface className="py-12">
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-positive/10">
            <Inbox className="h-5 w-5 text-positive" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium text-ink-900">
            Ninguna fila rechazada en este run
          </p>
          <p className="mt-1 text-xs text-ink-500">
            La carga procesó todos los registros sin descartes.
          </p>
        </div>
      </Surface>
    );
  }

  return (
    <div className="space-y-4">
      <Surface padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-hairline text-sm">
            <thead className="bg-ink-100/40">
              <tr>
                <th className="w-8 px-2 py-3" />
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wide text-ink-500 font-medium">
                  Sheet
                </th>
                <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-ink-500 font-medium">
                  Row #
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wide text-ink-500 font-medium">
                  Razón
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {items.map((row) => {
                const isOpen = !!expanded[row.rejected_row_id];
                return (
                  <Fragment key={row.rejected_row_id}>
                    <tr
                      className="cursor-pointer transition-colors duration-150 hover:bg-ink-100/30"
                      onClick={() => toggle(row.rejected_row_id)}
                    >
                      <td className="px-2 py-3 text-center">
                        <ChevronDown
                          className={cn(
                            "inline h-4 w-4 text-ink-300 transition-transform duration-150",
                            isOpen && "rotate-180 text-ink-500",
                          )}
                          strokeWidth={1.5}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                        {row.source_sheet ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-900">
                        {row.source_row_num ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-ink-900">{row.reason}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={4} className="bg-ink-100/30 px-4 py-3">
                          <pre className="max-h-72 overflow-auto rounded-lg bg-white p-3 text-[11px] leading-relaxed text-ink-700 ring-1 ring-hairline">
                            <code>
                              {row.raw_data === null
                                ? "(sin datos crudos)"
                                : JSON.stringify(row.raw_data, null, 2)}
                            </code>
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Surface>

      {data && data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-500 tabular-nums">
            Página {data.page} de {data.pages} ·{" "}
            {data.total.toLocaleString("es-CL")} filas rechazadas
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 disabled:opacity-50 disabled:hover:bg-white"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={data.page >= data.pages}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 disabled:opacity-50 disabled:hover:bg-white"
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
