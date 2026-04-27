"use client";

import { useState } from "react";
import Link from "next/link";
import { useApiQuery } from "@/hooks/use-api-query";
import { useMe } from "@/hooks/use-me";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import type { Page, F29Read } from "@/lib/api/schema";

const ESTADOS = [
  { value: "", label: "Todos los estados" },
  { value: "pendiente", label: "Pendiente" },
  { value: "pagado", label: "Pagado" },
  { value: "vencido", label: "Vencido" },
  { value: "exento", label: "Exento" },
];

const clp = (v: string | number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(Number(v));

function EstadoBadge({ estado }: { estado: string }) {
  const styles: Record<string, string> = {
    pendiente: "bg-yellow-100 text-yellow-800",
    pagado: "bg-green-100 text-green-800",
    vencido: "bg-red-100 text-red-700",
    exento: "bg-gray-100 text-gray-600",
  };
  const cls = styles[estado] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {estado.charAt(0).toUpperCase() + estado.slice(1)}
    </span>
  );
}

export default function F29Page() {
  const { data: me } = useMe();
  const { data: empresas = [] } = useCatalogoEmpresas();
  const [empresa, setEmpresa] = useState("");
  const [estado, setEstado] = useState("");

  const params = new URLSearchParams({ page: "1", size: "50" });
  if (empresa) params.set("empresa_codigo", empresa);
  if (estado) params.set("estado", estado);

  const path = `/f29?${params.toString()}`;

  const { data, isLoading, error } = useApiQuery<Page<F29Read>>(
    ["f29", empresa, estado],
    path
  );

  const items = data?.items ?? [];
  // Disciplina 3: el frontend NUNCA decide permisos por sí mismo. Lee de
  // `allowed_actions` derivado server-side desde rbac.ROLE_SCOPES.
  const canCreateF29 = me?.allowed_actions.includes("f29:create") ?? false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">F29 / Tributario</h1>
          <p className="mt-1 text-sm text-gray-500">
            Obligaciones tributarias mensuales por empresa.
          </p>
        </div>
        {canCreateF29 && (
          <Link
            href="/f29/nuevo"
            className="inline-flex items-center gap-2 rounded-lg bg-green-800 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-900 focus:outline-none focus:ring-2 focus:ring-green-700"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Registrar F29
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-green-800 focus:outline-none focus:ring-1 focus:ring-green-800"
        >
          <option value="">Todas las empresas</option>
          {empresas.map((e) => (
            <option key={e.codigo} value={e.codigo}>
              {e.codigo} — {e.razon_social}
            </option>
          ))}
        </select>

        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-green-800 focus:outline-none focus:ring-1 focus:ring-green-800"
        >
          {ESTADOS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* States */}
      {isLoading && (
        <p className="text-sm text-gray-500">Cargando...</p>
      )}

      {!isLoading && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">
            Error al cargar obligaciones F29:{" "}
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
        </div>
      )}

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
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="mt-3 text-sm font-medium text-gray-500">
            Sin obligaciones F29 registradas
          </p>
          {canCreateF29 && (
            <Link
              href="/f29/nuevo"
              className="mt-4 inline-flex items-center text-sm font-medium text-green-800 hover:underline"
            >
              Registrar primera obligación →
            </Link>
          )}
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Período Tributario</th>
                <th className="px-4 py-3">Vencimiento</th>
                <th className="px-4 py-3 text-right">Monto</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Fecha Pago</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((f) => (
                <tr key={f.f29_id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-800">
                    {f.empresa_codigo}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {f.periodo_tributario}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {f.fecha_vencimiento}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-gray-800">
                    {f.monto_a_pagar ? clp(f.monto_a_pagar) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <EstadoBadge estado={f.estado} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                    {f.fecha_pago ?? "—"}
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
