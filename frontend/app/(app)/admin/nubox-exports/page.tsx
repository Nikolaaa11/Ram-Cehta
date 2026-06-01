"use client";

/**
 * /admin/nubox-exports
 *
 * Tracking de exportaciones a Nubox. Flujo:
 *   1. Generar batch (empresa + rango de fechas) → CSV con todos los
 *      vouchers APPROVED no exportados
 *   2. Descargar CSV → cargar en Nubox manualmente
 *   3. Volver acá → "Confirmar folios" ingresando los folios devueltos
 *      por Nubox para cada voucher
 *   4. Si algo sale mal → "Cancelar" libera los vouchers para re-export
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Hash,
  Plus,
  Send,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useModalA11y } from "@/lib/use-modal-a11y";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  NuboxBatch,
  NuboxBatchStatus,
  VoucherListItem,
} from "@/lib/api/schema";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

interface Empresa {
  codigo: string;
  razon_social: string;
}

const STATUS_META: Record<
  NuboxBatchStatus,
  { label: string; color: string }
> = {
  GENERATED: {
    label: "Generado",
    color: "bg-warning/10 text-warning ring-warning/20",
  },
  UPLOADED: {
    label: "En Nubox",
    color: "bg-blue-100 text-blue-700 ring-blue-200",
  },
  CONFIRMED: {
    label: "Confirmado",
    color: "bg-positive/10 text-positive ring-positive/20",
  },
  FAILED: {
    label: "Fallido",
    color: "bg-negative/10 text-negative ring-negative/20",
  },
  CANCELLED: {
    label: "Cancelado",
    color: "bg-ink-100 text-ink-500 ring-hairline",
  },
};

const fmtCLP = (v: number | null) => {
  if (v === null || v === undefined) return "—";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  return `$${v.toLocaleString("es-CL")}`;
};

export default function NuboxExportsPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [empresaFilter, setEmpresaFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<NuboxBatchStatus | "">("");
  const [showGenerate, setShowGenerate] = useState(false);
  const [confirmBatchId, setConfirmBatchId] = useState<number | null>(null);
  const [cancelBatchId, setCancelBatchId] = useState<number | null>(null);

  const { data: empresas } = useQuery<Empresa[]>({
    queryKey: ["empresas"],
    queryFn: () => apiClient.get<Empresa[]>("/empresa", session),
    enabled: !!session,
  });

  const { data: batches, isLoading } = useQuery<NuboxBatch[]>({
    queryKey: ["nubox-batches", empresaFilter, statusFilter],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (empresaFilter) qs.set("empresa_codigo", empresaFilter);
      if (statusFilter) qs.set("status", statusFilter);
      qs.set("limit", "100");
      return apiClient.get<NuboxBatch[]>(
        `/admin/nubox/export-batches?${qs}`,
        session,
      );
    },
    enabled: !!session,
  });

  const downloadBatch = async (batch: NuboxBatch) => {
    if (!session) return;
    try {
      const res = await fetch(
        `${API_BASE}/admin/nubox/export-batches/${batch.batch_id}/download`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, body?.detail ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = batch.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${batch.file_name} descargado`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "Error descargando archivo",
      );
    }
  };

  // KPIs derivados
  const kpis = useMemo(
    () =>
      (batches ?? []).reduce(
        (acc, b) => {
          if (b.status === "GENERATED") acc.pending++;
          if (b.status === "CONFIRMED") {
            acc.confirmed++;
            acc.totalConfirmedDebit += Number(b.total_debit);
          }
          acc.totalVouchers += b.voucher_count;
          return acc;
        },
        { pending: 0, confirmed: 0, totalVouchers: 0, totalConfirmedDebit: 0 },
      ),
    [batches],
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
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
              Sincronización Nubox · Vouchers aprobados
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-[40px] sm:leading-[1.1]">
              Exportación contable
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-600">
              Acumulá vouchers APPROVED en un batch CSV con formato Nubox,
              cargalo manualmente en el sistema contable, y volvé acá a
              ingresar los folios devueltos. La trazabilidad queda completa.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowGenerate(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700"
          >
            <Send className="h-4 w-4" strokeWidth={2.25} />
            Generar batch
          </button>
        </header>

        {/* KPIs */}
        {batches && batches.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi
              label="Pendientes"
              value={String(kpis.pending)}
              hint="Generados sin confirmar"
              tone={kpis.pending > 0 ? "warning" : "ink"}
            />
            <Kpi
              label="Confirmados"
              value={String(kpis.confirmed)}
              hint="Sincronizados con Nubox"
              tone="cehta"
            />
            <Kpi
              label="Vouchers totales"
              value={String(kpis.totalVouchers)}
              hint="En todos los batches"
            />
            <Kpi
              label="Sincronizado"
              value={fmtCLP(kpis.totalConfirmedDebit)}
              hint="Suma debe en confirmados"
              tone="cehta"
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
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as NuboxBatchStatus | "")
            }
            className="rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <option value="">Todos los estados</option>
            {(Object.keys(STATUS_META) as NuboxBatchStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </select>
        </div>

        {/* Lista — QA fix: skeleton matching layout (batches con info compact) */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-white p-3"
              >
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="ml-auto h-3 w-32" />
                <Skeleton className="h-7 w-16 rounded-lg" />
              </div>
            ))}
          </div>
        ) : !batches || batches.length === 0 ? (
          empresaFilter || statusFilter ? (
            <p className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-ink-500">
              Sin resultados con esos filtros.
            </p>
          ) : (
            <AdminEmptyState
              icon={<FileSpreadsheet strokeWidth={1.5} />}
              eyebrow="Exportaciones · Sin batches"
              title="Generá tu primera exportación a Nubox"
              body="Cuando tengas vouchers en estado APPROVED, generá un batch eligiendo empresa y rango de fechas. La app crea un CSV con formato Nubox listo para cargar."
              ctaLabel="Generar primer batch"
              onCta={() => setShowGenerate(true)}
              hint="El CSV usa separador ';' y BOM UTF-8 para que Excel chileno lo abra correctamente."
            />
          )
        ) : (
          <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
            <table className="w-full text-sm">
              <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-4 py-3">Batch · Empresa</th>
                  <th className="px-4 py-3">Período</th>
                  <th className="px-4 py-3">Vouchers</th>
                  <th className="px-4 py-3 text-right">Σ Debe</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Generado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {batches.map((b) => {
                  const statusInfo = STATUS_META[b.status];
                  const canConfirm = b.status === "GENERATED";
                  const canCancel =
                    b.status === "GENERATED" || b.status === "FAILED";
                  return (
                    <tr key={b.batch_id} className="hover:bg-ink-50/40">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs text-ink-700">
                          #{b.batch_id} · {b.empresa_codigo}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-ink-400">
                          {b.file_name}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums text-ink-600">
                        {b.fecha_desde ?? "—"}
                        <br />
                        <span className="text-ink-400">→ {b.fecha_hasta ?? "abierto"}</span>
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-sm font-semibold tabular-nums">
                        {b.voucher_count}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {fmtCLP(Number(b.total_debit))}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${statusInfo.color}`}
                        >
                          {b.status === "CONFIRMED" && (
                            <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
                          )}
                          {(b.status === "FAILED" || b.status === "CANCELLED") && (
                            <AlertCircle className="h-3 w-3" strokeWidth={2.5} />
                          )}
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px] tabular-nums text-ink-500">
                        {new Date(b.generated_at).toLocaleDateString("es-CL")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => downloadBatch(b)}
                            title="Descargar CSV"
                            className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-500 hover:bg-cehta-green/10 hover:text-cehta-green"
                          >
                            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                          {canConfirm && (
                            <button
                              type="button"
                              onClick={() => setConfirmBatchId(b.batch_id)}
                              className="rounded-lg bg-cehta-green/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-cehta-green hover:bg-cehta-green/20"
                            >
                              Confirmar
                            </button>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => setCancelBatchId(b.batch_id)}
                              title="Cancelar"
                              className="inline-flex h-7 w-7 items-center justify-center rounded text-negative hover:bg-negative/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {showGenerate && (
          <GenerateBatchDialog
            empresas={empresas ?? []}
            onClose={() => setShowGenerate(false)}
            onCreated={() => {
              setShowGenerate(false);
              qc.invalidateQueries({ queryKey: ["nubox-batches"] });
            }}
          />
        )}

        {confirmBatchId !== null && (
          <ConfirmFoliosDialog
            batchId={confirmBatchId}
            onClose={() => setConfirmBatchId(null)}
            onSuccess={() => {
              setConfirmBatchId(null);
              qc.invalidateQueries({ queryKey: ["nubox-batches"] });
              qc.invalidateQueries({ queryKey: ["vouchers"] });
            }}
          />
        )}

        {cancelBatchId !== null && (
          <CancelBatchDialog
            batchId={cancelBatchId}
            onClose={() => setCancelBatchId(null)}
            onSuccess={() => {
              setCancelBatchId(null);
              qc.invalidateQueries({ queryKey: ["nubox-batches"] });
              qc.invalidateQueries({ queryKey: ["vouchers"] });
            }}
          />
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

// ---------------------------------------------------------------------
// Generate batch dialog
// ---------------------------------------------------------------------

function GenerateBatchDialog({
  empresas,
  onClose,
  onCreated,
}: {
  empresas: Empresa[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { session } = useSession();
  const [empresa, setEmpresa] = useState(empresas[0]?.codigo ?? "");
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const [fechaDesde, setFechaDesde] = useState(monthAgo);
  const [fechaHasta, setFechaHasta] = useState(today);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setLoading(true);
    try {
      const res = await apiClient.post<NuboxBatch>(
        "/admin/nubox/export-batch",
        {
          empresa_codigo: empresa,
          fecha_desde: fechaDesde || null,
          fecha_hasta: fechaHasta || null,
        },
        session,
      );
      toast.success(
        `Batch #${res.batch_id} generado · ${res.voucher_count} vouchers`,
        {
          description: `Total ${fmtCLP(Number(res.total_debit))}. Descarga el CSV y cargalo en Nubox.`,
          duration: 8000,
        },
      );
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Error", {
        duration: 8000,
      });
    } finally {
      setLoading(false);
    }
  };
  // Round 28 — focus trap + ESC + scroll lock para modal nubox-exports.
  const a11yRef = useModalA11y({ open: true, onClose });

  return (
    <div
      ref={a11yRef}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-600 hover:bg-ink-200"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Generar batch Nubox
        </h2>
        <p className="text-xs text-ink-500">
          Incluye todos los vouchers <strong>APPROVED</strong> de la empresa
          que aún no fueron exportados, dentro del rango de fechas.
        </p>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Empresa <span className="text-negative">*</span>
          </label>
          <select
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
            required
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            {empresas.map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo} — {e.razon_social}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              Fecha desde
            </label>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              Fecha hasta
            </label>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !empresa}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-60"
        >
          <Send className="h-4 w-4" strokeWidth={1.75} />
          {loading ? "Generando…" : "Generar CSV"}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------
