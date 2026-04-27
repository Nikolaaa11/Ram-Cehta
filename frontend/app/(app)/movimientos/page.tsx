"use client";

import { useState } from "react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import type { Page, MovimientoRead } from "@/lib/api/schema";
import { ApiError } from "@/lib/api/client";

const clp = (v: string | number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" }).format(Number(v));

export default function MovimientosPage() {
  const currentYear = new Date().getFullYear();
  const { data: empresas = [] } = useCatalogoEmpresas();
  const [empresa, setEmpresa] = useState("");
  const [anio, setAnio] = useState<string>(String(currentYear));
  const [realProyectado, setRealProyectado] = useState("");

  const params = new URLSearchParams({ page: "1", size: "50" });
  if (empresa) params.set("empresa_codigo", empresa);
  if (anio) params.set("anio", anio);
  if (realProyectado) params.set("real_proyectado", realProyectado);

  const path = `/movimientos?${params.toString()}`;

  const { data, isLoading, error } = useApiQuery<Page<MovimientoRead>>(
    ["movimientos", empresa, anio, realProyectado],
    path
  );

  const isNotFound =
    error instanceof ApiError && (error.status === 404 || error.status === 422);

  const items = data?.items ?? [];

  const totalAbono = items.reduce((sum, m) => sum + Number(m.abono), 0);
  const totalEgreso = items.reduce((sum, m) => sum + Number(m.egreso), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Movimientos</h1>
        <p className="mt-1 text-sm text-gray-500">
          Historial de abonos y egresos por empresa y período.
        </p>
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

        <input
          type="number"
          value={anio}
          onChange={(e) => setAnio(e.target.value)}
          placeholder="Año"
          min={2020}
          max={2099}
          className="w-28 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-green-800 focus:outline-none focus:ring-1 focus:ring-green-800"
        />

        <select
          value={realProyectado}
          onChange={(e) => setRealProyectado(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-green-800 focus:outline-none focus:ring-1 focus:ring-green-800"
        >
          <option value="">Real / Proyectado</option>
          <option value="Real">Real</option>
          <option value="Proyectado">Proyectado</option>
        </select>
      </div>

      {/* States */}
      {isLoading && (
        <p className="text-sm text-gray-500">Cargando...</p>
      )}

      {!isLoading && (isNotFound || (!error && items.length === 0)) && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-5 py-8 text-center">
          <p className="text-sm font-medium text-yellow-800">
            Sin movimientos cargados aún — ejecuta el ETL primero.
          </p>
        </div>
      )}

      {!isLoading && error && !isNotFound && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">
            Error al cargar movimientos:{" "}
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
        </div>
      )}

      {/* Table */}
      {!isLoading && !error && items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Descripción</th>
                <th className="px-4 py-3 text-right">Abono</th>
                <th className="px-4 py-3 text-right">Egreso</th>
                <th className="px-4 py-3">Concepto</th>
                <th className="px-4 py-3">Proyecto</th>
                <th className="px-4 py-3">Banco</th>
                <th className="px-4 py-3">Período</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((m) => (
                <tr key={m.movimiento_id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {m.fecha}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-800">
                    {m.empresa_codigo}
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-gray-600">
                    {m.descripcion ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-green-700">
                    {Number(m.abono) > 0 ? clp(m.abono) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-red-600">
                    {Number(m.egreso) > 0 ? clp(m.egreso) : "—"}
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-3 text-gray-600">
                    {m.concepto_general ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {m.proyecto ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {m.banco ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                    {m.periodo}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-sm">
                <td colSpan={3} className="px-4 py-3 text-gray-700">
                  Total ({items.length} movimientos)
                </td>
                <td className="px-4 py-3 text-right text-green-700">
                  {clp(totalAbono)}
                </td>
                <td className="px-4 py-3 text-right text-red-600">
                  {clp(totalEgreso)}
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
