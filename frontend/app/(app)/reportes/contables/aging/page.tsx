"use client";

/**
 * /reportes/contables/aging — Etapa G
 *
 * Aging report: cuentas por pagar agrupadas por edad de vencimiento.
 *
 * Layout:
 *   1. Header con selector empresa + fecha corte (default hoy)
 *   2. 5 KPI cards (buckets): Al día / 1-30d / 31-60d / 61-90d / +90d
 *      - Click filtra la tabla por ese bucket
 *   3. Tabla proveedores: razón social + total + monto por cada bucket
 *      - Highlight de bucket dominante en cada fila
 *      - Link al proveedor (si existe en catalogo) o al perfil
 *
 * Filosofia UX:
 *   - Verde = al dia, amber = 1-30, orange = 31-60, red = 61-90, red strong = 90+
 *   - El user ve de un vistazo "que tan vieja es mi deuda"
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Flame,
  Loader2,
  TrendingUp,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { Surface } from "@/components/ui/surface";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { toCLP } from "@/lib/format";

interface BucketTotal {
  bucket: string;
  count: number;
  total_clp: string; // Decimal serializado como string
}

interface AgingRow {
  contraparte_rut: string | null;
  contraparte_nombre: string | null;
  proveedor_id: number | null;
  total: string;
  al_dia: string;
  d_1_30: string;
  d_31_60: string;
  d_61_90: string;
  d_90_plus: string;
  voucher_count: number;
}

interface AgingResponse {
  fecha_corte: string;
  empresa_codigo: string | null;
  totales_por_bucket: BucketTotal[];
  total_general: string;
  proveedores: AgingRow[];
  total_proveedores: number;
}

type BucketKey =
  | "al_dia"
  | "d_1_30"
  | "d_31_60"
  | "d_61_90"
  | "d_90_plus"
  | "todos";

const BUCKET_META: Record<
  Exclude<BucketKey, "todos">,
  {
    label: string;
    short: string;
    color: string;
    bg: string;
    text: string;
    ring: string;
    icon: React.ElementType;
  }
> = {
  al_dia: {
    label: "Al día (no vencido)",
    short: "Al día",
    color: "green",
    bg: "bg-cehta-green/10",
    text: "text-cehta-green",
    ring: "ring-cehta-green/30",
    icon: CheckCircle2,
  },
  d_1_30: {
    label: "Vencido 1 a 30 días",
    short: "1-30d",
    color: "amber",
    bg: "bg-amber-50",
    text: "text-amber-700",
    ring: "ring-amber-200",
    icon: Clock,
  },
  d_31_60: {
    label: "Vencido 31 a 60 días",
    short: "31-60d",
    color: "orange",
    bg: "bg-orange-50",
    text: "text-orange-700",
    ring: "ring-orange-200",
    icon: AlertTriangle,
  },
  d_61_90: {
    label: "Vencido 61 a 90 días",
    short: "61-90d",
    color: "red",
    bg: "bg-red-50",
    text: "text-red-700",
    ring: "ring-red-200",
    icon: AlertTriangle,
  },
  d_90_plus: {
    label: "Vencido +90 días",
    short: "+90d",
    color: "red",
    bg: "bg-red-100",
    text: "text-red-800",
    ring: "ring-red-300",
    icon: Flame,
  },
};

export default function AgingReportPage() {
  const { session } = useSession();
  const { data: empresas = [] } = useCatalogoEmpresas();
  const today = new Date().toISOString().slice(0, 10);
  const [empresa, setEmpresa] = useState<string>("");
  const [fechaCorte, setFechaCorte] = useState<string>(today);
  const [bucketFilter, setBucketFilter] = useState<BucketKey>("todos");

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (empresa) p.set("empresa", empresa);
    if (fechaCorte) p.set("fecha_corte", fechaCorte);
    p.set("limit_proveedores", "200");
    return p.toString();
  }, [empresa, fechaCorte]);

  const { data, isLoading, error, refetch } = useQuery<AgingResponse>({
    queryKey: ["aging-report", empresa, fechaCorte],
    queryFn: () =>
      apiClient.get<AgingResponse>(
        `/reportes/contables/aging?${queryParams}`,
        session,
      ),
    enabled: !!session,
    staleTime: 5 * 60_000, // R152zz: datos institucionales cambian lentamente
  });

  // Filtrar filas por bucket activo
  const filteredRows = useMemo(() => {
    if (!data) return [];
    if (bucketFilter === "todos") return data.proveedores;
    return data.proveedores.filter(
      (r) => parseFloat(r[bucketFilter] || "0") > 0,
    );
  }, [data, bucketFilter]);

  // Export CSV
  const handleExportCsv = () => {
    if (!data) return;
    const headers = [
      "RUT",
      "Razón social",
      "Total",
      "Al día",
      "1-30 días",
      "31-60 días",
      "61-90 días",
      "+90 días",
      "# Vouchers",
    ];
    const rows = filteredRows.map((r) => [
      r.contraparte_rut ?? "",
      r.contraparte_nombre ?? "",
      r.total,
      r.al_dia,
      r.d_1_30,
      r.d_31_60,
      r.d_61_90,
      r.d_90_plus,
      String(r.voucher_count),
    ]);
    const csv = [headers, ...rows]
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell ?? "");
            return s.includes(",") || s.includes('"')
              ? `"${s.replace(/"/g, '""')}"`
              : s;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aging_${empresa || "todas"}_${fechaCorte}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white via-cehta-green/[0.04] to-orange-50/30 ring-1 ring-cehta-green/15 p-6 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-orange-200/40 blur-3xl"
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-3 py-1 ring-1 ring-cehta-green/20">
            <TrendingUp className="size-3.5 text-cehta-green" strokeWidth={2} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Etapa G · Aging report
            </p>
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
            Antigüedad de cuentas por pagar
          </h1>
          <p className="text-sm text-ink-500 mt-1 max-w-2xl">
            Vouchers <strong>APPROVED</strong> (COMPRA / EGRESO) agrupados
            por edad de vencimiento. Click en un bucket para filtrar la
            tabla. Ayuda a decidir qué pagar primero.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-hairline bg-white p-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Empresa
          </label>
          <select
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
            className="min-w-[12rem] rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <option value="">Todas las empresas (de mi scope)</option>
            {empresas.map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo} · {e.razon_social}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Fecha de corte
          </label>
          <input
            type="date"
            value={fechaCorte}
            max={today}
            onChange={(e) => setFechaCorte(e.target.value)}
            className="rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </div>
        <div className="ml-auto">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!data || filteredRows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
          >
            <Download className="size-3.5" />
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Loading / Error */}
      {isLoading && (
        <Surface className="p-10 text-center">
          <Loader2 className="mx-auto mb-3 size-6 animate-spin text-cehta-green" />
          <p className="text-sm text-ink-500">Calculando aging…</p>
        </Surface>
      )}

      {error && (
        <ErrorState
          title="No se pudo cargar el aging report"
          error={error as Error}
          onRetry={() => refetch()}
        />
      )}

      {/* Empty */}
      {!isLoading && !error && data && data.total_proveedores === 0 && (
        <EmptyState
          icon={Calendar}
          title="Sin cuentas por pagar"
          description={`A la fecha ${fechaCorte} no hay vouchers APPROVED tipo COMPRA/EGRESO en esta empresa. Si esperás ver datos, verificá que haya vouchers firmados.`}
        />
      )}

      {/* KPI buckets */}
      {!isLoading && !error && data && data.total_proveedores > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <BucketCard
              bucketKey="todos"
              label="Total general"
              count={data.proveedores.length}
              total={parseFloat(data.total_general)}
              active={bucketFilter === "todos"}
              onClick={() => setBucketFilter("todos")}
            />
            {data.totales_por_bucket.map((b) => {
              const meta = BUCKET_META[b.bucket as keyof typeof BUCKET_META];
              if (!meta) return null;
              return (
                <BucketCard
                  key={b.bucket}
                  bucketKey={b.bucket as BucketKey}
                  label={meta.short}
                  count={b.count}
                  total={parseFloat(b.total_clp)}
                  active={bucketFilter === b.bucket}
                  onClick={() => setBucketFilter(b.bucket as BucketKey)}
                  meta={meta}
                />
              );
            })}
          </div>

          {/* Tabla por proveedor */}
          <Surface padding="none" className="overflow-hidden">
            <div className="border-b border-hairline px-5 py-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-900">
                Desglose por proveedor
                {bucketFilter !== "todos" && (
                  <span className="ml-2 text-xs font-normal text-ink-500">
                    · filtrado por{" "}
                    {BUCKET_META[bucketFilter as keyof typeof BUCKET_META]?.short}
                  </span>
                )}
              </h3>
              <span className="text-[10px] text-ink-500">
                {filteredRows.length} de {data.total_proveedores}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-hairline text-sm">
                <thead className="sticky top-0 z-10 bg-ink-50/95 backdrop-blur-sm text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                  <tr>
                    <th className="px-4 py-3">Proveedor</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Al día</th>
                    <th className="px-4 py-3 text-right">1-30d</th>
                    <th className="px-4 py-3 text-right">31-60d</th>
                    <th className="px-4 py-3 text-right">61-90d</th>
                    <th className="px-4 py-3 text-right">+90d</th>
                    <th className="px-4 py-3 text-right"># Vouchers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {filteredRows.map((r, idx) => (
                    <ProveedorRow key={`${r.contraparte_rut}-${idx}`} r={r} />
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>
        </>
      )}
    </div>
  );
}

