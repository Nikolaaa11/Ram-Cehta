"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, ExternalLink, Inbox, XCircle } from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSession } from "@/hooks/use-session";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api/client";
import { toCLP, toDate } from "@/lib/format";
import type { Page, OcListItem } from "@/lib/api/schema";

const QUERY_KEY = ["solicitudes-pago"];

type BadgeVariant = "success" | "danger" | "warning" | "neutral" | "info";

const ESTADO_VARIANT: Record<string, BadgeVariant> = {
  borrador: "neutral",
  emitida: "info",
  pagada: "success",
  parcial: "warning",
  anulada: "danger",
};

function EstadoBadge({ estado }: { estado: string }) {
  const variant = ESTADO_VARIANT[estado.toLowerCase()] ?? "neutral";
  return (
    <Badge variant={variant} className="capitalize">
      {estado}
    </Badge>
  );
}

const COLUMNS = [
  "N° OC",
  "Empresa",
  "Fecha",
  "Proveedor",
  "Total",
  "Estado",
  "",
];

function TableSkeleton() {
  return (
    <Surface padding="none">
      <div className="overflow-hidden">
        <table className="min-w-full divide-y divide-hairline text-sm">
          <thead className="bg-ink-100/40">
            <tr>
              {COLUMNS.map((h, idx) => (
                <th
                  key={`${h}-${idx}`}
                  className="px-4 py-3 text-left text-xs uppercase tracking-wide text-ink-500 font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="ml-auto h-4 w-24" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-5 w-16 rounded-full" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-7 w-32" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

export default function SolicitudesPagoPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useApiQuery<Page<OcListItem>>(
    QUERY_KEY,
    "/ordenes-compra?estado=emitida&size=50",
  );

  const items = data?.items ?? [];

  async function handleAction(id: number, nuevoEstado: "pagada" | "anulada") {
    try {
      await apiClient.patch(
        `/ordenes-compra/${id}/estado`,
        { estado: nuevoEstado },
        session,
      );
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (err) {
      // Toast system pendiente — alert() temporal hasta migración.
      alert(
        `Error al actualizar la OC: ${err instanceof Error ? err.message : "Error desconocido"}`,
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
          Solicitudes de Pago
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Órdenes de compra emitidas pendientes de pago
          {data ? ` · ${items.length}` : ""}.
        </p>
      </div>

      {/* Loading */}
      {isLoading && <TableSkeleton />}

      {/* Error */}
      {!isLoading && error && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm font-medium text-negative">
            Error al cargar solicitudes
          </p>
          <p className="mt-1 text-xs text-negative/80">
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
        </Surface>
      )}

      {/* Empty state */}
      {!isLoading && !error && items.length === 0 && (
        <Surface className="py-16">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
              <Inbox className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
            </div>
            <p className="text-base font-semibold text-ink-900">
              Todo al día
            </p>
            <p className="mt-1 text-sm text-ink-500">
              No hay OCs emitidas pendientes de pago.
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
                  {COLUMNS.map((h, idx) => (
                    <th
                      key={`${h}-${idx}`}
                      className={`px-4 py-3 text-xs uppercase tracking-wide text-ink-500 font-medium ${
                        h === "Total" ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {items.map((oc) => (
                  <tr
                    key={oc.oc_id}
                    className="transition-colors duration-150 hover:bg-ink-100/30"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-ink-900">
                      <Link
                        href={`/ordenes-compra/${oc.oc_id}`}
                        className="inline-flex items-center gap-1 hover:text-cehta-green hover:underline"
                      >
                        {oc.numero_oc}
                        <ExternalLink
                          className="h-3 w-3 text-ink-300"
                          strokeWidth={1.5}
                        />
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                      {oc.empresa_codigo}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-700 tabular-nums">
                      {toDate(oc.fecha_emision)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-500">
                      {oc.proveedor_id ? (
                        <Link
                          href={`/proveedores/${oc.proveedor_id}`}
                          className="hover:text-cehta-green hover:underline"
                        >
                          Proveedor #{oc.proveedor_id}
                        </Link>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-ink-900 tabular-nums">
                      {toCLP(oc.total)}
                    </td>
                    <td className="px-4 py-3">
                      <EstadoBadge estado={oc.estado} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {oc.allowed_actions.includes("mark_paid") && (
                          <button
                            type="button"
                            onClick={() => handleAction(oc.oc_id, "pagada")}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
                          >
                            <CheckCircle
                              className="h-3.5 w-3.5"
                              strokeWidth={1.5}
                            />
                            Marcar pagada
                          </button>
                        )}
                        {oc.allowed_actions.includes("cancel") && (
                          <button
                            type="button"
                            onClick={() => handleAction(oc.oc_id, "anulada")}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-negative/10 px-3 py-1.5 text-xs font-medium text-negative ring-1 ring-negative/20 transition-colors hover:bg-negative/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative focus-visible:ring-offset-2"
                          >
                            <XCircle
                              className="h-3.5 w-3.5"
                              strokeWidth={1.5}
                            />
                            Anular
                          </button>
                        )}
                        {oc.allowed_actions.length === 0 && (
                          <span className="text-xs text-ink-300">
                            Sin acciones
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}
    </div>
  );
}
