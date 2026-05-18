"use client";

/**
 * VoucherAttachmentsCard — gestión completa de adjuntos de un voucher.
 *
 * Funcionalidad:
 *   - Lista de adjuntos actuales (tipo + nombre + tamaño + click para abrir)
 *   - Click en adjunto → genera URL temporal Dropbox y abre en nueva pestaña
 *   - Botón "Adjuntar" si voucher en DRAFT/PENDING:
 *       * File picker oculto
 *       * Selector de tipo (Factura/Boleta/Contrato/etc.)
 *       * Upload con progress
 *   - Botón borrar por adjunto (solo DRAFT/PENDING)
 *   - Hint editorial: COMPRA/VENTA exigen al menos 1 doc tributario
 *
 * Backend:
 *   GET    /vouchers/{id}/attachments
 *   POST   /vouchers/{id}/attachments  (multipart, max 50MB)
 *   GET    /vouchers/{id}/attachments/{att}/url
 *   DELETE /vouchers/{id}/attachments/{att}
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Receipt,
  Trash2,
  Upload,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import type {
  VoucherAttachment,
  VoucherAttachmentLink,
  VoucherAttachmentTipo,
  VoucherStatus,
  VoucherTipo,
} from "@/lib/api/schema";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

const TIPOS: { value: VoucherAttachmentTipo; label: string }[] = [
  { value: "FACTURA", label: "Factura" },
  { value: "BOLETA", label: "Boleta" },
  { value: "CONTRATO", label: "Contrato" },
  { value: "COTIZACION", label: "Cotización" },
  { value: "TRANSFERENCIA", label: "Comprobante transferencia" },
  { value: "LIQUIDACION_SUELDO", label: "Liquidación de sueldo" },
  { value: "ACTA", label: "Acta" },
  { value: "RESPALDO_TECNICO", label: "Respaldo técnico" },
  // Round 80 — ciclo de importación. Se usan cuando el voucher tiene
  // doc_tributario_tipo = INVOICE (compra al exterior).
  { value: "INVOICE", label: "Invoice (proveedor extranjero)" },
  { value: "DIN", label: "DIN — Declaración de Ingreso (aduana)" },
  { value: "FACTURA_IMPORTACION", label: "Factura de Importación (DTE 914)" },
  { value: "PACKING_LIST", label: "Packing list" },
  { value: "BILL_OF_LADING", label: "B/L — Conocimiento de embarque" },
  { value: "AIRWAY_BILL", label: "AWB — Carta de porte aérea" },
  { value: "POLIZA_SEGURO", label: "Póliza de seguro internacional" },
  { value: "SWIFT_PAGO", label: "SWIFT — comprobante transferencia int." },
  { value: "CARTA_CREDITO", label: "Carta de crédito (LC)" },
  { value: "OTRO", label: "Otro" },
];

interface Props {
  voucherId: number;
  voucherStatus: VoucherStatus;
  voucherTipo: VoucherTipo;
  /** Round 80 — si el voucher es importación (doc_tributario_tipo='INVOICE')
   * mostramos guidance sobre los anexos requeridos (DIN + Factura Importación). */
  docTributarioTipo?: string | null;
}

const fmtSize = (bytes: number | null) => {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const iconForMime = (mime: string | null) => {
  if (!mime) return FileText;
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.includes("pdf")) return FileText;
  return Paperclip;
};