function BucketCard({
  bucketKey,
  label,
  count,
  total,
  active,
  onClick,
  meta,
}: {
  bucketKey: BucketKey;
  label: string;
  count: number;
  total: number;
  active: boolean;
  onClick: () => void;
  meta?: (typeof BUCKET_META)[keyof typeof BUCKET_META];
}) {
  const Icon = meta?.icon ?? TrendingUp;
  const isTodos = bucketKey === "todos";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl p-4 text-left ring-1 transition-all ${
        active
          ? meta
            ? `${meta.bg} ${meta.ring} shadow-sm`
            : "bg-cehta-green/10 ring-cehta-green/30 shadow-sm"
          : "bg-white ring-hairline hover:ring-cehta-green/30 hover:shadow-sm"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon
          className={`size-4 ${active && meta ? meta.text : isTodos ? "text-cehta-green" : "text-ink-500"}`}
          strokeWidth={1.75}
        />
        <span
          className={`text-xs font-medium ${active && meta ? meta.text : "text-ink-700"}`}
        >
          {label}
        </span>
      </div>
      <div
        className={`text-2xl font-semibold tabular-nums ${
          active && meta ? meta.text : "text-ink-900"
        }`}
      >
        {toCLP(total)}
      </div>
      <div className="text-[10px] text-ink-500 mt-1">
        {count} proveedor{count === 1 ? "" : "es"}
      </div>
    </button>
  );
}

