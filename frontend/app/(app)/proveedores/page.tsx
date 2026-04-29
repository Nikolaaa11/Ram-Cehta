"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Inbox, Plus, Search, Users } from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportExcelButton } from "@/components/shared/ExportExcelButton";
import { SavedViewsMenu } from "@/components/shared/SavedViewsMenu";
import type { Page, ProveedorRead } from "@/lib/api/schema";

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const COLUMNS = ["Razón social", "RUT", "Giro", "Ciudad", "Email", ""];

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
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-48" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-32" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-40" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-16" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
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
    queryPath,
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      setPage(1);
    },
    [],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            Proveedores
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {data
              ? `${data.total} proveedor${data.total !== 1 ? "es" : ""} registrado${data.total !== 1 ? "s" : ""}`
              : "Cargando proveedores…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportExcelButton entity="proveedores" />
          <Link
            href="/proveedores/nuevo"
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Nuevo proveedor
          </Link>
        </div>
      </div>

      {/* Search + Saved views */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300"
            strokeWidth={1.5}
          />
          <input
            type="search"
            placeholder="Buscar por razón social o RUT…"
            value={search}
            onChange={handleSearchChange}
            className="w-full rounded-lg border-0 bg-white px-3 py-2 pl-9 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 transition-shadow focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </div>
        <SavedViewsMenu
          page="proveedores"
          currentFilters={{ search }}
          onApply={(filters) => {
            setSearch(typeof filters.search === "string" ? filters.search : "");
            setPage(1);
          }}
        />
      </div>

      {/* Error state */}
      {isError && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm font-medium text-negative">
            Error al cargar proveedores
          </p>
          <p className="mt-1 text-xs text-negative/80">{error?.message}</p>
        </Surface>
      )}

      {/* Loading state */}
      {isLoading && <TableSkeleton />}

      {/* Table / empty state */}
      {data && !isLoading && (
        <>
          {data.items.length === 0 ? (
            <Surface className="py-16">
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
                  {debouncedSearch ? (
                    <Inbox className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
                  ) : (
                    <Users className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
                  )}
                </div>
                <p className="text-base font-semibold text-ink-900">
                  {debouncedSearch
                    ? `Sin resultados para “${debouncedSearch}”`
                    : "No hay proveedores registrados"}
                </p>
                <p className="mt-1 text-sm text-ink-500">
                  {debouncedSearch
                    ? "Probá con otro término de búsqueda."
                    : "Empezá creando tu primer proveedor."}
                </p>
                {!debouncedSearch && (
                  <Link
                    href="/proveedores/nuevo"
                    className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
                  >
                    <Plus className="h-4 w-4" strokeWidth={1.5} />
                    Nuevo proveedor
                  </Link>
                )}
              </div>
            </Surface>
          ) : (
            <Surface padding="none" className="overflow-hidden">
              <div className="overflow-x-auto">
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
                    {data.items.map((p) => (
                      <tr
                        key={p.proveedor_id}
                        className="transition-colors duration-150 hover:bg-ink-100/30"
                      >
                        <td className="max-w-xs truncate px-4 py-3 font-medium text-ink-900">
                          {p.razon_social}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono tabular-nums text-ink-700">
                          {p.rut ?? "—"}
                        </td>
                        <td className="max-w-[12rem] truncate px-4 py-3 text-ink-700">
                          {p.giro ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                          {p.ciudad ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                          {p.email ? (
                            <a
                              href={`mailto:${p.email}`}
                              className="text-cehta-green hover:underline"
                            >
                              {p.email}
                            </a>
                          ) : (
                            <span className="text-ink-300">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <Link
                            href={`/proveedores/${p.proveedor_id}`}
                            className="text-xs font-medium text-cehta-green hover:underline"
                          >
                            Ver detalle →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Surface>
          )}
        </>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-500 tabular-nums">
            Página {data.page} de {data.pages} · {data.total} resultados
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
