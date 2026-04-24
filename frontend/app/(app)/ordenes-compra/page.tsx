"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiQuery } from "@/hooks/use-api-query";
import { Button } from "@/components/ui/button";
import type { Page, OcListItem } from "@/lib/api/types";

const clp = (value: string | number) => {
  const num = typeof value === "string" ? Number(value) : value;
  if (isNaN(num)) return value;
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(num);
};

const ESTADO_BADGE: Record<string, string> = {
  emitida: "bg-blue-100 text-blue-800",
  pagada: "bg-green-100 text-green-800",
  anulada: "bg-gray-100 text-gray-600",
  pendiente: "bg-yellow-100 text-yellow-800",
  aprobada: "bg-purple-100 text-purple-800",
  rechazada: "bg-red-100 text-red-800",
};

function EstadoBadge({ estado }: { estado: string }) {
  const cls = ESTADO_BADGE[estado.toLowerCase()] ?? "bg-gray-100 text-gray-600";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {estado}
    </span>
  );
}

const EMPRESAS = ["", "CEHTA", "CORFO", "OTRA"]; // Extend based on real data
const ESTADOS = ["", "emitida", "pagada", "anulada", "pendiente", "aprobada", "rechazada"];

export default function OrdenesCompraPage() {
  const [page, setPage] = useState(1);
  const [empresa, setEmpresa] = useState("");
  const [estado, setEstado] = useState("");
  const SIZE = 20;

  const params = new URLSearchParams({ page: String(page), size: String(SIZE) });
  if (empresa) params.set("empresa_codigo", empresa);
  if (estado) params.set("estado", estado);

  const { data, isLoading, isError, error } = useApiQuery<Page<OcListItem>>(
    ["ordenes-compra", String(page), empresa, estado],
    `/ordenes-compra?${params.toString()}`
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
            Órdenes de Compra
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {data
              ? `${data.total} orden${data.total !== 1 ? "es" : ""} en total`
              : ""}
          </p>
        </div>
        <Link
          href="/ordenes-compra/nueva"
          className="inline-flex items-center rounded-md bg-green-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-900"
        >
          + Nueva OC
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Empresa</label>
          <select
            value={empresa}
            onChange={(e) => {
              setEmpresa(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-green-800 focus:outline-none focus:ring-1 focus:ring-green-800"
          >
            <option value="">Todas las empresas</option>
            {EMPRESAS.filter(Boolean).map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Estado</label>
          <select
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-green-800 focus:outline-none focus:ring-1 focus:ring-green-800"
          >
            <option value="">Todos los estados</option>
            {ESTADOS.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error al cargar órdenes: {error?.message}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-green-800 border-t-transparent" />
          <span className="ml-2 text-sm text-gray-500">Cargando...</span>
        </div>
      )}

      {/* Table */}
      {data && !isLoading && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {data.items.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-gray-500">
              No hay órdenes de compra con los filtros seleccionados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {[
                      "N° OC",
                      "Empresa",
                      "Fecha emisión",
                      "Moneda",
                      "Total",
                      "Estado",
                      "Acciones",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.items.map((oc) => (
                    <tr key={oc.oc_id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-gray-900">
                        {oc.numero_oc}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {oc.empresa_codigo}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {oc.fecha_emision}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {oc.moneda}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                        {oc.moneda === "CLP" ? clp(oc.total) : oc.total}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <EstadoBadge estado={oc.estado} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/ordenes-compra/${oc.oc_id}`}
                            className="text-xs font-medium text-green-700 hover:underline"
                          >
                            Ver
                          </Link>
                          {oc.pdf_url && (
                            <a
                              href={oc.pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-medium text-gray-500 hover:underline"
                            >
                              PDF
                            </a>
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
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Página {data.page} de {data.pages} &mdash; {data.total} resultados
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={data.page <= 1}
            >
              ← Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={data.page >= data.pages}
            >
              Siguiente →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
