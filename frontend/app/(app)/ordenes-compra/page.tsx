"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  LayoutGrid,
  ListIcon,
  MessageSquare,
  Package,
  Plus,
  Sparkles,
} from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ScopeIndicator } from "@/components/shared/ScopeIndicator";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { toCLP, toDate } from "@/lib/format";
import { ExportExcelButton } from "@/components/shared/ExportExcelButton";
import { BulkActionBar } from "@/components/shared/BulkActionBar";
import { SavedViewsMenu } from "@/components/shared/SavedViewsMenu";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { useMe } from "@/hooks/use-me";
import type { Page, OcListItem } from "@/lib/api/schema";

type BadgeVariant = "success" | "danger" | "warning" | "neutral" | "info";

const ESTADO_VARIANT: Record<string, BadgeVariant> = {
  borrador: "neutral",
  emitida: "info",
  pagada: "success",
  parcial: "warning",
  pendiente: "warning",
  aprobada: "info",
  anulada: "danger",
  rechazada: "danger",
};

function EstadoBadge({ estado }: { estado: string }) {
  const variant = ESTADO_VARIANT[estado.toLowerCase()] ?? "neutral";
  return (
    <Badge variant={variant} className="capitalize">
      {estado}
    </Badge>
  );
}

const ESTADOS = [
  "emitida",
  "pagada",
  "anulada",
  "pendiente",
  "aprobada",
  "rechazada",
];

const COLUMNS = [
  "select",
  "N° OC",
  "Empresa",
  "Fecha",
  "Moneda",
  "Total",
  "Estado",
  "",
];