function ProveedorRow({ r }: { r: AgingRow }) {
  const total = parseFloat(r.total);
  const al_dia = parseFloat(r.al_dia);
  const d_1_30 = parseFloat(r.d_1_30);
  const d_31_60 = parseFloat(r.d_31_60);
  const d_61_90 = parseFloat(r.d_61_90);
  const d_90_plus = parseFloat(r.d_90_plus);

  // Bucket dominante (mayor monto, excluyendo al_dia)
  const overdue = { d_1_30, d_31_60, d_61_90, d_90_plus };
  const dominantKey = Object.entries(overdue).reduce(
    (a, b) => (b[1] > a[1] ? b : a),
    ["", 0],
  )[0];

  const cell = (val: number, key?: string) => {
    const isDominant = key && key === dominantKey && val > 0;
    const meta = key ? BUCKET_META[key as keyof typeof BUCKET_META] : null;
    return (
      <td
        className={`px-4 py-3 text-right font-mono tabular-nums ${
          val > 0
            ? isDominant && meta
              ? `font-semibold ${meta.text}`
              : "text-ink-700"
            : "text-ink-300"
        }`}
      >
        {val > 0 ? toCLP(val) : "—"}
      </td>
    );
  };

  return (
    <tr className="hover:bg-ink-50/40">
      <td className="px-4 py-3">
        <div className="font-medium text-ink-900">
          {r.proveedor_id ? (
            <Link
              href={`/proveedores/${r.proveedor_id}` as Route}
              prefetch={true}
              className="inline-flex items-center gap-1 hover:text-cehta-green hover:underline"
            >
              {r.contraparte_nombre || (
                <span className="text-ink-500 italic">Sin nombre</span>
              )}
              <ExternalLink className="size-3 text-ink-300" />
            </Link>
          ) : (
            r.contraparte_nombre || (
              <span className="text-ink-500 italic">Sin nombre</span>
            )
          )}
        </div>
        {r.contraparte_rut && (
          <div className="text-[10px] font-mono text-ink-500">
            {r.contraparte_rut}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right font-semibold text-ink-900 tabular-nums">
        {toCLP(total)}
      </td>
      {cell(al_dia, "al_dia")}
      {cell(d_1_30, "d_1_30")}
      {cell(d_31_60, "d_31_60")}
      {cell(d_61_90, "d_61_90")}
      {cell(d_90_plus, "d_90_plus")}
      <td className="px-4 py-3 text-right text-ink-600 tabular-nums">
        {r.voucher_count}
      </td>
    </tr>
  );
}
