"use client";

/**
 * /aprobaciones — V5++ ola CI
 *
 * Pantalla dedicada para aprobadores (GG / Director / COO / Contador /
 * Tesoreria). Lista TODOS los vouchers PENDING donde el current user
 * es el proximo aprobador, agrupados por empresa, con todo lo necesario
 * para decidir sin abrir el detalle:
 *
 *   - Codigo + tipo + proveedor + folio + total + dias pendiente
 *   - Glosa truncada
 *   - Link al adjunto (factura/boleta)
 *   - Badge de regla matcheada + reinforced si aplica
 *   - Indicador "Firma X/Y" (progreso del flujo)
 *   - Boton "Firmar como {mi rol}" (con confirmacion + comentario opcional)
 *   - Boton "Ver detalle" para casos que requieran inspeccion
 *
 * El endpoint /vouchers/mis-pendientes filtra server-side: solo vouchers
 * donde el user es el next pending approver. Excluye duplicados, vouchers
 * sin regla, y los que el user ya firmo (anti-doble-firma).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileSignature,
  FileText,
  Inbox,
  PenTool,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";

interface MisPendientesItem {
  voucher_id: number;
  codigo: string;
  empresa_codigo: string;
  empresa_razon_social: string | null;
  tipo: string;
  fecha_contable: string;
  fecha_creacion: string;
  contraparte_nombre: string | null;
  contraparte_rut: string | null;
  doc_tributario_tipo: string | null;
  doc_tributario_folio: string | null;
  glosa: string | null;
  moneda: string;
  total: string;
  creador_email: string | null;
  mi_rol_para_firmar: string;
  rol_label: string;
  firmas_hechas: number;
  firmas_totales: number;
  matched_rule_descripcion: string | null;
  reinforced: boolean;
  dias_pendiente: number;
  primer_adjunto_dropbox_path: string | null;
}

interface MisPendientesResponse {
  total: number;
  items: MisPendientesItem[];
}

const fmtMonto = (v: string, moneda: string): string => {
  const n = parseFloat(v);
  if (!n) return "—";
  if (moneda === "CLP") return `$${Math.round(n).toLocaleString("es-CL")}`;
  const prefix = moneda === "USD" ? "US$" : moneda === "UF" ? "UF " : `${moneda} `;
  return `${prefix}${n.toLocaleString("es-CL", { maximumFractionDigits: 2 })}`;
};

const fmtFecha = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

const urgencyChip = (dias: number) => {
  if (dias >= 7)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-700">
        <AlertTriangle className="size-3" /> Urgente · {dias}d
      </span>
    );
  if (dias >= 3)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
        <Clock className="size-3" /> {dias}d esperando
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-600">
      <Clock className="size-3" /> {dias}d
    </span>
  );
};

export default function AprobacionesPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [signingFor, setSigningFor] = useState<MisPendientesItem | null>(null);
  const [showRejectFor, setShowRejectFor] = useState<MisPendientesItem | null>(
    null,
  );

  const { data, isLoading, isError, refetch, isFetching } =
    useQuery<MisPendientesResponse>({
      queryKey: ["vouchers", "mis-pendientes"],
      queryFn: () =>
        apiClient.get<MisPendientesResponse>(
          "/vouchers/mis-pendientes",
          session,
        ),
      enabled: !!session,
      staleTime: 60_000,
    });

  // Agrupar por empresa para visual claro
  const grouped = useMemo(() => {
    const map = new Map<string, MisPendientesItem[]>();
    for (const item of data?.items ?? []) {
      const k = item.empresa_codigo;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Cola de aprobaciones
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-900 flex items-center gap-2">
            <PenTool className="size-6 text-cehta-green" />
            Vouchers esperando tu firma
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Solo aparecen los vouchers donde sos el próximo aprobador. La
            cola se ordena por antigüedad — los más viejos primero.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="rounded-full bg-cehta-green/10 px-3 py-1 text-sm font-semibold text-cehta-green">
              {data.total} pendiente{data.total === 1 ? "" : "s"}
            </span>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-60"
            title="Refrescar"
          >
            <RefreshCw
              className={`size-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            Refrescar
          </button>
        </div>
      </header>

      {isLoading && (
        <Surface className="p-12 text-center text-ink-500">
          Cargando aprobaciones…
        </Surface>
      )}

      {isError && (
        <Surface className="p-6 bg-negative/5 border border-negative/20">
          <p className="text-sm text-negative">
            No pude cargar las aprobaciones. Reintentá en unos segundos.
          </p>
        </Surface>
      )}

      {!isLoading && data && data.total === 0 && (
        <Surface className="p-12 text-center">
          <CheckCircle2 className="mx-auto size-12 text-cehta-green" />
          <p className="mt-3 text-lg font-semibold text-ink-900">
            Sin pendientes
          </p>
          <p className="mt-1 text-sm text-ink-500">
            No tenés vouchers esperando tu firma. Buen trabajo.
          </p>
          <Link
            href={"/vouchers" as Route}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-cehta-green hover:underline"
          >
            <Inbox className="size-4" />
            Ver todos los vouchers
          </Link>
        </Surface>
      )}

      {grouped.length > 0 && (
        <div className="space-y-6">
          {grouped.map(([empresa, items]) => (
            <section key={empresa} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-700">
                  {empresa}
                  {items[0]?.empresa_razon_social && (
                    <span className="ml-2 font-normal text-ink-500 capitalize">
                      — {items[0].empresa_razon_social}
                    </span>
                  )}
                </h2>
                <span className="text-xs text-ink-500">
                  {items.length} pendiente{items.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((item) => (
                  <VoucherApprovalCard
                    key={item.voucher_id}
                    item={item}
                    onSign={() => setSigningFor(item)}
                    onReject={() => setShowRejectFor(item)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {signingFor && (
        <SignDialog
          item={signingFor}
          onClose={() => setSigningFor(null)}
          onSuccess={() => {
            setSigningFor(null);
            qc.invalidateQueries({ queryKey: ["vouchers", "mis-pendientes"] });
            qc.invalidateQueries({ queryKey: ["vouchers"] });
          }}
        />
      )}
      {showRejectFor && (
        <RejectDialog
          item={showRejectFor}
          onClose={() => setShowRejectFor(null)}
          onSuccess={() => {
            setShowRejectFor(null);
            qc.invalidateQueries({ queryKey: ["vouchers", "mis-pendientes"] });
            qc.invalidateQueries({ queryKey: ["vouchers"] });
          }}
        />
      )}
    </div>
  );
}

function VoucherApprovalCard({
  item,
  onSign,
  onReject,
}: {
  item: MisPendientesItem;
  onSign: () => void;
  onReject: () => void;
}) {
  return (
    <Surface className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <Link
              href={`/vouchers/${item.voucher_id}` as Route}
              className="font-mono text-sm font-semibold text-ink-900 hover:text-cehta-green hover:underline"
            >
              {item.codigo}
            </Link>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              {item.tipo}
            </span>
            {item.doc_tributario_folio && (
              <span className="text-xs text-ink-500">
                · folio{" "}
                <span className="font-mono">{item.doc_tributario_folio}</span>
              </span>
            )}
            {urgencyChip(item.dias_pendiente)}
            {item.reinforced && (
              <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-yellow-800">
                <Sparkles className="size-3" /> Reforzado
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-900">
            <span className="font-medium">
              {item.contraparte_nombre ?? "Sin proveedor"}
            </span>
            {item.contraparte_rut && (
              <span className="ml-1.5 font-mono text-xs text-ink-500">
                {item.contraparte_rut}
              </span>
            )}
          </p>
          {item.glosa && (
            <p className="mt-1 line-clamp-2 text-xs text-ink-600">
              {item.glosa}
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-ink-500">
            Fecha doc: <span className="font-mono">{fmtFecha(item.fecha_contable)}</span>
            {" · "}
            Creado por:{" "}
            <span className="text-ink-700">
              {item.creador_email ?? "—"}
            </span>
            {item.matched_rule_descripcion && (
              <>
                {" · "}
                <span className="italic">{item.matched_rule_descripcion}</span>
              </>
            )}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono text-lg font-semibold tabular-nums text-ink-900">
            {fmtMonto(item.total, item.moneda)}
          </p>
          <p className="text-[11px] text-ink-500">
            Firma {item.firmas_hechas + 1}/{item.firmas_totales} ·{" "}
            <span className="font-medium text-cehta-green">
              {item.rol_label}
            </span>
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-3">
        {item.primer_adjunto_dropbox_path && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-ink-500"
            title={item.primer_adjunto_dropbox_path}
          >
            <FileText className="size-3.5" />
            Adjunto disponible
          </span>
        )}
        <Link
          href={`/vouchers/${item.voucher_id}` as Route}
          className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
        >
          Ver detalle
        </Link>
        <button
          type="button"
          onClick={onReject}
          className="inline-flex items-center gap-1.5 rounded-xl border border-negative/20 bg-white px-3 py-1.5 text-xs font-medium text-negative hover:bg-negative/5"
        >
          <XCircle className="size-3.5" />
          Rechazar
        </button>
        <button
          type="button"
          onClick={onSign}
          className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-1.5 text-xs font-semibold text-white shadow-card hover:bg-cehta-green-700"
        >
          <FileSignature className="size-3.5" />
          Firmar como {item.mi_rol_para_firmar}
        </button>
      </div>
    </Surface>
  );
}

function SignDialog({
  item,
  onClose,
  onSuccess,
}: {
  item: MisPendientesItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { session } = useSession();
  const [comments, setComments] = useState("");
  const mut = useMutation({
    mutationFn: async () =>
      apiClient.post(
        `/vouchers/${item.voucher_id}/approve`,
        {
          role: item.mi_rol_para_firmar,
          comments: comments.trim() || undefined,
        },
        session,
      ),
    onSuccess: () => {
      toast.success(`Firmado ${item.codigo} como ${item.rol_label}`);
      onSuccess();
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.detail : "No se pudo firmar", {
        duration: 8000,
      }),
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
          <FileSignature className="size-3.5" />
          Confirmar firma
        </div>
        <div className="space-y-1">
          <p className="text-sm text-ink-700">
            Voy a firmar el voucher{" "}
            <span className="font-mono font-semibold">{item.codigo}</span>{" "}
            como{" "}
            <span className="font-semibold text-cehta-green">
              {item.rol_label}
            </span>
            .
          </p>
          <p className="text-xs text-ink-500">
            La firma queda registrada con tu IP, timestamp y un hash SHA-256
            que sirve de evidencia. No se puede revertir — para invalidar
            habría que anular el voucher (otro flujo).
          </p>
        </div>
        <div className="rounded-xl bg-ink-50 p-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-500">Proveedor</span>
            <span className="font-medium">
              {item.contraparte_nombre ?? "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-500">Total</span>
            <span className="font-mono font-semibold">
              {fmtMonto(item.total, item.moneda)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-500">Empresa</span>
            <span className="font-medium">{item.empresa_codigo}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-500">Tipo doc / Folio</span>
            <span className="font-mono text-xs">
              {item.doc_tributario_tipo ?? "—"}{" "}
              {item.doc_tributario_folio ?? ""}
            </span>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Comentarios (opcional)
          </label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Ej: Verificado contra orden de compra OC-2026-0123"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green resize-none"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={mut.isPending}
            className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            Cancelar
          </button>
          <Button
            type="submit"
            disabled={mut.isPending}
            className="inline-flex items-center gap-1.5 px-5"
          >
            <FileSignature className="size-4" />
            {mut.isPending ? "Firmando…" : "Confirmar firma"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function RejectDialog({
  item,
  onClose,
  onSuccess,
}: {
  item: MisPendientesItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { session } = useSession();
  const [reason, setReason] = useState("");
  const mut = useMutation({
    mutationFn: async () =>
      apiClient.post(
        `/vouchers/${item.voucher_id}/reject`,
        { reason: reason.trim() },
        session,
      ),
    onSuccess: () => {
      toast.success(`Voucher ${item.codigo} rechazado`);
      onSuccess();
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.detail : "Error", {
        duration: 8000,
      }),
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length < 10) {
            toast.error("La razón debe tener al menos 10 caracteres");
            return;
          }
          mut.mutate();
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-negative">
          <XCircle className="size-3.5" />
          Rechazar voucher {item.codigo}
        </div>
        <p className="text-sm text-ink-600">
          El voucher pasa a REJECTED. Para un nuevo intento, el operador
          debe crear un voucher distinto. La razón queda en el audit log.
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
            placeholder="Ej: Falta firma del proveedor en la factura adjunta"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-negative resize-none"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={mut.isPending}
            className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={mut.isPending || reason.trim().length < 10}
            className="inline-flex items-center gap-1.5 rounded-xl bg-negative px-4 py-2 text-sm font-semibold text-white hover:bg-negative/90 disabled:opacity-60"
          >
            <XCircle className="size-4" />
            {mut.isPending ? "Rechazando…" : "Rechazar"}
          </button>
        </div>
      </form>
    </div>
  );
}
