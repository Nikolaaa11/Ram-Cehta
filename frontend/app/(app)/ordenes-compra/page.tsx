"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Package,
  Plus,
} from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { toCLP, toDate } from "@/lib/format";
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
  "N° OC",
  "Empresa",
  "Fecha",
  "Moneda",
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
            {Array.from({ length: 6 }).map((_, i) => (
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
  const [page, setPage] = useState(1);
  const [empresa, setEmpresa] = useState("");
  const [estado, setEstado] = useState("");
  const SIZE = 20;

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
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            Órdenes de Compra
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {data
              ? `${data.total} orden${data.total !== 1 ? "es" : ""} en total`
              : "Cargando órdenes…"}
          </p>
        </div>
        <Link
          href="/ordenes-compra/nueva"
          className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Nueva OC
        </Link>
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

      {/* Table / empty state */}
      {data && !isLoading && (
        <>
          {data.items.length === 0 ? (
            <Surface className="py-16">
              <div className="flex flex-col items-center text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
                  <Package
                    className="h-6 w-6 text-ink-300"
                    strokeWidth={1.5}
                  />
                </div>
                <p className="text-base font-semibold text-ink-900">
                  Sin órdenes con los filtros seleccionados
                </p>
                <p className="mt-1 text-sm text-ink-500">
                  Probá ajustar los filtros o creá una nueva OC.
                </p>
                <Link
                  href="/ordenes-compra/nueva"
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.5} />
                  Nueva OC
                </Link>
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
                    {data.items.map((oc) => (
                      <tr
                        key={oc.oc_id}
                        className="group transition-colors duration-150 hover:bg-ink-100/30"
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-ink-900">
                          {oc.numero_oc}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                          {oc.empresa_codigo}
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
