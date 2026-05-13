"use client";

/**
 * /vouchers/[id]
 *
 * Detalle del voucher con:
 *   - Hero: codigo + tipo + status + threshold + reverso si aplica
 *   - Header del asiento (empresa, fechas, glosa, contraparte, doc tributario,
 *     banco, totales)
 *   - Tabla de líneas con imputación triple
 *   - Sync Nubox (folio + status si está)
 *   - Acciones según estado:
 *       DRAFT      → Editar / Enviar a aprobación / Eliminar
 *       PENDING    → Anular (con razón)
 *       APPROVED+  → Anular / Crear voucher de reverso
 *
 * Timeline mínimo: created → status actual con timestamps (placeholder
 * hasta tener tabla de approvals con datos reales).
 */
import type { Route } from "next";
import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileSignature,
  Printer,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { VoucherApprovalsCard } from "@/components/vouchers/VoucherApprovalsCard";
import { VoucherAttachmentsCard } from "@/components/vouchers/VoucherAttachmentsCard";
import { VoucherReconcileCard } from "@/components/vouchers/VoucherReconcileCard";
import type { VoucherFull, VoucherStatus, VoucherTipo } from "@/lib/api/schema";

const TIPO_LABEL: Record<VoucherTipo, string> = {
  INGRESO: "Ingreso",
  EGRESO: "Egreso",
  TRASPASO: "Traspaso",
  COMPRA: "Compra",
  VENTA: "Venta",
  APERTURA: "Apertura",
  CIERRE: "Cierre",
  REVERSO: "Reverso",
};

const SOURCE_LABELS: Record<string, { label: string; tone: string; title: string }> = {
  ai_import: {
    label: "Importado con IA",
    tone: "bg-sf-purple/10 text-sf-purple ring-sf-purple/20",
    title: "Extraído de imagen/PDF/PPT con Claude",
  },
  factura_pdf: {
    label: "Factura PDF",
    tone: "bg-sf-blue/10 text-sf-blue ring-sf-blue/20",
    title: "Extraído de PDF en Dropbox",
  },
  csv_bulk: {
    label: "CSV bulk",
    tone: "bg-cehta-green/10 text-cehta-green ring-cehta-green/20",
    title: "Cargado desde CSV/Excel",
  },
  template: {
    label: "Plantilla",
    tone: "bg-warning/10 text-warning ring-warning/20",
    title: "Generado desde plantilla recurrente",
  },
  nubox_form: {
    label: "Form Nubox",
    tone: "bg-ink-100 text-ink-700 ring-hairline",
    title: "Creado manualmente en el form Nubox",
  },
};

