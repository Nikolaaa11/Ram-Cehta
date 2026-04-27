"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";
import type { Page, OcListItem } from "@/lib/api/schema";

const clp = (v: string | number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(Number(v));

const QUERY_KEY = ["solicitudes-pago"];

function EstadoBadge({ estado }: { estado: string }) {
  const styles: Record<string, string> = {
    borrador: "bg-gray-100 text-gray-600",
    emitida: "bg-blue-100 text-blue-700",
    pagada: "bg-green-100 text-green-800",
    anulada: "bg-red-100 text-red-700",
  };
  const cls = styles[estado] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {estado.charAt(0).toUpperCase() + estado.slice(1)}
    </span>
  );
}

export default function SolicitudesPagoPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useApiQuery<Page<OcListItem>>(
    QUERY_KEY,
    "/ordenes-compra?estado=emitida&size=50"
  );

  const items = data?.items ?? [];

  async function handleAction(id: number, nuevoEstado: "pagada" | "anulada") {
    try {
      await apiClient.patch(`/ordenes-compra/${id}/estado`, { estado: nuevoEstado }, session);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (err) {
      alert(
        `Error al actualizar la OC: ${err instanceof Error ? err.message : "Error desconocido"}`
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Solicitudes de Pago</h1>
        <p className="mt-1 text-sm text-gray-500">
          Órdenes de compra emitidas pendientes de pago.
        </p>
      </div>

      {/* Loading */}
      {isLoading && (
        <p className="text-sm text-gray-500">Cargando...</p>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">
            Error al cargar solicitudes:{" "}
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && items.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white px-5 py-12 text-center shadow-sm">
          <svg
            className="mx-auto h-10 w-10 text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <p className="mt-3 text-sm font-medium text-gray-500">
            No hay OCs emitidas pendientes de pago
          </p>
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">N° OC</th>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Fecha Emisión</th>
                <th className="px-4 py-3">Proveedor</th>
                <th className="px-4 py-3 text-right">Monto Total</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((oc) => (
                <tr key={oc.oc_id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-gray-800">
                    {oc.numero_oc}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {oc.empresa_codigo}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {oc.fecha_emision}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                    {oc.proveedor_id ? `Proveedor #${oc.proveedor_id}` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-gray-800">
                    {clp(oc.total)}
                  </td>
                  <td className="px-4 py-3">
                    <EstadoBadge estado={oc.estado} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-2">
                      {oc.allowed_actions.includes("mark_paid") && (
                        <button
                          onClick={() => handleAction(oc.oc_id, "pagada")}
                          className="rounded-md bg-green-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-900 focus:outline-none focus:ring-2 focus:ring-green-700"
                        >
                          Marcar Pagada
                        </button>
                      )}
                      {oc.allowed_actions.includes("cancel") && (
                        <button
                          onClick={() => handleAction(oc.oc_id, "anulada")}
                          className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400"
                        >
                          Anular
                        </button>
                      )}
                      {oc.allowed_actions.length === 0 && (
                        <span className="text-xs text-gray-400">Sin acciones</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
