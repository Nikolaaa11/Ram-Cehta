"use client";

/**
 * R152SSSS · OcFirmadasPanel
 *
 * Tab "Firmadas → Vouchers" del módulo Órdenes de Compra.
 *
 * Pipeline operativo:
 *   1. Lista OCs con estado = "emitida" (firmadas, listas para pagarse).
 *   2. Por cada OC: botón "Generar vouchers" llama al backend que crea
 *      UN voucher DRAFT por cada cuota PENDIENTE de la OC.
 *   3. Botón "Enviar al GG" reenvía el PDF al firmante por mail.
 *   4. Link rápido al detalle de OC y a sus vouchers ya creados.
 *
 * Endpoints backend:
 *   - GET  /ordenes-compra?estado=emitida (lista)
 *   - POST /ordenes-compra/{oc_id}/cuotas/generar-vouchers (R152yyy)
 *   - POST /ordenes-compra/{oc_id}/send-to-signers (R152KKKK)
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  Mail,
  Receipt,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import type { Page, OcListItem } from "@/lib/api/schema";

export function OcFirmadasPanel() {
  const { session } = useSession();
  const qc = useQueryClient();

  // OCs firmadas/emitidas (listas para generar vouchers).
  const list = useQuery<Page<OcListItem>>({
    queryKey: ["ordenes-compra", "firmadas"],
    queryFn: () =>
      apiClient.get<Page<OcListItem>>(
        "/ordenes-compra?estado=emitida&page=1&size=50",
        session,
      ),
    enabled: !!session,
    staleTime: 30_000,
  });

  // Generar vouchers desde cuotas.
  const generarVouchers = useMutation({
    mutationFn: (ocId: number) =>
      apiClient.post<{
        cuotas_procesadas: number;
        vouchers_creados: number;
        vouchers_codigos: string[];
      }>(`/ordenes-compra/${ocId}/cuotas/generar-vouchers`, {}, session),
    onSuccess: (data, ocId) => {
      if (data.vouchers_creados === 0) {
        toast.info(
          "No hay cuotas pendientes para generar vouchers. ¿La OC tiene cuotas?",
          { duration: 8000 },
        );
      } else {
        toast.success(
          `${data.vouchers_creados} voucher${data.vouchers_creados !== 1 ? "s" : ""} DRAFT creado${data.vouchers_creados !== 1 ? "s" : ""}: ${data.vouchers_codigos.join(", ")}`,
          { duration: 10000 },
        );
      }
      qc.invalidateQueries({ queryKey: ["ordenes-compra"] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      // Refrescar el detalle de cuotas del OC.
      qc.invalidateQueries({ queryKey: ["oc-cuotas", ocId] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : (e as Error).message;
      toast.error(`No se pudieron generar vouchers: ${detail}`, {
        duration: 10000,
      });
    },
  });

  // Reenviar PDF al GG por mail.
  const sendToSigners = useMutation({
    mutationFn: (ocId: number) =>
      apiClient.post<{
        ok: boolean;
        to?: string[];
        cc?: string[];
        error?: string;
      }>(`/ordenes-compra/${ocId}/send-to-signers`, {}, session),
    onSuccess: (data) => {
      if (data.ok && data.to) {
        toast.success(`Email enviado a: ${data.to.join(", ")}`, {
          duration: 8000,
        });
      } else {
        toast.error(data.error || "No se pudo enviar el email");
      }
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : (e as Error).message;
      toast.error(`Envío falló: ${detail}`, { duration: 10000 });
    },
  });

  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-hairline bg-white p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-cehta-green/10 p-2">
            <CheckCircle2
              className="h-5 w-5 text-cehta-green"
              strokeWidth={1.5}
            />
          </div>
          <div>
            <h3 className="text-sm font-medium text-ink-900">
              OCs firmadas · listas para pagar
            </h3>
            <p className="mt-0.5 text-xs text-ink-500">
              Una vez firmada por el GG, generá los vouchers correspondientes
              (uno por cuota) o reenviá el PDF al firmante.
            </p>
          </div>
        </div>
      </div>

      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="rounded-2xl border border-negative/20 bg-negative/5 p-4 text-sm text-negative">
          Error cargando OCs firmadas.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-hairline bg-white p-10 text-center">
          <FileText
            className="mx-auto h-10 w-10 text-ink-300"
            strokeWidth={1.25}
          />
          <p className="mt-3 text-sm text-ink-700">
            No hay OCs firmadas/emitidas todavía
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Las OCs aparecen acá cuando pasan a estado{" "}
            <span className="font-mono text-xs">emitida</span>.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((oc) => (
            <OcCard
              key={oc.oc_id}
              oc={oc}
              onGenerarVouchers={() => generarVouchers.mutate(oc.oc_id)}
              onSendToSigners={() => sendToSigners.mutate(oc.oc_id)}
              isGenerating={
                generarVouchers.isPending &&
                generarVouchers.variables === oc.oc_id
              }
              isSending={
                sendToSigners.isPending && sendToSigners.variables === oc.oc_id
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OcCard({
  oc,
  onGenerarVouchers,
  onSendToSigners,
  isGenerating,
  isSending,
}: {
  oc: OcListItem;
  onGenerarVouchers: () => void;
  onSendToSigners: () => void;
  isGenerating: boolean;
  isSending: boolean;
}) {
  const fmtCLP = (n: number) =>
    `$${Math.round(n || 0)
      .toLocaleString("es-CL")
      .replace(/,/g, ".")}`;

  return (
    <div className="rounded-2xl border border-hairline bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-ink-500">
            <span className="rounded bg-ink-50 px-1.5 py-0.5 font-mono font-medium text-ink-700">
              {oc.empresa_codigo}
            </span>
            <span>·</span>
            <Link
              href={`/ordenes-compra/${oc.oc_id}`}
              className="font-medium text-ink-900 hover:text-cehta-green"
            >
              OC {oc.numero_oc}
            </Link>
          </div>
          <p className="mt-1 text-sm font-medium text-ink-900">
            Total: {fmtCLP(Number(oc.total))}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {oc.proveedor_id ? `Proveedor #${oc.proveedor_id}` : "Sin proveedor"}
            {" · "}
            Emitida{" "}
            {oc.fecha_emision
              ? new Date(oc.fecha_emision).toLocaleDateString("es-CL")
              : "—"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSendToSigners}
            disabled={isSending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green disabled:opacity-50"
            title="Reenvía el PDF al GG (y CC a encargados) por mail."
          >
            {isSending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Enviar al GG
          </button>
          <button
            type="button"
            onClick={onGenerarVouchers}
            disabled={isGenerating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            title="Crea 1 voucher DRAFT por cada cuota pendiente de esta OC."
          >
            {isGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Receipt className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Generar vouchers
          </button>
          <Link
            href={`/ordenes-compra/${oc.oc_id}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-cehta-green"
          >
            Detalle
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
          </Link>
        </div>
      </div>
    </div>
  );
}