// Confirm folios dialog
// ---------------------------------------------------------------------

function ConfirmFoliosDialog({
  batchId,
  onClose,
  onSuccess,
}: {
  batchId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { session } = useSession();
  const [folios, setFolios] = useState<Record<string, string>>({});
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(false);

  // Trae los vouchers del batch para que el COO ingrese folios
  const { data: vouchers } = useQuery<VoucherListItem[]>({
    queryKey: ["batch-vouchers", batchId],
    queryFn: async () => {
      // El backend no expone lista de vouchers del batch directamente.
      // Workaround: traer todos los vouchers EXPORTED y filtrar por batch
      // cuando tengamos el endpoint específico. Por ahora, hacemos GET de
      // todos los vouchers y dejamos al user marcar los del batch.
      const all = await apiClient.get<VoucherListItem[]>(
        `/vouchers?status=APPROVED&limit=200`,
        session,
      );
      // Como el backend ya marcó los del batch como EXPORTED via nubox_status,
      // y el voucher status sigue siendo APPROVED hasta el confirm, no podemos
      // filtrar a nivel cliente. Dejamos los APPROVED y el user reconoce los
      // del batch por código.
      return all;
    },
    enabled: !!session,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    const filledFolios = Object.fromEntries(
      Object.entries(folios).filter(([, v]) => v.trim() !== ""),
    );
    setLoading(true);
    try {
      await apiClient.post(
        `/admin/nubox/export-batches/${batchId}/confirm`,
        { folios: filledFolios, notas: notas.trim() || null },
        session,
      );
      const count = Object.keys(filledFolios).length;
      toast.success(
        count > 0
          ? `Batch confirmado · ${count} folios asignados`
          : "Batch confirmado sin folios individuales",
      );
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Error");
    } finally {
      setLoading(false);
    }
  };
  // Round 28 — focus trap + ESC + scroll lock para modal nubox-exports detail.
  const a11yRef = useModalA11y({ open: true, onClose });

  return (
    <div
      ref={a11yRef}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-hairline px-6 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Confirmar batch · #{batchId}
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold tracking-tight">
              Ingresar folios devueltos por Nubox
            </h2>
            <p className="mt-1 text-xs text-ink-500">
              Para cada voucher del batch, pegá el folio Nubox que te
              devolvió el sistema. Los vouchers con folio pasan a SYNCED.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-600 hover:bg-ink-200"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {!vouchers || vouchers.length === 0 ? (
            <p className="text-sm text-ink-500">Cargando vouchers…</p>
          ) : (
            <>
              <div className="rounded-xl border border-info/20 bg-info/5 p-3 text-[11px] text-ink-700">
                <p className="font-semibold">Tip:</p>
                <p className="mt-0.5">
                  Si solo querés marcar el batch como confirmado sin asignar
                  folios individuales, dejá los inputs vacíos y enviá. Los
                  folios se pueden agregar después por voucher.
                </p>
              </div>

              {vouchers.slice(0, 50).map((v) => (
                <div
                  key={v.voucher_id}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-ink-50/30 p-3"
                >
                  <Hash className="h-3.5 w-3.5 text-ink-400" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <code className="font-mono text-xs tabular-nums text-ink-700">
                      {v.codigo}
                    </code>
                    <p className="mt-0.5 truncate text-[11px] text-ink-500">
                      {v.glosa}
                    </p>
                  </div>
                  <input
                    type="text"
                    placeholder="Folio Nubox"
                    value={folios[v.codigo] ?? ""}
                    onChange={(e) =>
                      setFolios({ ...folios, [v.codigo]: e.target.value })
                    }
                    className="w-32 rounded-lg border-0 bg-white px-2 py-1.5 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                </div>
              ))}
            </>
          )}
        </div>

        <footer className="space-y-3 border-t border-hairline px-6 py-4">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              Notas del batch (opcional)
            </label>
            <input
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Ej: cargado correctamente · folios asignados por contador externo"
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
              {loading ? "Confirmando…" : "Confirmar batch"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------
// Cancel batch dialog
// ---------------------------------------------------------------------

function CancelBatchDialog({
  batchId,
  onClose,
  onSuccess,
}: {
  batchId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { session } = useSession();
  const [razon, setRazon] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    if (razon.trim().length < 10) {
      toast.error("La razón debe tener al menos 10 caracteres");
      return;
    }
    setLoading(true);
    try {
      await apiClient.post(
        `/admin/nubox/export-batches/${batchId}/cancel`,
        { razon: razon.trim() },
        session,
      );
      toast.success(
        "Batch cancelado · vouchers liberados para re-export",
      );
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Error");
    } finally {
      setLoading(false);
    }
  };
  // Round 28 — focus trap + ESC + scroll lock para modal nubox-exports retry.
  const a11yRef = useModalA11y({ open: true, onClose });

  return (
    <div
      ref={a11yRef}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-negative">
          <XCircle className="h-3.5 w-3.5" strokeWidth={2.25} />
          Cancelar batch · #{batchId}
        </div>
        <p className="text-sm text-ink-600">
          Cancelar este batch libera los vouchers que incluía: vuelven a
          aparecer como pendientes para el próximo batch. Útil si te
          equivocaste de empresa o rango de fechas.
        </p>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Razón (mín 10 caracteres) <span className="text-negative">*</span>
          </label>
          <textarea
            required
            minLength={10}
            value={razon}
            onChange={(e) => setRazon(e.target.value)}
            rows={3}
            placeholder="Ej: rango de fechas equivocado · regenerar con febrero excluido"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-negative"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || razon.trim().length < 10}
            className="inline-flex items-center gap-1.5 rounded-xl bg-negative px-4 py-2 text-sm font-semibold text-white hover:bg-negative/90 disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" strokeWidth={1.75} />
            {loading ? "Cancelando…" : "Cancelar batch"}
          </button>
          <Plus className="hidden" />
        </div>
      </form>
    </div>
  );
}