export function VoucherAttachmentsCard({
  voucherId,
  voucherStatus,
  voucherTipo,
  docTributarioTipo,
}: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  // Round 80 — si es importación, default INVOICE en el selector (UX).
  const isImport = docTributarioTipo === "INVOICE";
  const [uploadTipo, setUploadTipo] = useState<VoucherAttachmentTipo>(
    isImport ? "INVOICE" : "FACTURA",
  );
  const [uploading, setUploading] = useState(false);

  const canEdit = voucherStatus === "DRAFT" || voucherStatus === "PENDING";
  const requiresTaxDoc = voucherTipo === "COMPRA" || voucherTipo === "VENTA";

  const { data: attachments } = useQuery<VoucherAttachment[]>({
    queryKey: ["voucher-attachments", voucherId],
    queryFn: () =>
      apiClient.get<VoucherAttachment[]>(
        `/vouchers/${voucherId}/attachments`,
        session,
      ),
    enabled: !!session && !!voucherId,
  });

  const deleteMut = useMutation({
    mutationFn: async (attachmentId: number) =>
      apiClient.delete<void>(
        `/vouchers/${voucherId}/attachments/${attachmentId}`,
        session,
      ),
    onSuccess: () => {
      toast.success("Adjunto eliminado");
      qc.invalidateQueries({ queryKey: ["voucher-attachments", voucherId] });
      qc.invalidateQueries({ queryKey: ["voucher", voucherId] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo eliminar",
      );
    },
  });

  const handleFile = async (file: File) => {
    if (!session) return;
    setUploading(true);
    const toastId = toast.loading(`Subiendo ${file.name}...`);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tipo", uploadTipo);

      const res = await fetch(
        `${API_BASE}/vouchers/${voucherId}/attachments`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          body: fd,
          cache: "no-store",
        },
      );

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          detail = body?.detail ?? detail;
        } catch {
          // non-JSON
        }
        throw new ApiError(res.status, detail);
      }

      toast.success(`${file.name} subido`, { id: toastId });
      qc.invalidateQueries({ queryKey: ["voucher-attachments", voucherId] });
      qc.invalidateQueries({ queryKey: ["voucher", voucherId] });
    } catch (err) {
      const detail =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error desconocido";
      toast.error("No se pudo subir el adjunto", {
        id: toastId,
        description: detail,
        duration: 8000,
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const openAttachment = async (att: VoucherAttachment) => {
    if (!session) return;
    try {
      const link = await apiClient.get<VoucherAttachmentLink>(
        `/vouchers/${voucherId}/attachments/${att.attachment_id}/url`,
        session,
      );
      window.open(link.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo abrir el archivo",
      );
    }
  };

  return (
    <div className="rounded-3xl border border-hairline bg-white p-5 shadow-card">
      <header className="flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
          Adjuntos · Dropbox
        </p>
        <p className="text-[11px] text-ink-500">
          {(attachments ?? []).length}{" "}
          {(attachments ?? []).length === 1 ? "archivo" : "archivos"}
        </p>
      </header>

      {/* Hint COMPRA/VENTA — pide factura o boleta cuando NO es importación. */}
      {requiresTaxDoc && !isImport &&
        (attachments ?? []).filter(
          (a) => a.tipo === "FACTURA" || a.tipo === "BOLETA",
        ).length === 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
            <strong className="font-semibold">Atención:</strong> los vouchers
            de {voucherTipo === "COMPRA" ? "compra" : "venta"} requieren
            adjuntar al menos una factura o boleta antes de enviar a aprobación.
          </div>
        )}

      {/* Round 80 — Hint específico para IMPORTACIONES (Invoice). Lista los
          3 documentos que legalizan el Invoice en Chile + marca cuáles ya
          están subidos para que el operador sepa qué le falta. */}
      {isImport && (() => {
        const tieneInvoice = (attachments ?? []).some((a) => a.tipo === "INVOICE");
        const tieneDIN = (attachments ?? []).some((a) => a.tipo === "DIN");
        const tieneFactImp = (attachments ?? []).some(
          (a) => a.tipo === "FACTURA_IMPORTACION",
        );
        const completo = tieneInvoice && tieneDIN && tieneFactImp;
        const tone = completo
          ? "border-positive/20 bg-positive/5 text-positive"
          : "border-amber-200 bg-amber-50 text-amber-800";
        const check = (ok: boolean) => (ok ? "✅" : "⬜");
        return (
          <div className={`mt-3 rounded-xl border p-3 text-[11px] ${tone}`}>
            <strong className="font-semibold">
              {completo
                ? "Documentación de importación completa"
                : "Importación — necesitás 3 documentos para legalizar el Invoice:"}
            </strong>
            <ul className="mt-1.5 space-y-0.5">
              <li>{check(tieneInvoice)} <strong>Invoice</strong> — factura del proveedor extranjero</li>
              <li>{check(tieneDIN)} <strong>DIN</strong> — Declaración de Ingreso (aduana)</li>
              <li>{check(tieneFactImp)} <strong>Factura de Importación</strong> — DTE 914 emitida en Chile</li>
            </ul>
            {!completo && (
              <p className="mt-1.5 opacity-80">
                También podés sumar packing list, B/L, póliza de seguro y SWIFT
                como respaldos opcionales.
              </p>
            )}
          </div>
        );
      })()}

      {/* Lista */}
      {attachments && attachments.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {attachments.map((att) => {
            const Icon = iconForMime(att.mime_type);
            return (
              <li
                key={att.attachment_id}
                className="group flex items-center gap-3 rounded-xl border border-hairline bg-ink-50/30 px-3 py-2 transition-colors hover:bg-ink-50/60"
              >
                <Icon
                  className="h-4 w-4 shrink-0 text-ink-400"
                  strokeWidth={1.75}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">
                    {att.file_name}
                  </p>
                  <p className="text-[10px] text-ink-500">
                    <span className="rounded bg-cehta-green/10 px-1.5 py-0.5 font-semibold uppercase tracking-wider text-cehta-green">
                      {TIPOS.find((t) => t.value === att.tipo)?.label ?? att.tipo}
                    </span>{" "}
                    · {fmtSize(att.size_bytes)} ·{" "}
                    {new Date(att.uploaded_at).toLocaleDateString("es-CL")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openAttachment(att)}
                  title="Abrir en Dropbox (URL temporal 4h)"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-500 hover:bg-cehta-green/10 hover:text-cehta-green"
                >
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        confirm(
                          `¿Eliminar adjunto "${att.file_name}"? Se borra de Dropbox y de la app.`,
                        )
                      ) {
                        deleteMut.mutate(att.attachment_id);
                      }
                    }}
                    title="Eliminar"
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-negative opacity-0 transition-opacity hover:bg-negative/10 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-hairline bg-ink-50/40 p-4 text-center text-xs text-ink-500">
          Sin adjuntos. Subí factura, contrato o respaldo técnico.
        </p>
      )}

      {/* Uploader (si DRAFT/PENDING) */}
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
          <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Tipo:
          </label>
          <select
            value={uploadTipo}
            onChange={(e) =>
              setUploadTipo(e.target.value as VoucherAttachmentTipo)
            }
            disabled={uploading}
            className="rounded-lg border-0 bg-ink-50 px-2 py-1.5 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:opacity-50"
          >
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.doc"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-60"
          >
            {uploading ? (
              <Upload className="h-3.5 w-3.5 animate-pulse" strokeWidth={1.75} />
            ) : (
              <Receipt className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {uploading ? "Subiendo…" : "Adjuntar archivo"}
          </button>
          <p className="ml-auto text-[10px] italic text-ink-400">
            Max 50 MB · PDF, JPG, PNG, Excel, Word
          </p>
        </div>
      )}
    </div>
  );
}
