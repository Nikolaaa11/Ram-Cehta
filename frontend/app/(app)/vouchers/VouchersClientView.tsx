"use client";

/**
 * /vouchers — lista de comprobantes contables.
 *
 * Filtros: empresa + tipo + estado + fecha desde/hasta + contraparte_rut.
 * Tabla con: codigo, tipo (badge color), fecha contable, glosa, contraparte,
 * total, moneda, status (badge), threshold reforzado dot.
 *
 * Click en row → /vouchers/{id}
 * Botón "Nuevo voucher" → /vouchers/nuevo
 *
 * Apple-tier: hero editorial + KPIs + tabla con hover + filtros sticky.
 */
import type { Route } from "next";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Download,
  FileSignature,
  FileText,
  Loader2,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Sparkles,
  Wallet,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { exportCsv, csvFilename } from "@/lib/csv-export";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { ScopeIndicator } from "@/components/shared/ScopeIndicator";
import type {
  VoucherListItem,
  VoucherStatus,
  VoucherTipo,
} from "@/lib/api/schema";

interface Empresa {
  codigo: string;
  razon_social: string;
}

const TIPO_META: Record<
  VoucherTipo,
  { label: string; color: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }
> = {
  INGRESO: {
    label: "Ingreso",
    color: "bg-positive/10 text-positive ring-positive/20",
    icon: ArrowDownToLine,
  },
  EGRESO: {
    label: "Egreso",
    color: "bg-rose-100 text-rose-700 ring-rose-200",
    icon: ArrowUpFromLine,
  },
  TRASPASO: {
    label: "Traspaso",
    color: "bg-blue-100 text-blue-700 ring-blue-200",
    icon: ArrowUpFromLine,
  },
  COMPRA: {
    label: "Compra",
    color: "bg-amber-100 text-amber-700 ring-amber-200",
    icon: Receipt,
  },
  VENTA: {
    label: "Venta",
    color: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    icon: Receipt,
  },
  APERTURA: {
    label: "Apertura",
    color: "bg-purple-100 text-purple-700 ring-purple-200",
    icon: FileText,
  },
  CIERRE: {
    label: "Cierre",
    color: "bg-purple-100 text-purple-700 ring-purple-200",
    icon: FileText,
  },
  REVERSO: {
    label: "Reverso",
    color: "bg-slate-200 text-slate-700 ring-slate-300",
    icon: RotateCcw,
  },
};

const STATUS_META: Record<VoucherStatus, { label: string; color: string }> = {
  DRAFT: { label: "Borrador", color: "bg-ink-100 text-ink-600 ring-hairline" },
  PENDING: {
    label: "Pendiente",
    color: "bg-warning/10 text-warning ring-warning/20",
  },
  APPROVED: {
    label: "Aprobado",
    color: "bg-positive/10 text-positive ring-positive/20",
  },
  EXECUTED: {
    label: "Ejecutado",
    color: "bg-cyan-100 text-cyan-700 ring-cyan-200",
  },
  SYNCED: {
    label: "Sync Nubox",
    color: "bg-blue-100 text-blue-700 ring-blue-200",
  },
  RECONCILED: {
    label: "Conciliado",
    color: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  },
  CLOSED: {
    label: "Cerrado",
    color: "bg-ink-200 text-ink-700 ring-hairline",
  },
  REJECTED: {
    label: "Rechazado",
    color: "bg-negative/10 text-negative ring-negative/20",
  },
  VOID: {
    label: "Anulado",
    color: "bg-negative/5 text-negative/70 ring-negative/10",
  },
};

const fmt = (v: number, moneda: string) =>
  `${moneda === "CLP" ? "$" : moneda + " "}${v.toLocaleString("es-CL")}`;

interface Props {
  initialEmpresas?: Empresa[];
  initialVouchers?: VoucherListItem[];
}