function renderSourceBadgeFull(source: string | null | undefined) {
  if (!source) return null;
  const meta = SOURCE_LABELS[source];
  if (!meta) return null;
  return (
    <span
      title={meta.title}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ring-1 ring-inset ${meta.tone}`}
    >
      {meta.label}
    </span>
  );
}

const STATUS_META: Record<VoucherStatus, { label: string; color: string }> = {
  DRAFT: { label: "Borrador", color: "bg-ink-100 text-ink-600 ring-hairline" },
  PENDING: { label: "Pendiente", color: "bg-warning/10 text-warning ring-warning/20" },
  APPROVED: { label: "Aprobado", color: "bg-positive/10 text-positive ring-positive/20" },
  EXECUTED: { label: "Ejecutado", color: "bg-cyan-100 text-cyan-700 ring-cyan-200" },
  SYNCED: { label: "Sync Nubox", color: "bg-blue-100 text-blue-700 ring-blue-200" },
  RECONCILED: { label: "Conciliado", color: "bg-emerald-100 text-emerald-700 ring-emerald-200" },
  CLOSED: { label: "Cerrado", color: "bg-ink-200 text-ink-700 ring-hairline" },
  REJECTED: { label: "Rechazado", color: "bg-negative/10 text-negative ring-negative/20" },
  VOID: { label: "Anulado", color: "bg-negative/5 text-negative/70 ring-negative/10" },
};

const fmt = (v: number, moneda: string) =>
  `${moneda === "CLP" ? "$" : moneda + " "}${v.toLocaleString("es-CL")}`;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function VoucherDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const voucherId = Number(id);
  const { session } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [showVoid, setShowVoid] = useState(false);

  const { data: voucher, isLoading } = useQuery<VoucherFull>({
    queryKey: ["voucher", voucherId],
    queryFn: () =>
      apiClient.get<VoucherFull>(`/vouchers/${voucherId}`, session),
    enabled: !!session && !!voucherId,
  });

  const submitMut = useMutation({
    mutationFn: async () =>
      apiClient.post<{ codigo: string; new_status: string }>(
        `/vouchers/${voucherId}/submit`,
        {},
        session,
      ),
    onSuccess: (r) => {
      toast.success(`Voucher ${r.codigo} enviado a aprobación`);
      qc.invalidateQueries({ queryKey: ["voucher", voucherId] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo enviar",
        { duration: 8000 },
      );
    },
  });

  const deleteMut = useMutation({
    mutationFn: async () =>
      apiClient.delete<void>(`/vouchers/${voucherId}`, session),
    onSuccess: () => {
      toast.success("Voucher eliminado");
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      router.push("/vouchers" as Route);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "No se pudo eliminar");
    },
  });

  if (isLoading || !voucher) {
    return (
      <div className="mx-auto max-w-[1280px] px-6 py-12">
        <p className="text-sm text-ink-500">Cargando voucher…</p>
      </div>
    );
  }

  const meta = STATUS_META[voucher.status];
  const isBalanced =
    Number(voucher.total_debit) === Number(voucher.total_credit);

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

      <div className="mx-auto max-w-[1280px] px-6 lg:px-10 pt-8 pb-20 space-y-6 print:max-w-full print:px-0 print:py-0">
        {/* Breadcrumb */}
        <Link
          href={"/vouchers" as Route}
          className="group inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-400 hover:text-cehta-green print:hidden"
        >
          <ArrowLeft
            className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5"
            strokeWidth={2}
          />
          Volver a vouchers
        </Link>

        {/* Hero header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <code className="font-mono text-[11px] tabular-nums text-ink-500">
              {voucher.empresa_codigo}
            </code>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-[36px]">
              {voucher.codigo}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-600">{voucher.glosa}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full bg-cehta-green/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-cehta-green ring-1 ring-cehta-green/20">
                {TIPO_LABEL[voucher.tipo]}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ring-1 ring-inset ${meta.color}`}
              >
                {(voucher.status === "APPROVED" ||
                  voucher.status === "EXECUTED" ||
                  voucher.status === "RECONCILED") && (
                  <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
                )}
                {(voucher.status === "REJECTED" || voucher.status === "VOID") && (
                  <AlertCircle className="h-3 w-3" strokeWidth={2.5} />
                )}
                {voucher.status === "PENDING" && (
                  <Clock className="h-3 w-3" strokeWidth={2.5} />
                )}
                {meta.label}
              </span>
              {voucher.threshold_aplicado && (
                <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-yellow-800 ring-1 ring-yellow-200">
                  <Sparkles className="h-3 w-3" strokeWidth={2.5} />
                  Reforzado
                </span>
              )}
              {/* V5++ ola CE — Badge del origen del voucher. */}
              {renderSourceBadgeFull((voucher as VoucherFull & { source?: string | null }).source)}
              {voucher.reversal_of && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-700 ring-1 ring-slate-200">
                  <RotateCcw className="h-3 w-3" strokeWidth={2.5} />
                  Reverso de #{voucher.reversal_of}
                </span>
              )}
              {voucher.reversed_by && (
                <Link
                  href={`/vouchers/${voucher.reversed_by}` as Route}
                  className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-700 ring-1 ring-rose-200 hover:bg-rose-200"
                >
                  <RotateCcw className="h-3 w-3" strokeWidth={2.5} />
                  Reversado por #{voucher.reversed_by}
                </Link>
              )}
            </div>
          </div>

          {/* Acciones según status */}
          <div className="flex flex-wrap gap-2 print:hidden">
            {/* Imprimir / PDF — disponible siempre, también en DRAFT */}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green"
              title="Imprimir / Guardar como PDF (Ctrl+P)"
            >
              <Printer className="h-4 w-4" strokeWidth={1.75} />
              Imprimir / PDF
            </button>
            {/* V5++ ola AB: Guardar como plantilla — útil para vouchers
                recurrentes (sueldos, arriendos, servicios mensuales). */}
            <button
              type="button"
              onClick={async () => {
                const codigo = prompt(
                  "Código de la plantilla (ej: TPL-FONDO-SUELDO-CEO):",
                  `TPL-${voucher.empresa_codigo}-${voucher.tipo}-${voucher.voucher_id}`,
                );
                if (!codigo) return;
                const nombre = prompt(
                  "Nombre descriptivo de la plantilla:",
                  voucher.glosa.slice(0, 80),
                );
                if (!nombre) return;
                try {
                  const params = new URLSearchParams({ codigo, nombre });
                  await apiClient.post(
                    `/vouchers/templates/from-voucher/${voucher.voucher_id}?${params}`,
                    {},
                    session,
                  );
                  toast.success(`Plantilla "${nombre}" creada`);
                } catch (err) {
                  const msg = err instanceof ApiError ? err.detail : "Error";
                  toast.error(`Error: ${msg}`);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green dark:bg-ink-900 dark:text-ink-300"
              title="Guardar como plantilla para reusar en el futuro"
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.75} />
              Guardar plantilla
            </button>
            {voucher.status === "DRAFT" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        "Enviar este voucher a aprobación? Las líneas deben cuadrar y el voucher pasa a estado PENDING.",
                      )
                    ) {
                      submitMut.mutate();
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-60"
                  disabled={!isBalanced || submitMut.isPending}
                  title={!isBalanced ? "Las líneas no cuadran" : "Enviar"}
                >
                  <Send className="h-4 w-4" strokeWidth={1.75} />
                  Enviar a aprobación
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        `Eliminar voucher ${voucher.codigo}? Solo posible mientras DRAFT.`,
                      )
                    ) {
                      deleteMut.mutate();
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-negative/20 bg-white px-4 py-2 text-sm font-medium text-negative hover:bg-negative/5"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  Eliminar
                </button>
              </>
            )}
            {voucher.status !== "VOID" &&
              voucher.status !== "CLOSED" &&
              voucher.status !== "DRAFT" && (
                <button
                  type="button"
                  onClick={() => setShowVoid(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-negative/20 bg-white px-4 py-2 text-sm font-medium text-negative hover:bg-negative/5"
                >
                  <XCircle className="h-4 w-4" strokeWidth={1.75} />
                  Anular
                </button>
              )}
          </div>
        </header>

        {/* Header del asiento */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Asiento">
            <Field label="Empresa" value={voucher.empresa_codigo} mono />
            <Field
              label="Fecha documento"
              value={voucher.fecha_documento}
              mono
            />
            <Field
              label="Fecha contable"
              value={voucher.fecha_contable}
              mono
            />
            {voucher.fecha_ejecucion && (
              <Field
                label="Fecha ejecución"
                value={voucher.fecha_ejecucion}
                mono
              />
            )}
          </Card>

          {(voucher.contraparte_nombre || voucher.contraparte_rut) && (
            <Card title="Contraparte">
              <Field
                label="Tipo"
                value={voucher.contraparte_tipo ?? "—"}
              />
              <Field
                label="Nombre"
                value={voucher.contraparte_nombre ?? "—"}
              />
              <Field
                label="RUT"
                value={voucher.contraparte_rut ?? "—"}
                mono
              />
            </Card>
          )}

          {(voucher.doc_tributario_tipo &&
            voucher.doc_tributario_tipo !== "NA") && (
            <Card title="Documento tributario" tone="warning">
              <Field
                label="Tipo"
                value={voucher.doc_tributario_tipo}
              />
              <Field
                label="Folio"
                value={voucher.doc_tributario_folio ?? "—"}
                mono
              />
              {voucher.doc_tributario_sii_track_id && (
                <Field
                  label="Track ID SII"
                  value={voucher.doc_tributario_sii_track_id}
                  mono
                />
              )}
            </Card>
          )}

          {voucher.banco && (
            <Card title="Banco">
              <Field label="Banco" value={voucher.banco} />
              {voucher.banco_cuenta_alias && (
                <Field label="Cuenta" value={voucher.banco_cuenta_alias} />
              )}
            </Card>
          )}

          {voucher.nubox_folio && (
            <Card title="Sync Nubox" tone="info">
              <Field label="Folio Nubox" value={voucher.nubox_folio} mono />
              {voucher.nubox_synced_at && (
                <Field
                  label="Sync"
                  value={new Date(voucher.nubox_synced_at).toLocaleString("es-CL")}
                  mono
                />
              )}
              {voucher.nubox_status && (
                <Field label="Status" value={voucher.nubox_status} />
              )}
            </Card>
          )}
        </div>

        {/* Líneas */}
        <div className="overflow-hidden rounded-3xl border border-hairline bg-white shadow-card">
          <header className="flex items-baseline justify-between border-b border-hairline bg-ink-50/40 px-6 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Líneas debe / haber · imputación triple
            </p>
            <p className="text-[11px] text-ink-500">
              {voucher.lines.length} {voucher.lines.length === 1 ? "línea" : "líneas"}
            </p>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">Cuenta</th>
                  <th className="px-4 py-2">Proyecto</th>
                  <th className="px-4 py-2">Área</th>
                  <th className="px-4 py-2">Glosa</th>
                  <th className="px-4 py-2 text-right">Debe</th>
                  <th className="px-4 py-2 text-right">Haber</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {voucher.lines.map((l) => (
                  <tr key={l.line_id} className="hover:bg-ink-50/40">
                    <td className="px-4 py-2 text-xs tabular-nums text-ink-500">
                      {l.line_number}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {l.cuenta_codigo}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-600">
                      {l.proyecto_codigo ?? "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-600">
                      {l.area_codigo ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-600">
                      {l.descripcion ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                      {Number(l.debit) > 0
                        ? fmt(Number(l.debit), voucher.moneda)
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                      {Number(l.credit) > 0
                        ? fmt(Number(l.credit), voucher.moneda)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-900/20 bg-ink-50/40 font-semibold">
                  <td colSpan={5} className="px-4 py-3 text-right text-xs uppercase tracking-wider text-ink-500">
                    Totales
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-900">
                    {fmt(Number(voucher.total_debit), voucher.moneda)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-ink-900">
                    {fmt(Number(voucher.total_credit), voucher.moneda)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Aprobaciones (firma digital) */}
        {(voucher.status === "PENDING" ||
          voucher.status === "APPROVED" ||
          voucher.status === "EXECUTED" ||
          voucher.status === "SYNCED" ||
          voucher.status === "RECONCILED" ||
          voucher.status === "REJECTED") && (
          <VoucherApprovalsCard
            voucherId={voucher.voucher_id}
            voucherStatus={voucher.status}
          />
        )}

        {/* Conciliación bancaria (solo EXECUTED+) */}
        <VoucherReconcileCard voucher={voucher} />

        {/* Adjuntos (Dropbox) */}
        <VoucherAttachmentsCard
          voucherId={voucher.voucher_id}
          voucherStatus={voucher.status}
          voucherTipo={voucher.tipo}
        />

        {/* Razones de rechazo / void */}
        {voucher.rejection_reason && (
          <div className="rounded-2xl border border-negative/20 bg-negative/5 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-negative">
              Razón de rechazo
            </p>
            <p className="mt-1 text-sm text-ink-800">
              {voucher.rejection_reason}
            </p>
          </div>
        )}
        {voucher.void_reason && (
          <div className="rounded-2xl border border-negative/20 bg-negative/5 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-negative">
              Razón de anulación
            </p>
            <p className="mt-1 text-sm text-ink-800">{voucher.void_reason}</p>
          </div>
        )}

        {/* Modal void */}
        {showVoid && (
          <VoidDialog
            voucherId={voucherId}
            onClose={() => setShowVoid(false)}
            onSuccess={() => {
              setShowVoid(false);
              qc.invalidateQueries({ queryKey: ["voucher", voucherId] });
            }}
          />
        )}

        {/* Footer notarial — solo visible al imprimir.
            Refuerza la trazabilidad legal del PDF generado. */}
        <div className="hidden print:block mt-8 border-t border-ink-300 pt-4 text-[9pt]">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="font-semibold uppercase tracking-wider mb-1">
                Documento contable formal
              </p>
              <p className="text-ink-600">
                Voucher código:{" "}
                <span className="font-mono font-semibold">{voucher.codigo}</span>
              </p>
              <p className="text-ink-600">
                Empresa:{" "}
                <span className="font-mono font-semibold">
                  {voucher.empresa_codigo}
                </span>
              </p>
              <p className="text-ink-600">
                Estado:{" "}
                <span className="font-semibold">{voucher.status}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold uppercase tracking-wider mb-1">
                Verificación de integridad
              </p>
              <p className="text-ink-600 break-all">
                Generado:{" "}
                <span className="font-mono">
                  {new Date().toISOString().slice(0, 19)}Z
                </span>
              </p>
              <p className="text-ink-600">
                URL canonical:
              </p>
              <p className="font-mono text-[8pt] text-ink-500">
                cehta-capital.vercel.app/vouchers/{voucher.voucher_id}
              </p>
              <p className="mt-2 italic text-ink-500">
                Firmas SHA-256 disponibles en el sistema.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  children,
  tone = "ink",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "ink" | "warning" | "info";
}) {
  const accent =
    tone === "warning"
      ? "border-amber-200 bg-amber-50/40"
      : tone === "info"
        ? "border-blue-200 bg-blue-50/40"
        : "border-hairline bg-white";
  return (
    <div className={`rounded-3xl border ${accent} p-5 shadow-card`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
        {title}
      </p>
      <div className="mt-3 space-y-2.5">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline/40 pb-2 last:border-b-0">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
        {label}
      </span>
      <span
        className={`text-sm text-ink-800 ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function VoidDialog({
  voucherId,
  onClose,
  onSuccess,
}: {
  voucherId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { session } = useSession();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 10) {
      toast.error("La razón debe tener al menos 10 caracteres");
      return;
    }
    setLoading(true);
    try {
      await apiClient.post(
        `/vouchers/${voucherId}/void`,
        { reason: reason.trim() },
        session,
      );
      toast.success("Voucher anulado");
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
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
          <FileSignature className="h-3.5 w-3.5" strokeWidth={2.25} />
          Anular voucher
        </div>
        <p className="text-sm text-ink-600">
          La anulación es irreversible. El voucher queda en estado VOID con la
          razón registrada en el audit log. Para corregir un voucher en período
          cerrado, usá voucher de reverso.
        </p>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Razón (mín 10 caracteres)
            <span className="ml-0.5 text-negative">*</span>
          </label>
          <textarea
            required
            minLength={10}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Ej: Factura recibida con error de monto, se anula y emite asiento corregido"
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
            disabled={loading || reason.trim().length < 10}
            className="inline-flex items-center gap-1.5 rounded-xl bg-negative px-4 py-2 text-sm font-semibold text-white hover:bg-negative/90 disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" strokeWidth={1.75} />
            {loading ? "Anulando…" : "Anular"}
          </button>
        </div>
      </form>
    </div>
  );
}
