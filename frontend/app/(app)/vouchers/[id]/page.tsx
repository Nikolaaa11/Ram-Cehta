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
  Copy,
  FileSignature,
  MessageCircle,
  Printer,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useModalA11y } from "@/lib/use-modal-a11y";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { handleSessionExpired } from "@/lib/api/session-handling";
import { voucherStatusLabel } from "@/lib/voucher-status";
import dynamic from "next/dynamic";
// R152yy — above-the-fold (críticos) eager:
import { VoucherApprovalsCard } from "@/components/vouchers/VoucherApprovalsCard";
import { VoucherAttachmentsCard } from "@/components/vouchers/VoucherAttachmentsCard";
import { VoucherNavigation } from "@/components/vouchers/VoucherNavigation";

// R152yy — below-the-fold lazy con skeleton.
// Estos 4 cards aparecen luego del scroll en /vouchers/[id]:
// Reconcile (solo si EXECUTED), Timeline, Anomalies (solo si hay), Comments.
// Beneficio: -50-70 kB del first-load del detalle voucher.
const CardSkeleton = ({ h = 200 }: { h?: number }) => (
  <div
    className="animate-pulse rounded-2xl bg-ink-100/40 ring-1 ring-hairline"
    style={{ height: h }}
  />
);
const VoucherReconcileCard = dynamic(
  () =>
    import("@/components/vouchers/VoucherReconcileCard").then((m) => ({
      default: m.VoucherReconcileCard,
    })),
  { ssr: false, loading: () => <CardSkeleton h={180} /> },
);
const VoucherTimelineCard = dynamic(
  () =>
    import("@/components/vouchers/VoucherTimelineCard").then((m) => ({
      default: m.VoucherTimelineCard,
    })),
  { ssr: false, loading: () => <CardSkeleton h={240} /> },
);
const VoucherAnomaliesCard = dynamic(
  () =>
    import("@/components/vouchers/VoucherAnomaliesCard").then((m) => ({
      default: m.VoucherAnomaliesCard,
    })),
  { ssr: false, loading: () => <CardSkeleton h={140} /> },
);
const VoucherCommentsCard = dynamic(
  () =>
    import("@/components/vouchers/VoucherCommentsCard").then((m) => ({
      default: m.VoucherCommentsCard,
    })),
  { ssr: false, loading: () => <CardSkeleton h={300} /> },
);
import { buildWaLink, waMessages } from "@/lib/whatsapp";
import { Currency } from "@/components/shared/Currency";
import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import type {
  VoucherAttachment,
  VoucherFull,
  VoucherStatus,
  VoucherTipo,
} from "@/lib/api/schema";

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

  const { data: voucher, isLoading, isError, error } = useQuery<VoucherFull>({
    queryKey: ["voucher", voucherId],
    queryFn: () =>
      apiClient.get<VoucherFull>(`/vouchers/${voucherId}`, session),
    enabled: !!session && !!voucherId,
    // V5++ ola CJ — no reintentar en 403/404 (queda spinner infinito si no).
    retry: (failureCount, err) => {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        return false;
      }
      return failureCount < 2;
    },
  });

  // V5++ ola CH fase 2: traer set de tipos afectos a IVA del backend para
  // calcular Total Bruto en la tabla de lineas (disciplina 1: no hardcode).
  // staleTime 30min — el catalogo cambia rara vez.
  const { data: formMeta } = useQuery<{
    tipos_documento_afectos_iva: string[];
  }>({
    queryKey: ["vouchers", "form-metadata-iva"],
    queryFn: () =>
      apiClient.get<{ tipos_documento_afectos_iva: string[] }>(
        "/vouchers/form-metadata",
        session,
      ),
    enabled: !!session,
    staleTime: 30 * 60_000,
  });

  // Round 72 — gating del boton "Enviar a aprobacion" cuando falta adjunto.
  // El query DEBE estar antes de cualquier early return (regla react-hooks).
  // Round 88 — movido aca para evitar "called conditionally" lint error
  // que rompia el build de Vercel.
  const { data: attachmentsList } = useQuery<VoucherAttachment[]>({
    queryKey: ["voucher-attachments", voucherId],
    queryFn: () =>
      apiClient.get<VoucherAttachment[]>(
        `/vouchers/${voucherId}/attachments`,
        session,
      ),
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

  // V5++ ola CJ — manejo correcto de error. Antes quedaba spinner infinito
  // si el voucher era de otra empresa (403) o no existía (404).
  if (isError) {
    const apiErr = error instanceof ApiError ? error : null;
    const status = apiErr?.status;
    return (
      <div className="mx-auto max-w-[800px] px-6 py-12">
        <Link
          href={"/vouchers" as Route}
          className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-cehta-green mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a vouchers
        </Link>
        <div className="rounded-3xl border border-negative/20 bg-negative/5 p-8 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-negative" />
          <h1 className="mt-3 text-xl font-semibold text-ink-900">
            {status === 403
              ? "Sin acceso a este voucher"
              : status === 404
                ? "Voucher no encontrado"
                : "No se pudo cargar el voucher"}
          </h1>
          <p className="mt-2 text-sm text-ink-600">
            {status === 403
              ? "Este voucher pertenece a una empresa a la que no tienes acceso. Si crees que es un error, contacta a Nicolás."
              : status === 404
                ? `El voucher con id ${voucherId} no existe. Quizás fue eliminado.`
                : apiErr?.detail || "Reintenta en unos segundos."}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !voucher) {
    return (
      <div className="mx-auto max-w-[1280px] px-6 lg:px-10 pt-8 pb-20 space-y-6">
        <Surface>
          <Skeleton className="h-7 w-72" />
          <Skeleton className="mt-2 h-4 w-48" />
        </Surface>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Surface key={i}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-32" />
            </Surface>
          ))}
        </div>
        <Surface padding="none">
          <div className="border-b border-hairline p-4">
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="p-4 space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        </Surface>
      </div>
    );
  }

  const meta = STATUS_META[voucher.status];
  // R152DDDDDD — Comparar con tolerancia + isFinite. Antes con null/undefined
  // daba NaN === NaN (false), haciendo aparecer vouchers cuadrados como
  // descuadrados en el badge. Tolerancia 0.01 porque montos CLP son enteros
  // pero hay casos USD/UF que llegan como floats.
  const _td = Number(voucher.total_debit ?? 0);
  const _tc = Number(voucher.total_credit ?? 0);
  const isBalanced =
    Number.isFinite(_td) && Number.isFinite(_tc) && Math.abs(_td - _tc) < 0.01;

  // Round 144 — gating de adjunto eliminado por decisión operativa.
  // Estas variables quedan en `false` permanente para no romper las
  // referencias en JSX más abajo sin tocar 3 lugares distintos.
  const missingTaxDoc = false;

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
        {/* Etapa B — header con breadcrumb + nav prev/next */}
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link
            href={"/vouchers" as Route}
            className="group inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-400 hover:text-cehta-green"
          >
            <ArrowLeft
              className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5"
              strokeWidth={2}
            />
            Volver a vouchers
          </Link>
          {/* Navegacion prev/next con shortcuts [ y ]. */}
          <VoucherNavigation voucherId={voucher.voucher_id} />
        </div>

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
            {/* Resumen prominente de montos (Bruto/Neto/IVA inline). */}
            {(() => {
              const tipo = voucher.doc_tributario_tipo;
              const aplicaIva =
                tipo &&
                voucher.moneda === "CLP" &&
                (formMeta?.tipos_documento_afectos_iva ?? []).includes(tipo);
              const neto = Number(voucher.total_debit);
              if (aplicaIva) {
                const iva = Math.round(neto * 0.19);
                const bruto = neto + iva;
                return (
                  <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                        Bruto
                      </span>
                      <Currency
                        value={bruto}
                        moneda={voucher.moneda}
                        size="lg"
                        tone="success"
                      />
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                        Neto
                      </span>
                      <Currency
                        value={neto}
                        moneda={voucher.moneda}
                        size="lg"
                      />
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                        IVA
                      </span>
                      <Currency
                        value={iva}
                        moneda={voucher.moneda}
                        size="lg"
                        tone="muted"
                      />
                    </div>
                  </div>
                );
              }
              return (
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                    Total
                  </span>
                  <Currency
                    value={neto}
                    moneda={voucher.moneda}
                    size="lg"
                  />
                </div>
              );
            })()}
          </div>

          {/* Acciones según status */}
          <div className="flex flex-wrap gap-2 print:hidden">
            {/* Observaciones 14/05/2026 — botón "Descargar PDF" con branding
                empresa + adjuntos anexados como páginas. */}
            <button
              type="button"
              onClick={async () => {
                if (!session) return;
                try {
                  const API_BASE =
                    process.env.NEXT_PUBLIC_API_URL ??
                    "http://localhost:8000/api/v1";
                  const t = toast.loading("Generando PDF con adjuntos...");
                  const res = await fetch(
                    `${API_BASE}/vouchers/${voucher.voucher_id}/pdf?include_attachments=true`,
                    {
                      headers: {
                        Authorization: `Bearer ${session.access_token}`,
                      },
                    },
                  );
                  if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                  }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `voucher-${voucher.codigo}.pdf`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                  toast.success("PDF descargado", { id: t });
                } catch (err) {
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : "No se pudo generar el PDF",
                  );
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700"
              title="Generar PDF con branding de la empresa + adjuntos anexados"
            >
              <Printer className="h-4 w-4" strokeWidth={1.75} />
              Descargar PDF
            </button>
            {/* Imprimir directo (sin merge de adjuntos) — fallback */}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green"
              title="Imprimir vista actual (sin adjuntos, usá Descargar PDF para incluirlos)"
            >
              <Printer className="h-4 w-4" strokeWidth={1.75} />
              Imprimir
            </button>
            {/* Skill nueva: Duplicar voucher (POST /vouchers/{id}/duplicate)
                Crea un DRAFT clon con todas las líneas/imputación, fechas
                hoy, status DRAFT. Use case: vouchers recurrentes. */}
            <button
              type="button"
              onClick={async () => {
                if (!session) return;
                if (
                  !confirm(
                    `¿Crear una copia DRAFT de ${voucher.codigo}?\n\nSe copian: líneas, cuentas, proyecto, área, contraparte y glosa.\nSe resetea: folio, fechas (hoy), status (DRAFT), aprobaciones.`,
                  )
                )
                  return;
                const t = toast.loading("Duplicando voucher...");
                try {
                  const result = await apiClient.post<{
                    voucher_id: number;
                    codigo: string;
                  }>(`/vouchers/${voucher.voucher_id}/duplicate`, {}, session);
                  toast.success(
                    `Copia ${result.codigo} creada en DRAFT — edita y envía a aprobación`,
                    { id: t },
                  );
                  router.push(`/vouchers/${result.voucher_id}` as Route);
                } catch (err) {
                  toast.error(
                    err instanceof ApiError
                      ? err.detail
                      : "No se pudo duplicar",
                    { id: t },
                  );
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cehta-green/30 bg-cehta-green/5 px-3 py-2 text-sm font-medium text-cehta-green hover:bg-cehta-green/10"
              title="Duplica el voucher como nuevo DRAFT (útil para vouchers recurrentes)"
            >
              <Copy className="h-4 w-4" strokeWidth={1.75} />
              Duplicar voucher
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
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green"
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
                  disabled={!isBalanced || missingTaxDoc || submitMut.isPending}
                  title={
                    !isBalanced
                      ? "Las líneas no cuadran"
                      : missingTaxDoc
                        ? `Voucher de ${TIPO_LABEL[voucher.tipo]} requiere al menos 1 factura/boleta adjunta antes de enviar. Subila en la sección "Adjuntos" más abajo.`
                        : "Enviar"
                  }
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
              {/* Round 10 — botón WhatsApp si el voucher está APPROVED+
                  y la contraparte tiene teléfono cargado. */}
              <ContraparteWhatsApp voucher={voucher} />
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
                    Totales (Neto)
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Currency
                      value={Number(voucher.total_debit)}
                      moneda={voucher.moneda}
                      size="2xl"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Currency
                      value={Number(voucher.total_credit)}
                      moneda={voucher.moneda}
                      size="2xl"
                    />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {/* V5++ ola CH fase 2: panel "Total con IVA" — solo aparece si el
              tipo de documento es afecto Y la moneda es CLP. Es informativo
              (read-only). El asiento contable sigue con Neto/Neto cuadrado;
              el bruto es el monto efectivamente pagado al proveedor. */}
          {(() => {
            const tipo = voucher.doc_tributario_tipo;
            const aplicaIva =
              tipo &&
              voucher.moneda === "CLP" &&
              (formMeta?.tipos_documento_afectos_iva ?? []).includes(tipo);
            if (!aplicaIva) return null;
            const neto = Number(voucher.total_debit);
            const iva = Math.round(neto * 0.19);
            const bruto = neto + iva;
            return (
              <div className="mt-4 rounded-xl bg-cehta-green/5 ring-1 ring-cehta-green/20 p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] font-semibold text-cehta-green mb-2">
                  Total con IVA (informativo)
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-ink-500">Neto</div>
                    <div className="font-mono font-medium tabular-nums">
                      {fmt(neto, voucher.moneda)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-500">IVA (19%)</div>
                    <div className="font-mono font-medium tabular-nums">
                      {fmt(iva, voucher.moneda)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-ink-500">Bruto</div>
                    <div className="font-mono font-semibold tabular-nums text-cehta-green">
                      {fmt(bruto, voucher.moneda)}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-ink-500">
                  El asiento contable cuadra a nivel Neto. El IVA viaja por
                  la cuenta de IVA Crédito Fiscal (cuenta 1-04-* ó 5-99-*).
                </p>
              </div>
            );
          })()}
        </div>

        {/* Aprobaciones (firma digital)
            Observaciones 14/05/2026 — antes solo se mostraba en PENDING+.
            Ahora también se muestra en DRAFT con preview del flujo que va
            a aplicar al hacer submit. Así Nicolás ve siempre la zona de
            aprobación. */}
        <VoucherApprovalsCard
          voucherId={voucher.voucher_id}
          voucherStatus={voucher.status}
        />
        {voucher.status === "DRAFT" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-800 space-y-1">
            <p>
              <strong className="font-semibold">Vista previa del flujo</strong>{" "}
              · este voucher está en borrador. Cuando lo envíes a aprobación con
              el botón{" "}
              <span className="font-semibold">
                &quot;Enviar a aprobación&quot;
              </span>
              , arranca el flujo de firmas y los aprobadores podrán firmar aquí
              mismo.
            </p>
            {missingTaxDoc && (
              <p className="font-semibold text-amber-900">
                ⚠ Antes de enviarlo necesitas subir al menos 1 factura/boleta
                en la sección <em>&quot;Adjuntos&quot;</em> de más abajo
                (requisito contable para vouchers de{" "}
                {TIPO_LABEL[voucher.tipo]}).
              </p>
            )}
          </div>
        )}

        {/* Conciliación bancaria (solo EXECUTED+) */}
        <VoucherReconcileCard voucher={voucher} />

        {/* V5++ ola CF — Documento origen: si el voucher tiene un dropbox_path
            (viene del flujo /vouchers/importar), mostrarlo como link clickable
            que abre el archivo en una pestaña nueva (URL temporal Dropbox 4h). */}
        {(() => {
          const dropboxPath = (voucher as unknown as { documento_dropbox_path?: string | null })
            .documento_dropbox_path;
          if (!dropboxPath) return null;
          const fileName = dropboxPath.split("/").pop() ?? dropboxPath;
          return (
            <DropboxOrigenCard
              voucherId={voucher.voucher_id}
              fileName={fileName}
              path={dropboxPath}
            />
          );
        })()}

        {/* Adjuntos (Dropbox) — Round 80: paso docTributarioTipo para que
            el card muestre el checklist de 3 docs si es Invoice. */}
        <VoucherAttachmentsCard
          voucherId={voucher.voucher_id}
          voucherStatus={voucher.status}
          voucherTipo={voucher.tipo}
          docTributarioTipo={voucher.doc_tributario_tipo}
        />

        {/* Etapa H — Anomaly detection card. Solo se renderiza si hay
            warnings (>= 1); para vouchers limpios no agrega ruido. */}
        <VoucherAnomaliesCard voucherId={voucher.voucher_id} />

        {/* Etapa M — Comments thread (discusion operativa). */}
        <VoucherCommentsCard voucherId={voucher.voucher_id} />

        {/* Etapa B — Timeline visual de la actividad del voucher. */}
        <VoucherTimelineCard voucherId={voucher.voucher_id} />

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
                <span className="font-semibold">
                  {voucherStatusLabel(voucher.status)}
                </span>
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

/**
 * Round 10 — ContraparteWhatsApp.
 * Si el voucher tiene contraparte_rut y la contraparte es un proveedor
 * en el catalogo CON telefono cargado, muestra un botón WhatsApp con
 * mensaje pre-llenado (apropiado al status del voucher: confirmar pago
 * si EXECUTED, recordatorio cobro si APPROVED, etc.).
 */
function ContraparteWhatsApp({
  voucher,
}: {
  voucher: VoucherFull;
}) {
  const { session } = useSession();
  const rut = voucher.contraparte_rut;
  const enabled = !!session && !!rut && rut.length >= 8;

  const { data: search } = useQuery<{
    rut_valid: boolean;
    exists: boolean;
    proveedor: { telefono?: string | null; contacto?: string | null } | null;
  }>({
    queryKey: ["proveedor-by-rut", rut],
    queryFn: () =>
      apiClient.get(
        `/proveedores/search-by-rut?rut=${encodeURIComponent(rut ?? "")}`,
        session,
      ),
    enabled,
    staleTime: 5 * 60_000,
  });

  if (!enabled || !search?.exists || !search.proveedor?.telefono) return null;

  // Mensaje según status del voucher.
  let text: string;
  if (voucher.status === "EXECUTED" || voucher.status === "SYNCED") {
    text = waMessages.confirmarTransferencia({
      nombre: search.proveedor.contacto || voucher.contraparte_nombre,
      monto: Number(voucher.total_credit ?? voucher.total_debit ?? 0),
      codigo: voucher.codigo,
      glosa: voucher.glosa,
    });
  } else {
    text = waMessages.contactarProveedor({
      contacto: search.proveedor.contacto || voucher.contraparte_nombre,
      asunto: `el voucher ${voucher.codigo}`,
    });
  }

  const waLink = buildWaLink(search.proveedor.telefono, text);
  if (!waLink) return null;

  return (
    <a
      href={waLink}
      target="_blank"
      rel="noreferrer"
      className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-[#1FB453]"
      title="Contactar al proveedor por WhatsApp con mensaje pre-armado"
      aria-label={`Enviar WhatsApp a ${voucher.contraparte_nombre}`}
    >
      <MessageCircle className="size-3" strokeWidth={2.5} />
      WhatsApp
    </a>
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
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "No se pudo anular el voucher. Reintenta en unos segundos.",
      );
    } finally {
      setLoading(false);
    }
  };
  // Round 25 — focus trap + ESC + body scroll lock para modal Anular.
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

/**
 * V5++ ola CF — Card del documento origen (Dropbox).
 *
 * Click "Abrir" llama GET /vouchers/{id}/origen-document-url que devuelve
 * una URL temporal de Dropbox (vence en 4h). Esa URL es publica (token en
 * el query string) asi que la abrimos directo en window.open — no
 * necesita header de auth, ya esta autorizado por el get_temporary_link.
 */
function DropboxOrigenCard({
  voucherId,
  fileName,
  path,
}: {
  voucherId: number;
  fileName: string;
  path: string;
}) {
  const { session } = useSession();
  const [loading, setLoading] = useState(false);

  async function handleOpen() {
    if (!session) {
      handleSessionExpired();
      return;
    }
    setLoading(true);
    try {
      const resp = await apiClient.get<{ file_name: string; url: string }>(
        `/vouchers/${voucherId}/origen-document-url`,
        session,
      );
      window.open(resp.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.detail
          : "No se pudo abrir el documento origen.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-sf-blue/20 bg-sf-blue/5 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-wider text-sf-blue mb-2">
            Documento origen
          </p>
          <p className="text-sm font-medium text-ink-900 break-all">
            📎 {fileName}
          </p>
          <p className="mt-1 text-xs text-ink-500 break-all">
            <code className="font-mono">{path}</code>
          </p>
          <p className="mt-2 text-xs text-ink-500">
            Archivo procesado con IA al crear este voucher. URL temporal
            válida 4 horas.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpen}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-sf-blue px-3.5 py-2 text-sm font-medium text-white hover:bg-sf-blue/90 disabled:opacity-60"
        >
          {loading ? "Generando…" : "Abrir →"}
        </button>
      </div>
    </div>
  );
}