const OC_BULK_OPTIONS = [
  { value: "pagada", label: "Marcar pagada" },
  { value: "anulada", label: "Anular" },
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
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-4 rounded" />
                </td>
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
                  <Skeleton className="h-4 w-12" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="ml-auto h-4 w-24" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-5 w-16 rounded-full" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-12" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

export default function OrdenesCompraPage() {
  const { data: empresas = [] } = useCatalogoEmpresas();
  const { data: me } = useMe();
  // Round 10 — URL state para filtros (mismo pattern que /vouchers en R8).
  // Refresh no pierde el filtro, links shareables, browser back funciona
  // como saved view.
  const searchParams = useSearchParams();
  const [page, setPage] = useState(() =>
    Math.max(1, parseInt(searchParams.get("page") ?? "1", 10)),
  );
  const [empresa, setEmpresa] = useState(
    () => searchParams.get("empresa") ?? "",
  );
  const [estado, setEstado] = useState(
    () => searchParams.get("estado") ?? "",
  );
  const SIZE = 20;

  // Sync state → URL (replaceState, no rerender, no history pollution).
  useEffect(() => {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    if (empresa) params.set("empresa", empresa);
    if (estado) params.set("estado", estado);
    const qs = params.toString();
    const url = qs ? `/ordenes-compra?${qs}` : "/ordenes-compra";
    window.history.replaceState(null, "", url);
  }, [page, empresa, estado]);

  // Round 10 — quick filter chips + clear helper.
  const hasActiveFilters = !!empresa || !!estado;
  const clearAllFilters = () => {
    setEmpresa("");
    setEstado("");
    setPage(1);
  };
  const applyPreset = (preset: "pendientes" | "emitidas" | "borradores") => {
    setEmpresa("");
    setPage(1);
    if (preset === "pendientes") setEstado("pendiente");
    else if (preset === "emitidas") setEstado("emitida");
    else if (preset === "borradores") setEstado("borrador");
  };

  const params = new URLSearchParams({
    page: String(page),
    size: String(SIZE),
  });
  if (empresa) params.set("empresa_codigo", empresa);
  if (estado) params.set("estado", estado);

  const { data, isLoading, isError, error } = useApiQuery<Page<OcListItem>>(
    ["ordenes-compra", String(page), empresa, estado],
    `/ordenes-compra?${params.toString()}`,
  );

  // Bulk select — admin/finance pueden pagar/anular en masa.
  const canBulk =
    (me?.allowed_actions.includes("oc:mark_paid") ?? false) ||
    (me?.allowed_actions.includes("oc:cancel") ?? false);
  const items = data?.items ?? [];
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const toggleId = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => {
    if (selectedIds.size === items.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map((i) => i.oc_id)));
  };
  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const empresaItems = useMemo<ComboboxItem[]>(
    () => [
      { value: "", label: "Todas las empresas" },
      ...empresas.map((e) => ({
        value: e.codigo,
        label: `${e.codigo} — ${e.razon_social}`,
      })),
    ],
    [empresas],
  );

  const estadoItems = useMemo<ComboboxItem[]>(
    () => [
      { value: "", label: "Todos los estados" },
      ...ESTADOS.map((s) => ({
        value: s,
        label: s.charAt(0).toUpperCase() + s.slice(1),
      })),
    ],
    [],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
              Órdenes de Compra
            </h1>
            <ScopeIndicator />
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {data
              ? `${data.total} orden${data.total !== 1 ? "es" : ""} en total`
              : "Cargando órdenes…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle: Lista (current) | Kanban (sub-route) */}
          <div className="inline-flex rounded-xl bg-ink-100/50 p-0.5 ring-1 ring-hairline">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-ink-900 shadow-card">
              <ListIcon className="h-4 w-4" strokeWidth={1.5} />
              Lista
            </span>
            <Link
              href={`/ordenes-compra/kanban${empresa ? `?empresa=${empresa}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:bg-white/60"
            >
              <LayoutGrid className="h-4 w-4" strokeWidth={1.5} />
              Kanban
            </Link>
          </div>
          <ExportExcelButton
            entity="ordenes_compra"
            empresaCodigo={empresa || null}
            estado={estado || null}
          />
          <Link
            href="/ordenes-compra/import"
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green dark:bg-ink-900 dark:text-ink-300"
            title="Importar OCs desde CSV (Excel chileno)"
          >
            <ArrowDownToLine className="h-4 w-4" strokeWidth={1.75} />
            Importar CSV
          </Link>
          <Link
            href="/ordenes-compra/importar"
            className="inline-flex items-center gap-1.5 rounded-xl border border-cehta-green/30 bg-gradient-to-r from-cehta-green/10 to-cehta-green/5 px-3 py-2 text-sm font-medium text-cehta-green hover:from-cehta-green/15 hover:to-cehta-green/10"
            title="Subí una cotización (PDF/imagen/Excel/email) y la IA precarga la OC"
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            Importar con IA
          </Link>
          <Link
            href="/ordenes-compra/desde-mensaje"
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green dark:bg-ink-900 dark:text-ink-300"
            title="Pegá un email, WhatsApp o texto y la IA arma la OC"
          >
            <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
            Desde mensaje
          </Link>
          <Link
            href="/ordenes-compra/nueva"
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Nueva OC
          </Link>
        </div>
      </div>

      {/* Round 10 — Quick filter chips (mismo pattern que /vouchers R9).
          Presets de uso diario aplicables en 1 click. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Vistas rápidas:
        </span>
        <button
          type="button"
          onClick={() => applyPreset("pendientes")}
          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
            estado === "pendiente"
              ? "bg-amber-50 text-amber-700 ring-amber-200"
              : "bg-white text-ink-600 ring-hairline hover:bg-ink-50"
          }`}
        >
          ⏳ Pendientes
        </button>
        <button
          type="button"
          onClick={() => applyPreset("emitidas")}
          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
            estado === "emitida"
              ? "bg-blue-50 text-blue-700 ring-blue-200"
              : "bg-white text-ink-600 ring-hairline hover:bg-ink-50"
          }`}
        >
          📤 Emitidas
        </button>
        <button
          type="button"
          onClick={() => applyPreset("borradores")}
          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
            estado === "borrador"
              ? "bg-ink-100 text-ink-700 ring-ink-200"
              : "bg-white text-ink-600 ring-hairline hover:bg-ink-50"
          }`}
        >
          ✏️ Borradores
        </button>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="ml-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-ink-500 ring-1 ring-hairline hover:bg-negative/5 hover:text-negative hover:ring-negative/20"
            title="Quitar todos los filtros aplicados"
          >
            ✕ Limpiar filtros
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs uppercase tracking-wide text-ink-500 font-medium">
            Empresa
          </label>
          <Combobox
            items={empresaItems}
            value={empresa}
            onValueChange={(v) => {
              setEmpresa(v);
              setPage(1);
            }}
            placeholder="Todas las empresas"
            triggerClassName="min-w-[14rem]"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs uppercase tracking-wide text-ink-500 font-medium">
            Estado
          </label>
          <Combobox
            items={estadoItems}
            value={estado}
            onValueChange={(v) => {
              setEstado(v);
              setPage(1);
            }}
            placeholder="Todos los estados"
            triggerClassName="min-w-[12rem]"
          />
        </div>

        <div className="ml-auto flex items-end">
          <SavedViewsMenu
            page="oc"
            currentFilters={{ empresa_codigo: empresa, estado }}
            onApply={(filters) => {
              setEmpresa(
                typeof filters.empresa_codigo === "string"
                  ? filters.empresa_codigo
                  : "",
              );
              setEstado(
                typeof filters.estado === "string" ? filters.estado : "",
              );
              setPage(1);
            }}
          />
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm font-medium text-negative">
            Error al cargar órdenes
          </p>
          <p className="mt-1 text-xs text-negative/80">{error?.message}</p>
        </Surface>
      )}

      {/* Loading state */}
      {isLoading && <TableSkeleton />}

      {/* Bulk action bar — sticky cuando hay selección */}
      {canBulk && selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          ids={Array.from(selectedIds)}
          endpoint="/ordenes-compra/bulk-update-estado"
          estados={OC_BULK_OPTIONS}
          invalidateKeys={[["ordenes-compra", String(page), empresa, estado]]}
          onClear={() => setSelectedIds(new Set())}
          entityLabel={{ singular: "OC", plural: "OCs" }}
        />
      )}

      {/* Table / empty state */}
      {data && !isLoading && (
        <>
          {data.items.length === 0 ? (
            <Surface padding="none" className="overflow-hidden">
              {/* Round 10 — smart empty con CTA segun contexto.
                  Si hay filtros activos: ofrece limpiarlos (caso comun).
                  Si la lista esta realmente vacia: ofrece crear primera OC. */}
              {hasActiveFilters ? (
                <div className="p-10 text-center">
                  <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-400">
                    <Package className="size-5" strokeWidth={1.5} />
                  </div>
                  <p className="text-sm font-medium text-ink-700">
                    Sin órdenes que matcheen
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-xs text-ink-500">
                    Probaste{" "}
                    {[
                      empresa && `empresa=${empresa}`,
                      estado && `estado=${estado}`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    . Ajustá los filtros o limpiá todo para ver la lista completa.
                  </p>
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-xs font-semibold text-white hover:bg-cehta-green-700"
                  >
                    Limpiar todos los filtros
                  </button>
                </div>
              ) : (
                <EmptyState
                  icon={Package}
                  title="Sin órdenes de compra todavía"
                  description="Creá tu primera OC para empezar a registrar compromisos de pago con proveedores."
                  action={{
                    label: "Nueva OC",
                    href: "/ordenes-compra/nueva",
                  }}
                  compact
                />
              )}
            </Surface>
          ) : (
            <Surface padding="none" className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-hairline text-sm">
                  {/* Round 10 — sticky header en lista de OCs (mismo pattern
                      que /vouchers R9). z-10 evita que se tape con badges. */}
                  <thead className="sticky top-0 z-10 bg-ink-100/90 backdrop-blur-sm">
                    <tr>
                      {COLUMNS.map((h, idx) => (
                        <th
                          key={`${h}-${idx}`}
                          className={`px-4 py-3 text-xs uppercase tracking-wide text-ink-500 font-medium ${
                            h === "Total" ? "text-right" : "text-left"
                          }`}
                        >
                          {h === "select" ? (
                            canBulk ? (
                              <input
                                type="checkbox"
                                aria-label="Seleccionar todas"
                                checked={allSelected}
                                ref={(el) => {
                                  if (el) el.indeterminate = someSelected;
                                }}
                                onChange={toggleAll}
                                className="h-4 w-4 cursor-pointer rounded border-hairline text-cehta-green focus:ring-cehta-green focus:ring-offset-0"
                              />
                            ) : null
                          ) : (
                            h
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {data.items.map((oc) => {
                      const checked = selectedIds.has(oc.oc_id);
                      return (
                      <tr
                        key={oc.oc_id}
                        className={`group transition-colors duration-150 ${
                          checked
                            ? "bg-cehta-green/5 hover:bg-cehta-green/10"
                            : "hover:bg-ink-100/30"
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3">
                          {canBulk && (
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar OC ${oc.numero_oc}`}
                              checked={checked}
                              onChange={() => toggleId(oc.oc_id)}
                              className="h-4 w-4 cursor-pointer rounded border-hairline text-cehta-green focus:ring-cehta-green focus:ring-offset-0"
                            />
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-ink-900">
                          {oc.numero_oc}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                          <div className="flex items-center gap-2">
                            <EmpresaLogo
                              empresaCodigo={oc.empresa_codigo}
                              size={22}
                            />
                            <span>{oc.empresa_codigo}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-700 tabular-nums">
                          {toDate(oc.fecha_emision)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                          {oc.moneda}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-ink-900 tabular-nums">
                          {oc.moneda === "CLP" ? toCLP(oc.total) : oc.total}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <EstadoBadge estado={oc.estado} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {oc.pdf_url && (
                              <a
                                href={oc.pdf_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
                                title="Ver PDF"
                              >
                                <FileText
                                  className="h-4 w-4"
                                  strokeWidth={1.5}
                                />
                              </a>
                            )}
                            <Link
                              href={`/ordenes-compra/${oc.oc_id}`}
                              // Round 10 — prefetch eager para nav instantanea.
                              prefetch={true}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-cehta-green transition-colors hover:bg-cehta-green/10"
                              title="Ver detalle"
                            >
                              Ver
                              <ExternalLink
                                className="h-3 w-3"
                                strokeWidth={1.5}
                              />
                            </Link>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
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
