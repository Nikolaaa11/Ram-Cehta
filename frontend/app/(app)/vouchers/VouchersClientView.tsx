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
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Download,
  FileSignature,
  MessageSquare,
  FileText,
  Loader2,
  Plus,
  Receipt,
  Package,
  RotateCcw,
  Search,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useDebounce } from "@/hooks/use-debounce";
import { toast } from "@/components/ui/toast";
import { exportCsv, csvFilename } from "@/lib/csv-export";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { ScopeIndicator } from "@/components/shared/ScopeIndicator";
import { Currency } from "@/components/shared/Currency";
import type {
  CompanyRole,
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

const SOURCE_BADGES: Record<string, { label: string; color: string; title: string }> = {
  ai_import: {
    label: "IA",
    color: "bg-sf-purple/15 text-sf-purple ring-sf-purple/30",
    title: "Importado con IA desde imagen/PDF/PPT",
  },
  factura_pdf: {
    label: "PDF",
    color: "bg-sf-blue/15 text-sf-blue ring-sf-blue/30",
    title: "Extraído de factura PDF (flujo Dropbox)",
  },
  csv_bulk: {
    label: "CSV",
    color: "bg-cehta-green/15 text-cehta-green ring-cehta-green/30",
    title: "Importado desde CSV bulk",
  },
  template: {
    label: "Tpl",
    color: "bg-warning/15 text-warning ring-warning/30",
    title: "Creado desde plantilla recurrente",
  },
  nubox_form: {
    label: "Form",
    color: "bg-ink-200 text-ink-700 ring-hairline",
    title: "Creado en el form Nubox",
  },
};

function renderSourceBadge(source: string | null | undefined) {
  if (!source) return null;
  const meta = SOURCE_BADGES[source];
  if (!meta) return null;
  return (
    <span
      title={meta.title}
      className={`ml-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset ${meta.color}`}
    >
      {meta.label}
    </span>
  );
}

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
  const router = useRouter();
  // Round 8 — los filtros se persisten en la URL como query params.
  // Beneficio: refresh no pierde los filtros, los links se pueden compartir
  // ("mira los vouchers PENDING de CEHTA"), el browser back vuelve al
  // mismo estado, y bookmarks funcionan como saved views ad-hoc.
  const searchParams = useSearchParams();
  const [empresaFilter, setEmpresaFilter] = useState(
    () => searchParams.get("empresa") ?? "",
  );
  const [tipoFilter, setTipoFilter] = useState<VoucherTipo | "">(
    () => (searchParams.get("tipo") as VoucherTipo) ?? "",
  );
  const [estadoFilter, setEstadoFilter] = useState<VoucherStatus | "">(
    () => (searchParams.get("status") as VoucherStatus) ?? "",
  );
  // V5++ ola CE — Filtro por origen (manual / IA / CSV / template / etc.)
  const [sourceFilter, setSourceFilter] = useState<string>(
    () => searchParams.get("source") ?? "",
  );
  const [fechaDesde, setFechaDesde] = useState(
    () => searchParams.get("desde") ?? "",
  );
  const [fechaHasta, setFechaHasta] = useState(
    () => searchParams.get("hasta") ?? "",
  );
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");

  // Sync filters → URL (replaceState, no re-render forzado, no nueva
  // entry en history para no romper el boton back).
  useEffect(() => {
    const params = new URLSearchParams();
    if (empresaFilter) params.set("empresa", empresaFilter);
    if (tipoFilter) params.set("tipo", tipoFilter);
    if (estadoFilter) params.set("status", estadoFilter);
    if (sourceFilter) params.set("source", sourceFilter);
    if (fechaDesde) params.set("desde", fechaDesde);
    if (fechaHasta) params.set("hasta", fechaHasta);
    if (search.trim()) params.set("q", search.trim());
    const qs = params.toString();
    const url = qs ? `/vouchers?${qs}` : "/vouchers";
    window.history.replaceState(null, "", url);
  }, [
    empresaFilter,
    tipoFilter,
    estadoFilter,
    sourceFilter,
    fechaDesde,
    fechaHasta,
    search,
  ]);
  // Bulk approve state — checkbox visible cuando hay >=1 fila PENDING visible.
  // Iteramos POST /vouchers/{id}/approve en secuencia (no hay endpoint bulk
  // en el backend; mantenemos coherencia con el flujo manual de firma).
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkRole, setBulkRole] = useState<CompanyRole>("CONTADOR");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkComments, setBulkComments] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulkApprove = async (ids: number[]) => {
    if (!session) {
      toast.error("Sesión expirada");
      return;
    }
    setBulkRunning(true);
    const toastId = toast.loading(`Firmando 0/${ids.length} vouchers…`);
    let ok = 0;
    let skipped = 0;
    let errors = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        await apiClient.post(
          `/vouchers/${id}/approve`,
          {
            role: bulkRole,
            comments: bulkComments.trim() || undefined,
          },
          session,
        );
        ok++;
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          skipped++;
        } else {
          errors++;
          // eslint-disable-next-line no-console
          console.warn(`Bulk approve falló para voucher ${id}:`, e);
        }
      }
      toast.loading(
        `Firmando ${i + 1}/${ids.length} vouchers…`,
        { id: toastId },
      );
    }
    toast.dismiss(toastId);
    const summary = `${ok} firmados OK${
      skipped > 0 ? ` · ${skipped} omitidos (no eras el firmante elegible)` : ""
    }${errors > 0 ? ` · ${errors} con error` : ""}`;
    if (errors > 0) {
      toast.error(summary);
    } else if (skipped > 0) {
      toast.info(summary);
    } else {
      toast.success(summary);
    }
    setSelectedIds(new Set());
    setBulkConfirmOpen(false);
    setBulkComments("");
    setBulkRunning(false);
    qc.invalidateQueries({ queryKey: ["vouchers"] });
    qc.invalidateQueries({ queryKey: ["vouchers-kpis"] });
  };

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
    sourceFilter === "" &&
    fechaDesde === "" &&
    fechaHasta === "";

  const { data: vouchers, isLoading } = useQuery<VoucherListItem[]>({
    queryKey: [
      "vouchers",
      empresaFilter,
      tipoFilter,
      estadoFilter,
      sourceFilter,
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
      if (sourceFilter) qs.set("source", sourceFilter);
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
  // Round 6 — debounce 300ms para no spamear el endpoint server-side
  // mientras el user tipea. Antes cada keystroke (>=3 chars) hacia un
  // round-trip. Con 300ms, "voucher AAA" (10 chars) hace 1 fetch.
  const debouncedSearch = useDebounce(search.trim(), 300);
  // Para queries cortos o sin search, usamos el filtro local sobre la lista
  // ya cargada (rápido, sin round-trip).
  const useServerSearch = debouncedSearch.length >= 3;
  const { data: searchResults } = useQuery<VoucherListItem[]>({
    queryKey: ["vouchers-search", debouncedSearch],
    queryFn: () =>
      apiClient.get<VoucherListItem[]>(
        `/vouchers/search?q=${encodeURIComponent(debouncedSearch)}&limit=100`,
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

  // Bulk-approve derivations sobre la lista visible.
  const pendingVisible = useMemo(
    () => filteredVouchers.filter((v) => v.status === "PENDING"),
    [filteredVouchers],
  );
  const hasPendingVisible = pendingVisible.length > 0;
  const selectedTotal = useMemo(() => {
    let sum = 0;
    for (const v of filteredVouchers) {
      if (selectedIds.has(v.voucher_id)) {
        sum += Number(v.total_debit ?? 0);
      }
    }
    return sum;
  }, [filteredVouchers, selectedIds]);
  const allPendingSelected =
    hasPendingVisible &&
    pendingVisible.every((v) => selectedIds.has(v.voucher_id));
  const toggleSelectAllPending = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const everySelected = pendingVisible.every((v) =>
        next.has(v.voucher_id),
      );
      if (everySelected) {
        for (const v of pendingVisible) next.delete(v.voucher_id);
      } else {
        for (const v of pendingVisible) next.add(v.voucher_id);
      }
      return next;
    });
  };

  // V5++ ola CE — Stats de origen (widget de automatizacion).
  const { data: sourceStats } = useQuery<{
    by_source: Record<string, number>;
    total: number;
    automated_count: number;
    automated_pct: number;
  }>({
    queryKey: ["vouchers-stats-source"],
    queryFn: () =>
      apiClient.get("/vouchers/stats/by-source", session),
    enabled: !!session,
    staleTime: 60_000,
  });

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
              href={"/vouchers/importar" as Route}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cehta-green/30 bg-gradient-to-r from-cehta-green/10 to-cehta-green/5 px-3 py-2 text-sm font-medium text-cehta-green hover:from-cehta-green/15 hover:to-cehta-green/10"
              title="Subí una imagen, PDF, PPT, XLSX o EML y la IA precarga los campos"
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.75} />
              Importar con IA
            </Link>
            <Link
              href={"/vouchers/desde-mensaje" as Route}
              className="inline-flex items-center gap-1.5 rounded-xl border border-sf-blue/30 bg-gradient-to-r from-sf-blue/10 to-sf-blue/5 px-3 py-2 text-sm font-medium text-sf-blue hover:from-sf-blue/15 hover:to-sf-blue/10"
              title="Pegá un email, WhatsApp o cualquier texto y la IA arma el voucher"
            >
              <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
              Desde mensaje
            </Link>
            {/* Observaciones 13/05/2026: el form Nubox tiene TODAS las
                observaciones aplicadas (15 tipos UPPERCASE, Proveedor combobox,
                RUT auto, Plan de Cuenta, Total Neto + Total Bruto, sin DEBE/HABER).
                Lo promovemos a botón primario verde. El asiento manual queda
                como secundario para apertura/cierre/traspaso. */}
            <Link
              href={"/vouchers/nuevo" as Route}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green dark:bg-ink-900 dark:text-ink-300"
              title="Asiento manual (apertura, cierre, traspaso interno, sin factura)"
            >
              <FileSignature className="h-4 w-4" strokeWidth={1.75} />
              Asiento manual
            </Link>
            <Link
              href={"/vouchers/nubox" as Route}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700"
              title="Form Nubox — el flujo recomendado para facturas (Información Contable + Financiera con IVA automático)"
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

        {/* V5++ ola CE — Widget de automatización: counts por origen.
            Click en cada chip filtra source en la lista. */}
        {sourceStats && sourceStats.total > 0 && (
          <div className="rounded-2xl border border-hairline bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-ink-500">
                  Resumen de automatización
                </p>
                <p className="mt-0.5 text-2xl font-semibold tracking-tight text-ink-900">
                  {sourceStats.automated_pct}%
                  <span className="ml-2 text-sm font-normal text-ink-500">
                    de los vouchers fueron automatizados
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {sourceStats.automated_count} de {sourceStats.total} vienen
                  de IA, CSV, plantillas o factura PDF.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(sourceStats.by_source)
                  .filter(([k]) => k !== "__null__")
                  .map(([key, count]) => {
                    const labels: Record<string, string> = {
                      ai_import: "IA",
                      factura_pdf: "PDF",
                      csv_bulk: "CSV",
                      template: "Tpl",
                      nubox_form: "Form",
                      manual: "Manual",
                    };
                    const label = labels[key] ?? key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSourceFilter(key)}
                        title={`Filtrar por ${label}`}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset transition-colors ${
                          sourceFilter === key
                            ? "bg-cehta-green/15 text-cehta-green ring-cehta-green/30"
                            : "bg-ink-50 text-ink-700 ring-hairline hover:bg-ink-100"
                        }`}
                      >
                        <span className="font-semibold">{label}</span>
                        <span className="tabular-nums">{count}</span>
                      </button>
                    );
                  })}
                {sourceFilter && (
                  <button
                    type="button"
                    onClick={() => setSourceFilter("")}
                    className="text-xs text-ink-500 hover:text-ink-900 px-2"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </div>
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
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            title="Filtrar por origen del voucher"
          >
            <option value="">Todos los orígenes</option>
            <option value="ai_import">Importado con IA</option>
            <option value="nubox_form">Form Nubox</option>
            <option value="factura_pdf">Factura PDF</option>
            <option value="csv_bulk">CSV bulk</option>
            <option value="template">Plantilla</option>
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
              // Round 7 perf — SPA nav en vez de hard reload.
              // Apunta al form Nubox (default recomendado para facturas).
              router.push("/vouchers/nubox" as Route);
            }}
            hint="Antes de crear vouchers, asegurate de haber importado el plan de cuentas en /admin/etl."
          />
        ) : filteredVouchers.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-ink-500">
            Sin resultados con esos filtros.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
            {/* V5++ ola CJ — wrapper overflow-x para que la tabla no rompa
                el viewport en mobile (los contadores pueden mirar la lista
                desde celular). */}
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  {hasPendingVisible && (
                    <th className="w-8 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={allPendingSelected}
                        onChange={toggleSelectAllPending}
                        aria-label="Seleccionar todos los PENDING visibles"
                        title="Seleccionar todos los PENDING visibles"
                        className="h-3.5 w-3.5 rounded border-hairline text-cehta-green focus:ring-cehta-green"
                      />
                    </th>
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
                      // Round 7 perf — antes usabamos window.location.href que
                      // dispara hard navigation (pierde TanStack cache, full
                      // page reload, ~500ms+). Ahora router.push hace SPA nav
                      // instantanea. onMouseEnter dispara prefetch del bundle
                      // de la ruta /vouchers/[id] (Next.js cachea por 30s).
                      onClick={() => {
                        router.push(`/vouchers/${v.voucher_id}` as Route);
                      }}
                      onMouseEnter={() => {
                        router.prefetch(`/vouchers/${v.voucher_id}` as Route);
                      }}
                    >
                      {hasPendingVisible && (
                        <td className="w-8 px-3 py-3">
                          {v.status === "PENDING" && (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(v.voucher_id)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => toggleSelect(v.voucher_id)}
                              aria-label={`Seleccionar voucher ${v.codigo}`}
                              className="h-3.5 w-3.5 rounded border-hairline text-cehta-green focus:ring-cehta-green"
                            />
                          )}
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
                        {renderSourceBadge((v as VoucherListItem & { source?: string | null }).source)}
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
                      <td className="px-4 py-3 text-right">
                        <Currency
                          value={Number(v.total_debit)}
                          moneda={v.moneda}
                          size="sm"
                        />
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
            </div>{/* cierre overflow-x wrapper */}
          </div>
        )}
      </div>

      {/* Sticky bottom bulk-action bar — solo visible si hay PENDING en la
          lista filtrada Y hay items seleccionados. */}
      {hasPendingVisible && selectedIds.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-2xl border border-cehta-green/30 bg-white/95 px-4 py-3 shadow-elevated-lg ring-1 ring-cehta-green/10 backdrop-blur-md">
            <FileSignature
              className="h-4 w-4 text-cehta-green"
              strokeWidth={1.75}
            />
            <span className="text-sm font-semibold text-ink-900">
              {selectedIds.size} voucher
              {selectedIds.size === 1 ? "" : "s"} seleccionado
              {selectedIds.size === 1 ? "" : "s"}
            </span>
            <span className="text-xs text-ink-400">·</span>
            <span className="inline-flex items-center gap-1 text-xs text-ink-500">
              <span>Σ total:</span>
              <Currency value={selectedTotal} moneda="CLP" size="sm" />
            </span>
            <button
              type="button"
              onClick={() => setBulkConfirmOpen(true)}
              disabled={bulkRunning}
              className="ml-2 inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-semibold text-white shadow-card hover:bg-cehta-green-700 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
              Firmar todos
            </button>
            {/* Round 6: Bulk PDF — descarga N PDFs en un ZIP. Use case
                cierre mensual. Backend cap 50 IDs por request. */}
            <button
              type="button"
              onClick={async () => {
                if (!session) return;
                const ids = Array.from(selectedIds);
                if (ids.length === 0) return;
                if (ids.length > 50) {
                  toast.error("Máximo 50 vouchers por bulk PDF");
                  return;
                }
                const t = toast.loading(
                  `Generando ZIP con ${ids.length} PDFs (puede tardar ~${Math.ceil(ids.length * 2)}s)...`,
                );
                try {
                  const API_BASE =
                    process.env.NEXT_PUBLIC_API_URL ??
                    "https://cehta-backend.fly.dev/api/v1";
                  const res = await fetch(`${API_BASE}/vouchers/bulk-pdf`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                      voucher_ids: ids,
                      include_attachments: true,
                    }),
                  });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const okHeader = res.headers.get("X-Bulk-Succeeded");
                  const failHeader = res.headers.get("X-Bulk-Failed");
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `vouchers-bundle-${new Date().toISOString().slice(0, 10)}.zip`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                  const ok = okHeader ? `${okHeader} OK` : "ZIP descargado";
                  const fail =
                    failHeader && Number(failHeader) > 0
                      ? ` · ${failHeader} con error (revisá los .txt dentro del ZIP)`
                      : "";
                  toast.success(`${ok}${fail}`, { id: t });
                } catch (err) {
                  toast.error(
                    err instanceof Error
                      ? `No pude generar el ZIP: ${err.message}`
                      : "Error desconocido",
                    { id: t },
                  );
                }
              }}
              disabled={bulkRunning}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cehta-green/30 bg-white px-3 py-1.5 text-xs font-semibold text-cehta-green hover:bg-cehta-green/5 disabled:opacity-50"
              title="Descarga los PDFs de los vouchers seleccionados en un ZIP (con branding empresa + adjuntos)"
            >
              <Package className="h-3.5 w-3.5" strokeWidth={2} />
              Descargar PDFs
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkRunning}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-500 hover:bg-ink-100/60 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              Cancelar selección
            </button>
          </div>
        </div>
      )}

      {/* Modal de confirmación de firma masiva. */}
      {bulkConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 px-4 backdrop-blur-sm"
          onClick={() => {
            if (!bulkRunning) setBulkConfirmOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-hairline bg-white p-6 shadow-elevated-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-lg font-semibold tracking-tight text-ink-900">
              Firmar {selectedIds.size} voucher
              {selectedIds.size === 1 ? "" : "s"}
            </h2>
            <p className="mt-1 text-sm text-ink-600">
              Vas a firmar {selectedIds.size} voucher
              {selectedIds.size === 1 ? "" : "s"} como{" "}
              <span className="font-semibold text-cehta-green">{bulkRole}</span>
              . Los vouchers donde no seas el firmante elegible se omitirán
              automáticamente.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-ink-500">
                  Rol
                </span>
                <select
                  value={bulkRole}
                  onChange={(e) =>
                    setBulkRole(e.target.value as CompanyRole)
                  }
                  disabled={bulkRunning}
                  className="mt-1 w-full rounded-lg border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                >
                  <option value="CONTADOR">CONTADOR</option>
                  <option value="OPERADOR">OPERADOR</option>
                  <option value="TESORERIA">TESORERIA</option>
                  <option value="COO">COO</option>
                  <option value="GG">GG</option>
                  <option value="DIRECTOR">DIRECTOR</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wider text-ink-500">
                  Comentario (opcional, aplicado a todos)
                </span>
                <textarea
                  value={bulkComments}
                  onChange={(e) => setBulkComments(e.target.value)}
                  disabled={bulkRunning}
                  rows={3}
                  placeholder="Ej: Revisado · OK firma masiva fin de mes"
                  className="mt-1 w-full rounded-lg border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              </label>
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning ring-1 ring-warning/20">
                Σ total: <Currency value={selectedTotal} moneda="CLP" size="xs" />
                {" "}— esta acción queda firmada con tu usuario y no se puede
                deshacer.
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkConfirmOpen(false)}
                disabled={bulkRunning}
                className="rounded-lg border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => runBulkApprove(Array.from(selectedIds))}
                disabled={bulkRunning}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700 disabled:opacity-50"
              >
                {bulkRunning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                )}
                Confirmar firma
              </button>
            </div>
          </div>
        </div>
      )}
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
