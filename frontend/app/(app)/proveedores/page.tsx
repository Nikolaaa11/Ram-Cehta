"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Inbox,
  Plus,
  Receipt,
  Search,
  Users,
  GitMerge,
} from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportExcelButton } from "@/components/shared/ExportExcelButton";
import { SavedViewsMenu } from "@/components/shared/SavedViewsMenu";
import type { Page, ProveedorRead } from "@/lib/api/schema";

// Backend devuelve estos campos opcionales cuando llamamos con with_counts=true
type ProveedorEnriched = ProveedorRead & {
  vouchers_count?: number | null;
  ordenes_compra_count?: number | null;
};

interface DuplicateMember {
  proveedor_id: number;
  razon_social: string;
  rut: string | null;
  created_at: string;
  vouchers_count: number;
  ordenes_compra_count: number;
}

interface DuplicateGroup {
  normalized_key: string;
  members: DuplicateMember[];
}

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const COLUMNS = [
  "Razón social",
  "RUT",
  "Vouchers",
  "OCs",
  "Ciudad",
  "Email",
  "",
];

function TableSkeleton() {
  return (
    <Surface padding="none">
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
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: 7 }).map((_, j) => (
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

type Tab = "catalogo" | "duplicados";

export default function ProveedoresPage() {
  const [tab, setTab] = useState<Tab>("catalogo");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const SIZE = 20;

  const debouncedSearch = useDebounce(search, 300);

  const queryPath = debouncedSearch
    ? `/proveedores?page=${page}&size=${SIZE}&search=${encodeURIComponent(debouncedSearch)}&with_counts=true`
    : `/proveedores?page=${page}&size=${SIZE}&with_counts=true`;

  const { data, isLoading, isError, error } = useApiQuery<
    Page<ProveedorEnriched>
  >(["proveedores", String(page), debouncedSearch, "counts"], queryPath);

  const {
    data: duplicates,
    isLoading: loadingDuplicates,
  } = useApiQuery<DuplicateGroup[]>(
    ["proveedores-duplicates"],
    "/proveedores/duplicates?limit_groups=30",
    tab === "duplicados",
  );

  const duplicateCount = useMemo(
    () => duplicates?.reduce((sum, g) => sum + g.members.length, 0) ?? 0,
    [duplicates],
  );

  // V5++ ola CE — Fusión de proveedores: dentro de un grupo, el user elige
  // un "winner" y los demas se fusionan en él (mueve referencias + soft-delete).
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [mergingId, setMergingId] = useState<number | null>(null);

  async function handleMerge(sourceId: number, targetId: number, targetName: string) {
    if (mergingId !== null) return;
    setMergingId(sourceId);
    try {
      const resp = await apiClient.post<{
        vouchers_moved: number;
        ordenes_compra_moved: number;
      }>(`/proveedores/${sourceId}/merge-into/${targetId}`, {}, session);
      toast.success(
        `Fusionado en "${targetName}". ` +
          `${resp.vouchers_moved} vouchers + ${resp.ordenes_compra_moved} OCs movidos.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["proveedores-duplicates"] });
      await queryClient.invalidateQueries({ queryKey: ["proveedores"] });
      // QA fix 14/05/2026 — la fusión mueve vouchers + OCs entre
      // proveedores. Las listas en /vouchers y /ordenes-compra
      // quedaban stale (contraparte_nombre del source seguía mostrándose).
      await queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      await queryClient.invalidateQueries({ queryKey: ["ordenes-compra"] });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "Error al fusionar el proveedor.",
      );
    } finally {
      setMergingId(null);
    }
  }

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

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-hairline">
        <button
          type="button"
          onClick={() => setTab("catalogo")}
          className={`relative px-3 py-2 text-sm font-medium transition-colors ${
            tab === "catalogo"
              ? "text-cehta-green"
              : "text-ink-500 hover:text-ink-900"
          }`}
        >
          Catálogo
          {tab === "catalogo" && (
            <span className="absolute inset-x-3 -bottom-px h-0.5 bg-cehta-green" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab("duplicados")}
          className={`relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
            tab === "duplicados"
              ? "text-cehta-green"
              : "text-ink-500 hover:text-ink-900"
          }`}
        >
          <GitMerge className="h-3.5 w-3.5" strokeWidth={1.5} />
          Duplicados detectados
          {duplicates && duplicates.length > 0 && (
            <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
              {duplicates.length}
            </span>
          )}
          {tab === "duplicados" && (
            <span className="absolute inset-x-3 -bottom-px h-0.5 bg-cehta-green" />
          )}
        </button>
      </div>

      {tab === "catalogo" && (
        <>
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
                setSearch(
                  typeof filters.search === "string" ? filters.search : "",
                );
                setPage(1);
              }}
            />
          </div>

          {isError && (
            <Surface className="bg-negative/5 ring-negative/20">
              <p className="text-sm font-medium text-negative">
                Error al cargar proveedores
              </p>
              <p className="mt-1 text-xs text-negative/80">{error?.message}</p>
            </Surface>
          )}

          {isLoading && <TableSkeleton />}

          {data && !isLoading && (
            <>
              {data.items.length === 0 ? (
                <Surface className="py-16">
                  <div className="flex flex-col items-center text-center">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
                      {debouncedSearch ? (
                        <Inbox
                          className="h-6 w-6 text-ink-300"
                          strokeWidth={1.5}
                        />
                      ) : (
                        <Users
                          className="h-6 w-6 text-ink-300"
                          strokeWidth={1.5}
                        />
                      )}
                    </div>
                    <p className="text-base font-semibold text-ink-900">
                      {debouncedSearch
                        ? `Sin resultados para “${debouncedSearch}”`
                        : "No hay proveedores registrados"}
                    </p>
                    <p className="mt-1 text-sm text-ink-500">
                      {debouncedSearch
                        ? "Prueba con otro término de búsqueda."
                        : "Empezá creando tu primer proveedor."}
                    </p>
                    {!debouncedSearch && (
                      <Link
                        href="/proveedores/nuevo"
                        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700"
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
                            <td className="whitespace-nowrap px-4 py-3 text-ink-700 tabular-nums">
                              {p.vouchers_count != null ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <Receipt
                                    className="h-3.5 w-3.5 text-ink-400"
                                    strokeWidth={1.5}
                                  />
                                  {p.vouchers_count}
                                </span>
                              ) : (
                                <span className="text-ink-300">—</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-ink-700 tabular-nums">
                              {p.ordenes_compra_count != null ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <CreditCard
                                    className="h-3.5 w-3.5 text-ink-400"
                                    strokeWidth={1.5}
                                  />
                                  {p.ordenes_compra_count}
                                </span>
                              ) : (
                                <span className="text-ink-300">—</span>
                              )}
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
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={data.page >= data.pages}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 disabled:opacity-50"
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "duplicados" && (
        <div className="space-y-4">
          <Surface className="bg-warning/5 ring-warning/20">
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="h-5 w-5 shrink-0 text-warning"
                strokeWidth={1.5}
              />
              <div className="text-sm">
                <p className="font-medium text-ink-900">
                  Detectamos proveedores que parecen ser el mismo.
                </p>
                <p className="mt-1 text-ink-500">
                  Agrupamos por razón social normalizada. En cada fila tenés
                  un botón <b>&ldquo;Fusionar en →&rdquo;</b> que mueve todos los vouchers
                  y OCs de ese duplicado al &ldquo;ganador&rdquo; que elijas, y soft-deleta
                  el duplicado. Esto es <b>reversible</b> via /admin/audit
                  (action=merge) pero es una operación delicada — verificá
                  bien antes.
                </p>
              </div>
            </div>
          </Surface>

          {loadingDuplicates && <TableSkeleton />}

          {duplicates && duplicates.length === 0 && (
            <Surface className="py-12 text-center">
              <Users
                className="mx-auto h-8 w-8 text-cehta-green/60"
                strokeWidth={1.5}
              />
              <p className="mt-3 text-sm font-medium text-ink-900">
                No hay duplicados.
              </p>
              <p className="mt-1 text-xs text-ink-500">
                Tu catálogo está limpio. {duplicateCount} proveedores revisados.
              </p>
            </Surface>
          )}

          {duplicates &&
            duplicates.map((g) => (
              <Surface key={g.normalized_key} padding="none">
                <div className="border-b border-hairline bg-ink-100/30 px-4 py-2 text-xs uppercase tracking-wide text-ink-600">
                  Grupo:{" "}
                  <span className="font-mono normal-case text-ink-800">
                    {g.normalized_key}
                  </span>{" "}
                  · {g.members.length} candidatos
                </div>
                <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-hairline text-sm">
                  <thead className="text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">ID</th>
                      <th className="px-4 py-2 text-left font-medium">
                        Razón social
                      </th>
                      <th className="px-4 py-2 text-left font-medium">RUT</th>
                      <th className="px-4 py-2 text-left font-medium">
                        Creado
                      </th>
                      <th className="px-4 py-2 text-left font-medium">
                        Vouchers
                      </th>
                      <th className="px-4 py-2 text-left font-medium">OCs</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {g.members.map((m) => (
                      <tr
                        key={m.proveedor_id}
                        className="hover:bg-ink-100/30"
                      >
                        <td className="px-4 py-2 font-mono text-xs tabular-nums text-ink-600">
                          #{m.proveedor_id}
                        </td>
                        <td className="px-4 py-2 text-ink-900">
                          {m.razon_social}
                        </td>
                        <td className="px-4 py-2 font-mono tabular-nums text-ink-700">
                          {m.rut ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-xs tabular-nums text-ink-500">
                          {m.created_at.slice(0, 10)}
                        </td>
                        <td className="px-4 py-2 tabular-nums text-ink-700">
                          {m.vouchers_count}
                        </td>
                        <td className="px-4 py-2 tabular-nums text-ink-700">
                          {m.ordenes_compra_count}
                        </td>
                        <td className="px-4 py-2 text-right space-x-2">
                          <Link
                            href={`/proveedores/${m.proveedor_id}`}
                            className="text-xs font-medium text-cehta-green hover:underline"
                          >
                            Ver
                          </Link>
                          {g.members.length >= 2 && (
                            <select
                              disabled={mergingId !== null}
                              defaultValue=""
                              onChange={(e) => {
                                const targetId = Number(e.target.value);
                                if (!targetId) return;
                                const target = g.members.find(
                                  (x) => x.proveedor_id === targetId,
                                );
                                if (!target) return;
                                if (
                                  window.confirm(
                                    `Fusionar #${m.proveedor_id} "${m.razon_social}" en #${targetId} "${target.razon_social}"?\n\nSe moveran ${m.vouchers_count} vouchers y ${m.ordenes_compra_count} OCs al ganador, y el duplicado quedara soft-deleted.`,
                                  )
                                ) {
                                  handleMerge(
                                    m.proveedor_id,
                                    targetId,
                                    target.razon_social,
                                  );
                                }
                                e.target.value = "";
                              }}
                              className="rounded border border-hairline bg-white px-1.5 py-0.5 text-[11px] text-ink-700 focus:outline-none focus:ring-1 focus:ring-cehta-green"
                            >
                              <option value="">
                                {mergingId === m.proveedor_id
                                  ? "Fusionando…"
                                  : "Fusionar en →"}
                              </option>
                              {g.members
                                .filter(
                                  (other) =>
                                    other.proveedor_id !== m.proveedor_id,
                                )
                                .map((other) => (
                                  <option
                                    key={other.proveedor_id}
                                    value={other.proveedor_id}
                                  >
                                    #{other.proveedor_id} {other.razon_social}
                                  </option>
                                ))}
                            </select>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </Surface>
            ))}
        </div>
      )}
    </div>
  );
}
