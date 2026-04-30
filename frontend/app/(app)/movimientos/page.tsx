"use client";

import { useMemo, useState } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  DatabaseZap,
} from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { useMe } from "@/hooks/use-me";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { MovimientoManualDialog } from "@/components/movimientos/MovimientoManualDialog";
import { toCLP, toDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Page, MovimientoRead } from "@/lib/api/schema";
import { ApiError } from "@/lib/api/client";

const EMPRESA_TODAS = "__todas__";

const RP_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "Real", label: "Real" },
  { value: "Proyectado", label: "Proyectado" },
];

const COLUMNS = [
  { key: "fecha", label: "Fecha", align: "left" as const },
  { key: "empresa", label: "Empresa", align: "left" as const },
  { key: "descripcion", label: "Descripción", align: "left" as const },
  { key: "concepto", label: "Concepto", align: "left" as const },
  { key: "abono", label: "Abono", align: "right" as const },
  { key: "egreso", label: "Egreso", align: "right" as const },
  { key: "saldo", label: "Saldo", align: "right" as const },
];

function formatSaldo(value: string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return "—";
  return toCLP(num);
}

function TableSkeleton() {
  return (
    <Surface padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-hairline text-sm">
          <thead className="bg-ink-100/40">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-4 py-3 text-xs uppercase tracking-wide text-ink-500 font-medium",
                    c.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-5 w-20 rounded-full" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-56" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-3 w-32" />
                </td>
                <td className="px-4 py-3 text-right">
                  <Skeleton className="ml-auto h-4 w-24" />
                </td>
                <td className="px-4 py-3 text-right">
                  <Skeleton className="ml-auto h-4 w-24" />
                </td>
                <td className="px-4 py-3 text-right">
                  <Skeleton className="ml-auto h-4 w-28" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

export default function MovimientosPage() {
  const currentYear = new Date().getFullYear();
  const { data: empresas = [] } = useCatalogoEmpresas();

  const [empresa, setEmpresa] = useState<string>(EMPRESA_TODAS);
  const [anio, setAnio] = useState<string>(String(currentYear));
  const [realProyectado, setRealProyectado] = useState<string>("");
  const [page, setPage] = useState(1);
  const SIZE = 50;

  const empresaItems = useMemo<ComboboxItem[]>(() => {
    const list: ComboboxItem[] = [
      { value: EMPRESA_TODAS, label: "Todas las empresas" },
    ];
    for (const e of empresas) {
      list.push({ value: e.codigo, label: `${e.codigo} — ${e.razon_social}` });
    }
    return list;
  }, [empresas]);

  const params = new URLSearchParams({ page: String(page), size: String(SIZE) });
  if (empresa && empresa !== EMPRESA_TODAS) params.set("empresa_codigo", empresa);
  if (anio) params.set("anio", anio);
  if (realProyectado) params.set("real_proyectado", realProyectado);

  const path = `/movimientos?${params.toString()}`;

  const { data, isLoading, error } = useApiQuery<Page<MovimientoRead>>(
    ["movimientos", empresa, anio, realProyectado, String(page)],
    path,
  );

  const isNotFound =
    error instanceof ApiError && (error.status === 404 || error.status === 422);

  const items = data?.items ?? [];
  const totalCount = data?.total ?? 0;

  const updateFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
            Movimientos
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {data
              ? `${totalCount.toLocaleString("es-CL")} movimiento${totalCount !== 1 ? "s" : ""} · abonos y egresos por empresa y período`
              : "Historial de abonos y egresos por empresa y período."}
          </p>
        </div>
        <ManualMovimientoCTA />
      </div>

      {/* Filters */}
      <Surface variant="glass" padding="compact">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-ink-500 font-medium">
              Empresa
            </span>
            <Combobox
              items={empresaItems}
              value={empresa}
              onValueChange={(v) => updateFilter(() => setEmpresa(v))}
              placeholder="Todas las empresas"
              searchPlaceholder="Buscar empresa…"
              emptyText="Sin empresas."
              triggerClassName="w-64"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-ink-500 font-medium">
              Año
            </span>
            <div className="relative">
              <Calendar
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300"
                strokeWidth={1.5}
              />
              <input
                type="number"
                value={anio}
                onChange={(e) => updateFilter(() => setAnio(e.target.value))}
                placeholder="Año"
                min={2020}
                max={2099}
                className="h-9 w-32 rounded-xl bg-white pl-9 pr-3 text-sm text-ink-900 ring-1 ring-hairline tabular-nums shadow-glass placeholder:text-ink-300 transition-shadow focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-ink-500 font-medium">
              Tipo
            </span>
            <div
              role="tablist"
              aria-label="Real o proyectado"
              className="inline-flex h-9 items-center rounded-xl bg-ink-100/60 p-1 ring-1 ring-hairline"
            >
              {RP_OPTIONS.map((opt) => {
                const active = realProyectado === opt.value;
                return (
                  <button
                    key={opt.value || "all"}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() =>
                      updateFilter(() => setRealProyectado(opt.value))
                    }
                    className={cn(
                      "inline-flex h-7 items-center rounded-lg px-3 text-xs font-medium transition-colors duration-150 ease-apple",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                      active
                        ? "bg-white text-ink-900 shadow-glass"
                        : "text-ink-500 hover:text-ink-900",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Surface>

      {/* Loading */}
      {isLoading && <TableSkeleton />}

      {/* Error real (no 404/422) */}
      {!isLoading && error && !isNotFound && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm font-medium text-negative">
            Error al cargar movimientos
          </p>
          <p className="mt-1 text-xs text-negative/80">
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
        </Surface>
      )}

      {/* Empty (404/422 ETL aún no corrió, o sin items) */}
      {!isLoading && !error && items.length === 0 && (
        <Surface className="py-16">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
              <DatabaseZap className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
            </div>
            <p className="text-base font-semibold text-ink-900">
              Sin movimientos para los filtros seleccionados
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              Probá ajustar el año, empresa o tipo. Si recién instalaste la
              plataforma, ejecuta el ETL primero.
            </p>
          </div>
        </Surface>
      )}

      {!isLoading && isNotFound && (
        <Surface className="py-16">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
              <DatabaseZap className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
            </div>
            <p className="text-base font-semibold text-ink-900">
              Sin datos de movimientos
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              El ETL todavía no ha corrido. Cuando se ejecute por primera vez,
              los movimientos aparecerán aquí.
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
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={cn(
                        "px-4 py-3 text-xs uppercase tracking-wide text-ink-500 font-medium",
                        c.align === "right" ? "text-right" : "text-left",
                      )}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {items.map((m) => {
                  const abono = Number(m.abono);
                  const egreso = Number(m.egreso);
                  return (
                    <tr
                      key={m.movimiento_id}
                      className="transition-colors duration-150 hover:bg-ink-100/30"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-ink-700 tabular-nums">
                        <Calendar
                          className="mr-1 inline h-3 w-3 text-ink-300"
                          strokeWidth={1.5}
                        />
                        {toDate(m.fecha)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge variant="neutral">{m.empresa_codigo}</Badge>
                      </td>
                      <td className="max-w-[22rem] truncate px-4 py-3 text-ink-900">
                        {m.descripcion ?? "—"}
                      </td>
                      <td className="max-w-[14rem] truncate px-4 py-3 text-xs text-ink-500">
                        {m.concepto_general ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-positive">
                        {abono > 0 ? `+${toCLP(abono)}` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium text-negative">
                        {egreso > 0 ? `-${toCLP(egreso)}` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-900">
                        {formatSaldo(m.saldo_contable)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-500 tabular-nums">
            Página {data.page} de {data.pages} · {data.total.toLocaleString("es-CL")} resultados
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

/**
 * Sub-componente que rendea el CTA "Nuevo movimiento manual" solo si el
 * user tiene scope `movimiento:create`. Disciplina 3: el frontend lee
 * `me.allowed_actions` server-derivado, no inventa permisos.
 */
function ManualMovimientoCTA() {
  const { data: me } = useMe();
  const canCreate = me?.allowed_actions?.includes("movimiento:create") ?? false;
  if (!canCreate) return null;
  return <MovimientoManualDialog />;
}
