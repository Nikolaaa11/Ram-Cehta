"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useApiQuery } from "@/hooks/use-api-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Page, ProveedorRead } from "@/lib/api/types";

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export default function ProveedoresPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const SIZE = 20;

  const debouncedSearch = useDebounce(search, 300);

  const queryPath = debouncedSearch
    ? `/proveedores?page=${page}&size=${SIZE}&q=${encodeURIComponent(debouncedSearch)}`
    : `/proveedores?page=${page}&size=${SIZE}`;

  const { data, isLoading, isError, error } = useApiQuery<Page<ProveedorRead>>(
    ["proveedores", String(page), debouncedSearch],
    queryPath
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      setPage(1);
    },
    []
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Proveedores</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data ? `${data.total} proveedor${data.total !== 1 ? "es" : ""} registrado${data.total !== 1 ? "s" : ""}` : ""}
          </p>
        </div>
        <Link
          href="/proveedores/nuevo"
          className="inline-flex items-center rounded-md bg-green-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-900"
        >
          + Nuevo proveedor
        </Link>
      </div>

      {/* Search */}
      <div className="max-w-sm">
        <Input
          type="search"
          placeholder="Buscar por razón social o RUT..."
          value={search}
          onChange={handleSearchChange}
          className="border-gray-300"
        />
      </div>

      {/* Error state */}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error al cargar proveedores: {error?.message}
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
              {debouncedSearch
                ? `Sin resultados para "${debouncedSearch}"`
                : "No hay proveedores registrados aún."}
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["Razón social", "RUT", "Giro", "Ciudad", "Email", "Acciones"].map((h) => (
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
                {data.items.map((p) => (
                  <tr key={p.proveedor_id} className="hover:bg-gray-50">
                    <td className="max-w-xs truncate px-4 py-3 font-medium text-gray-900">
                      {p.razon_social}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-gray-600">
                      {p.rut ?? "—"}
                    </td>
                    <td className="max-w-[12rem] truncate px-4 py-3 text-gray-600">
                      {p.giro ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {p.ciudad ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {p.email ? (
                        <a
                          href={`mailto:${p.email}`}
                          className="text-green-700 hover:underline"
                        >
                          {p.email}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`/proveedores/${p.proveedor_id}`}
                        className="text-xs font-medium text-green-700 hover:underline"
                      >
                        Ver detalle
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
