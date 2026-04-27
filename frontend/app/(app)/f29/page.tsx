"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useMe } from "@/hooks/use-me";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { F29RowActions } from "@/components/f29/F29RowActions";
import { toCLP, toDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Page, F29Read } from "@/lib/api/schema";

const EMPRESA_TODAS = "__todas__";
const ESTADO_TODOS = "__todos__";

const ESTADO_OPTIONS: ComboboxItem[] = [
  { value: ESTADO_TODOS, label: "Todos los estados" },
  { value: "pendiente", label: "Pendiente" },
  { value: "pagado", label: "Pagado" },
  { value: "vencido", label: "Vencido" },
  { value: "exento", label: "Exento" },
];

const ESTADO_VARIANT: Record<string, BadgeProps["variant"]> = {
  pendiente: "warning",
  pagado: "success",
  vencido: "danger",
  exento: "neutral",
};

const COLUMNS = [
  { key: "empresa", label: "Empresa", align: "left" as const },
  { key: "periodo", label: "Período tributario", align: "left" as const },
  { key: "vencimiento", label: "Vencimiento", align: "left" as const },
  { key: "monto", label: "Monto", align: "right" as const },
  { key: "estado", label: "Estado", align: "left" as const },
  { key: "fecha_pago", label: "Fecha pago", align: "left" as const },
  { key: "acciones", label: "", align: "right" as const },
];

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function VencimientoCell({ fecha }: { fecha: string }) {
  const days = daysUntil(fecha);
  let dotColor = "bg-ink-300";
  let label: string | null = null;
  if (days < 0) {
    dotColor = "bg-negative";
    label = `Vencido hace ${Math.abs(days)}d`;
  } else if (days <= 7) {
    dotColor = "bg-warning";
    label = days === 0 ? "Vence hoy" : `En ${days}d`;
  } else {
    label = `En ${days}d`;
  }
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn("inline-block h-1.5 w-1.5 rounded-full", dotColor)}
        aria-hidden="true"
      />
      <span className="tabular-nums text-ink-900">{toDate(fecha)}</span>
      <span className="text-xs text-ink-500">· {label}</span>
    </div>
  );
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
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-5 w-16 rounded-full" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-32" />
                </td>
                <td className="px-4 py-3 text-right">
                  <Skeleton className="ml-auto h-4 w-24" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-5 w-20 rounded-full" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                </td>
                <td className="px-4 py-3 text-right">
                  <Skeleton className="ml-auto h-7 w-32" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

export default function F29Page() {
  const { data: me } = useMe();
  const { data: empresas = [] } = useCatalogoEmpresas();
  const [empresa, setEmpresa] = useState<string>(EMPRESA_TODAS);
  const [estado, setEstado] = useState<string>(ESTADO_TODOS);

  const empresaItems = useMemo<ComboboxItem[]>(() => {
    const list: ComboboxItem[] = [
      { value: EMPRESA_TODAS, label: "Todas las empresas" },
    ];
    for (const e of empresas) {
      list.push({ value: e.codigo, label: `${e.codigo} — ${e.razon_social}` });
    }
    return list;
  }, [empresas]);

  const params = new URLSearchParams({ page: "1", size: "50" });
  if (empresa && empresa !== EMPRESA_TODAS) params.set("empresa_codigo", empresa);
  if (estado && estado !== ESTADO_TODOS) params.set("estado", estado);

  const path = `/f29?${params.toString()}`;

  const { data, isLoading, error } = useApiQuery<Page<F29Read>>(
    ["f29", empresa, estado],
    path,
  );

  const items = data?.items ?? [];
  // Disciplina 3: el frontend NUNCA decide permisos por sí mismo. Lee de
  // `allowed_actions` derivado server-side desde rbac.ROLE_SCOPES.
  const canCreateF29 = me?.allowed_actions.includes("f29:create") ?? false;
  const canUpdateF29 = me?.allowed_actions.includes("f29:update") ?? false;
  const canDeleteF29 = me?.allowed_actions.includes("f29:delete") ?? false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
            F29 / Tributario
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {data
              ? `${data.total.toLocaleString("es-CL")} obligación${data.total !== 1 ? "es" : ""} tributaria${data.total !== 1 ? "s" : ""}`
              : "Obligaciones tributarias mensuales por empresa."}
          </p>
        </div>
        {canCreateF29 && (
          <Link
            href="/f29/nuevo"
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Nueva F29
          </Link>
        )}
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
              onValueChange={setEmpresa}
              placeholder="Todas las empresas"
              searchPlaceholder="Buscar empresa…"
              emptyText="Sin empresas."
              triggerClassName="w-64"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-ink-500 font-medium">
              Estado
            </span>
            <Combobox
              items={ESTADO_OPTIONS}
              value={estado}
              onValueChange={setEstado}
              placeholder="Todos los estados"
              searchPlaceholder="Buscar estado…"
              emptyText="Sin estados."
              triggerClassName="w-48"
            />
          </div>
        </div>
      </Surface>

      {/* Loading */}
      {isLoading && <TableSkeleton />}

      {/* Error */}
      {!isLoading && error && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm font-medium text-negative">
            Error al cargar obligaciones F29
          </p>
          <p className="mt-1 text-xs text-negative/80">
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
        </Surface>
      )}

      {/* Empty */}
      {!isLoading && !error && items.length === 0 && (
        <Surface className="py-16">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
              <Receipt className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
            </div>
            <p className="text-base font-semibold text-ink-900">
              Sin obligaciones F29 registradas
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              {canCreateF29
                ? "Empezá registrando la primera obligación tributaria del período."
                : "Aún no se han registrado obligaciones tributarias."}
            </p>
            {canCreateF29 && (
              <Link
                href="/f29/nuevo"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
              >
                <Plus className="h-4 w-4" strokeWidth={1.5} />
                Registrar primera obligación
              </Link>
            )}
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
                {items.map((f) => {
                  const variant = ESTADO_VARIANT[f.estado] ?? "neutral";
                  const monto = f.monto_a_pagar ? Number(f.monto_a_pagar) : null;
                  return (
                    <tr
                      key={f.f29_id}
                      className="transition-colors duration-150 hover:bg-ink-100/30"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-ink-900">
                        {f.empresa_codigo}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge variant="info">{f.periodo_tributario}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <VencimientoCell fecha={f.fecha_vencimiento} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-900">
                        {monto !== null ? toCLP(monto) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={variant}>
                          {f.estado.charAt(0).toUpperCase() + f.estado.slice(1)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-700 tabular-nums">
                        {f.fecha_pago ? toDate(f.fecha_pago) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <F29RowActions
                          f29={f}
                          canUpdate={canUpdateF29}
                          canDelete={canDeleteF29}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Surface>
      )}
    </div>
  );
}