export function VouchersClientView({
  initialEmpresas,
  initialVouchers,
}: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [empresaFilter, setEmpresaFilter] = useState("");
  const [tipoFilter, setTipoFilter] = useState<VoucherTipo | "">("");
  const [estadoFilter, setEstadoFilter] = useState<VoucherStatus | "">("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [search, setSearch] = useState("");
  // Bulk approve state — solo aparece cuando estado=PENDING está seleccionado
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkRole, setBulkRole] = useState<string>("CONTADOR");

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkApproveMut = useMutation({
    mutationFn: (payload: { voucher_ids: number[]; role: string }) =>
      apiClient.post<{
        total: number;
        succeeded: number;
        failed: number;
        items: { voucher_id: number; success: boolean; error: string | null }[];
      }>("/vouchers/bulk-approve", payload, session),
    onSuccess: (data) => {
      if (data.failed === 0) {
        toast.success(
          `${data.succeeded}/${data.total} vouchers firmados como ${bulkRole}`,
        );
      } else {
        toast.success(
          `${data.succeeded} firmados · ${data.failed} fallaron — revisar detalles en consola`,
        );
        // Mostramos los errores en consola para debug
        const errors = data.items.filter((i) => !i.success);
        // eslint-disable-next-line no-console
        console.warn("Bulk approve errors:", errors);
      }
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["vouchers-kpis"] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`Bulk approve falló: ${detail}`);
    },
  });

  const { data: empresas } = useQuery<Empresa[]>({
    queryKey: ["empresas"],
    queryFn: () => apiClient.get<Empresa[]>("/empresa", session),
    enabled: !!session,
    initialData: initialEmpresas,
    staleTime: 5 * 60 * 1000,
  });

  // Detectar si los filtros están en su estado inicial → usamos initialData
  const filtersAreDefault =
    empresaFilter === "" &&
    tipoFilter === "" &&
    estadoFilter === "" &&
    fechaDesde === "" &&
    fechaHasta === "";

  const { data: vouchers, isLoading } = useQuery<VoucherListItem[]>({
    queryKey: [
      "vouchers",
      empresaFilter,
      tipoFilter,
      estadoFilter,
      fechaDesde,
      fechaHasta,
    ],
    // V5++ perf: SSR ya trajo la lista sin filtros para el primer paint.
    // Solo aplicable si los filtros están vacíos — en cuanto el user
    // escribe, queryKey cambia y la lista se fetchea de cero.
    initialData: filtersAreDefault ? initialVouchers : undefined,
    queryFn: () => {
      const qs = new URLSearchParams();
      if (empresaFilter) qs.set("empresa_codigo", empresaFilter);
      if (tipoFilter) qs.set("tipo", tipoFilter);
      if (estadoFilter) qs.set("status", estadoFilter);
      if (fechaDesde) qs.set("fecha_desde", fechaDesde);
      if (fechaHasta) qs.set("fecha_hasta", fechaHasta);
      qs.set("limit", "200");
      return apiClient.get<VoucherListItem[]>(
        `/vouchers?${qs}`,
        session,
      );
    },
    enabled: !!session,
  });

  // V5++ ola V: full-text search server-side cuando el query tiene 3+ chars.
  // Para queries cortos o sin search, usamos el filtro local sobre la lista
  // ya cargada (rápido, sin round-trip).
  const useServerSearch = search.trim().length >= 3;
  const { data: searchResults } = useQuery<VoucherListItem[]>({
    queryKey: ["vouchers-search", search.trim()],
    queryFn: () =>
      apiClient.get<VoucherListItem[]>(
        `/vouchers/search?q=${encodeURIComponent(search.trim())}&limit=100`,
        session,
      ),
    enabled: !!session && useServerSearch,
    staleTime: 30_000,
  });

  // Filtro: si search >= 3 chars usa server (full-text Postgres tsvector
  // con stemming español + ranking por relevancia), si no, filtro local.
  const filteredVouchers = useMemo(() => {
    if (useServerSearch) return searchResults ?? [];
    if (!vouchers) return [];
    if (!search.trim()) return vouchers;
    const q = search.toLowerCase();
    return vouchers.filter(
      (v) =>
        v.codigo.toLowerCase().includes(q) ||
        v.glosa.toLowerCase().includes(q) ||
        (v.contraparte_nombre ?? "").toLowerCase().includes(q),
    );
  }, [vouchers, search, useServerSearch, searchResults]);

  // KPIs derivados
  const kpis = (vouchers ?? []).reduce(
    (acc, v) => {
      if (v.status === "DRAFT") acc.draft++;
      if (v.status === "PENDING") acc.pending++;
      if (v.status === "APPROVED" || v.status === "EXECUTED") acc.approved++;
      if (v.threshold_aplicado) acc.threshold++;
      acc.totalAmount += Number(v.total_debit ?? 0);
      return acc;
    },
    { draft: 0, pending: 0, approved: 0, threshold: 0, totalAmount: 0 },
  );

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[400px]"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 0%, rgba(35,108,79,0.05) 0%, transparent 65%)",
        }}
      />

      <div className="mx-auto max-w-[1280px] px-6 lg:px-10 pt-10 pb-20 space-y-6">
        {/* Hero + CTA */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
              Vouchers · Comprobantes contables
            </p>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-[40px] sm:leading-[1.1]">
                Asientos contables del portafolio
              </h1>
              <ScopeIndicator />
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-600">
              Registro debe/haber de cada operación con imputación triple{" "}
              <span className="font-mono">cuenta × proyecto × área</span>. La
              partida doble se valida en 3 capas (UI · API · trigger DB) — no
              hay forma de guardar descuadrado fuera de borrador.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!filteredVouchers.length) {
                  toast.error("Sin vouchers para exportar");
                  return;
                }
                exportCsv({
                  filename: csvFilename(
                    `vouchers_${empresaFilter || "all"}`,
                  ),
                  headers: [
                    "Código",
                    "Empresa",
                    "Tipo",
                    "Fecha contable",
                    "Glosa",
                    "Contraparte",
                    "Total débito",
                    "Total crédito",
                    "Moneda",
                    "Estado",
                  ],
                  rows: filteredVouchers.map((v) => [
                    v.codigo,
                    v.empresa_codigo,
                    v.tipo,
                    v.fecha_contable,
                    v.glosa,
                    v.contraparte_nombre ?? "",
                    v.total_debit,
                    v.total_credit,
                    v.moneda,
                    v.status,
                  ]),
                });
                toast.success(`${filteredVouchers.length} vouchers exportados`);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green"
              title="Exportar CSV (Excel chileno con BOM UTF-8)"
            >
              <Download className="h-4 w-4" strokeWidth={1.75} />
              Exportar CSV
            </button>
            <Link
              href={"/vouchers/import" as Route}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green dark:bg-ink-900 dark:text-ink-300"
              title="Importar vouchers desde CSV (Excel chileno)"
            >
              <ArrowDownToLine className="h-4 w-4" strokeWidth={1.75} />
              Importar CSV
            </Link>
            <Link
              href={"/vouchers/templates" as Route}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green dark:bg-ink-900 dark:text-ink-300"
              title="Plantillas para vouchers recurrentes (sueldos, arriendos, servicios)"
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.75} />
              Plantillas
            </Link>
            <Link
              href={"/vouchers/nubox" as Route}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cehta-green bg-cehta-green/5 px-3 py-2 text-sm font-medium text-cehta-green hover:bg-cehta-green/10"
              title="Form Nubox-style (Información Contable + Financiera)"
            >
              <FileSignature className="h-4 w-4" strokeWidth={1.75} />
              Form Nubox
            </Link>
            <Link
              href={"/vouchers/nuevo" as Route}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700"
            >
              <Plus className="h-4 w-4" strokeWidth={2.25} />
              Nuevo voucher
            </Link>
          </div>
        </header>

        {/* KPIs */}
        {vouchers && vouchers.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Borradores" value={String(kpis.draft)} hint="En edición" />
            <Kpi
              label="Pendientes"
              value={String(kpis.pending)}
              hint="Esperando firma"
              tone={kpis.pending > 0 ? "warning" : "ink"}
            />
            <Kpi
              label="Aprobados / Ejecutados"
              value={String(kpis.approved)}
              hint="Con asiento firmado"
              tone="cehta"
            />
            <Kpi
              label="Reforzados"
              value={String(kpis.threshold)}
              hint="Sobre umbral, doble firma"
            />
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-hairline bg-white p-4">
          <select
            value={empresaFilter}
            onChange={(e) => setEmpresaFilter(e.target.value)}
            className="rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <option value="">Todas las empresas</option>
            {(empresas ?? []).map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo}
              </option>
            ))}
          </select>
          <select
            value={tipoFilter}
            onChange={(e) => setTipoFilter(e.target.value as VoucherTipo | "")}
            className="rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <option value="">Todos los tipos</option>
            {(Object.keys(TIPO_META) as VoucherTipo[]).map((t) => (
              <option key={t} value={t}>
                {TIPO_META[t].label}
              </option>
            ))}
          </select>
          <select
            value={estadoFilter}
            onChange={(e) => setEstadoFilter(e.target.value as VoucherStatus | "")}
            className="rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <option value="">Todos los estados</option>
            {(Object.keys(STATUS_META) as VoucherStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="rounded-lg border-0 bg-ink-50 px-2 py-1.5 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
              title="Fecha desde"
            />
            <span className="text-xs text-ink-400">→</span>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className="rounded-lg border-0 bg-ink-50 px-2 py-1.5 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
              title="Fecha hasta"
            />
          </div>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" strokeWidth={1.75} />
            <input
              type="text"
              placeholder="Código, glosa o contraparte…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 pl-9 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
        </div>

        {/* Lista */}
        {isLoading ? (
          <p className="text-sm text-ink-500">Cargando vouchers…</p>
        ) : !vouchers || vouchers.length === 0 ? (
          <AdminEmptyState
            icon={<Wallet strokeWidth={1.5} />}
            eyebrow="Vouchers · Sin movimientos todavía"
            title="Empezá a registrar comprobantes"
            body="Cada operación contable (compra, venta, pago, traspaso) se registra como voucher con líneas debe/haber e imputación triple. La partida doble se valida automáticamente — no hay forma de guardar descuadrado fuera de borrador."
            ctaLabel="Crear primer voucher"
            onCta={() => {
              window.location.href = "/vouchers/nuevo";
            }}
            hint="Antes de crear vouchers, asegurate de haber importado el plan de cuentas en /admin/etl."
          />
        ) : filteredVouchers.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-ink-500">
            Sin resultados con esos filtros.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
            {/* Bulk approve toolbar — aparece cuando hay seleccionados.
                El checkbox por fila solo aparece cuando estadoFilter="PENDING". */}
            {estadoFilter === "PENDING" && selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-cehta-green/30 bg-cehta-green/5 px-4 py-3">
                <FileSignature
                  className="h-4 w-4 text-cehta-green"
                  strokeWidth={1.75}
                />
                <span className="text-sm font-semibold text-cehta-green">
                  {selectedIds.size} vouchers seleccionados
                </span>
                <span className="text-xs text-ink-500">
                  · Firmar como rol:
                </span>
                <select
                  value={bulkRole}
                  onChange={(e) => setBulkRole(e.target.value)}
                  className="rounded-lg border-0 bg-white px-3 py-1 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                >
                  <option value="CONTADOR">CONTADOR</option>
                  <option value="COO">COO</option>
                  <option value="CEO">CEO</option>
                  <option value="GP">GP (Director)</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    bulkApproveMut.mutate({
                      voucher_ids: Array.from(selectedIds),
                      role: bulkRole,
                    })
                  }
                  disabled={bulkApproveMut.isPending}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {bulkApproveMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2
                      className="h-3.5 w-3.5"
                      strokeWidth={1.75}
                    />
                  )}
                  Firmar todos
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-cehta-green/70 hover:text-cehta-green"
                >
                  Limpiar
                </button>
              </div>
            )}
            <table className="w-full text-sm">
              <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  {estadoFilter === "PENDING" && (
                    <th className="w-8 px-3 py-3"></th>
                  )}
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Glosa · Contraparte</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline" data-virtualized>
                {filteredVouchers.map((v) => {
                  const meta = TIPO_META[v.tipo];
                  const Icon = meta.icon;
                  const status = STATUS_META[v.status];
                  return (
                    <tr
                      key={v.voucher_id}
                      className={`cursor-pointer transition-colors hover:bg-ink-50/40 ${
                        selectedIds.has(v.voucher_id)
                          ? "bg-cehta-green/5"
                          : ""
                      }`}
                      onClick={() => {
                        window.location.href = `/vouchers/${v.voucher_id}`;
                      }}
                    >
                      {estadoFilter === "PENDING" && (
                        <td className="w-8 px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(v.voucher_id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleSelect(v.voucher_id)}
                            aria-label={`Seleccionar voucher ${v.codigo}`}
                            className="h-3.5 w-3.5 rounded border-hairline text-cehta-green focus:ring-cehta-green"
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <code className="font-mono text-xs tabular-nums text-ink-700">
                          {v.codigo}
                        </code>
                        {v.threshold_aplicado && (
                          <span
                            title="Voucher reforzado (sobre umbral)"
                            className="ml-1.5 inline-flex"
                          >
                            <Sparkles
                              className="h-3 w-3 text-yellow-500"
                              strokeWidth={2.25}
                            />
                          </span>
                        )}
                        <p className="mt-0.5 text-[10px] text-ink-400">
                          {v.empresa_codigo}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${meta.color}`}
                        >
                          <Icon className="h-3 w-3" strokeWidth={2.25} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums text-ink-600">
                        {v.fecha_contable}
                      </td>
                      <td className="px-4 py-3">
                        <p className="line-clamp-1 text-ink-900">
                          {v.glosa}
                        </p>
                        {v.contraparte_nombre && (
                          <p className="mt-0.5 line-clamp-1 text-[11px] text-ink-500">
                            {v.contraparte_nombre}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {fmt(Number(v.total_debit), v.moneda)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${status.color}`}
                        >
                          {(v.status === "APPROVED" || v.status === "EXECUTED" || v.status === "RECONCILED") && (
                            <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
                          )}
                          {(v.status === "REJECTED" || v.status === "VOID") && (
                            <AlertCircle className="h-3 w-3" strokeWidth={2.5} />
                          )}
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "ink" | "cehta" | "warning";
}) {
  const accent =
    tone === "cehta"
      ? "border-cehta-green/30 bg-cehta-green/5"
      : tone === "warning"
        ? "border-warning/30 bg-warning/5"
        : "border-hairline bg-white";
  const valueColor =
    tone === "cehta"
      ? "text-cehta-green"
      : tone === "warning"
        ? "text-warning"
        : "text-ink-900";
  return (
    <div className={`rounded-2xl border ${accent} p-4 shadow-card`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
        {label}
      </p>
      <p
        className={`mt-1 font-display text-2xl font-semibold tabular-nums ${valueColor}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-ink-500">{hint}</p>
    </div>
  );
}
