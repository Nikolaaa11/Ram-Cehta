"use client";

/**
 * VoucherApprovalsCard — flujo de aprobación con firma para un voucher.
 *
 * Muestra:
 *   - Regla matcheada (descripcion + reinforced badge si aplica)
 *   - Timeline de firmas requeridas (ordenadas) con estado:
 *       * Pendiente (gris) — todavía no firma
 *       * Firmada (verde con check) — con timestamp + nombre del rol + comentarios
 *       * Próximo paso highlighted con dot pulsante
 *   - Botonera contextual:
 *       * Si user puede firmar el próximo paso → "Firmar como {rol}"
 *       * Cualquier user con rol activo → "Rechazar" (con modal de razón)
 *
 * El backend ya valida secuencialidad y anti-doble-firma — la UI solo refleja.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileSignature,
  Sparkles,
  XCircle,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import type {
  CompanyRole,
  VoucherApprovalsState,
  VoucherStatus,
} from "@/lib/api/schema";

const ROLE_LABEL: Record<CompanyRole, string> = {
  GG: "Gerente General",
  COO: "COO / Compliance",
  CONTADOR: "Contador",
  OPERADOR: "Operador",
  DIRECTOR: "Director",
  TESORERIA: "Tesorería",
};

interface Props {
  voucherId: number;
  voucherStatus: VoucherStatus;
}

export function VoucherApprovalsCard({ voucherId, voucherStatus }: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [showReject, setShowReject] = useState(false);
  // V5++ ola CI — modal de firma con comentarios opcionales (antes era
  // un confirm() js feo). Si el user pone un comentario, viaja al backend
  // y queda visible en el timeline + audit log.
  const [showSignModal, setShowSignModal] = useState(false);
  const [signComments, setSignComments] = useState("");

  const { data, isLoading } = useQuery<VoucherApprovalsState>({
    queryKey: ["voucher-approvals", voucherId],
    queryFn: () =>
      apiClient.get<VoucherApprovalsState>(
        `/vouchers/${voucherId}/approvals`,
        session,
      ),
    enabled: !!session,
  });

  const approveMut = useMutation({
    mutationFn: async (params: { role: CompanyRole; comments?: string }) =>
      apiClient.post<VoucherApprovalsState>(
        `/vouchers/${voucherId}/approve`,
        params,
        session,
      ),
    onSuccess: (state) => {
      const lastApproval = state.approvals[state.approvals.length - 1];
      const remaining = state.required_roles.length - state.approvals.filter(
        (a) => a.decision === "APPROVED",
      ).length;
      if (remaining === 0) {
        toast.success(
          `Voucher ${state.voucher_codigo} aprobado completo · todas las firmas registradas`,
        );
      } else {
        toast.success(
          `Firma registrada como ${lastApproval?.role ?? ""} · falta${remaining > 1 ? "n" : ""} ${remaining} firma${remaining > 1 ? "s" : ""}`,
        );
      }
      qc.invalidateQueries({ queryKey: ["voucher-approvals", voucherId] });
      qc.invalidateQueries({ queryKey: ["voucher", voucherId] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo firmar",
        { duration: 8000 },
      );
    },
  });

  if (isLoading) {
    return (
      <div className="rounded-3xl border border-hairline bg-white p-5 shadow-card">
        <p className="text-xs text-ink-500">Cargando flujo de aprobación…</p>
      </div>
    );
  }

  if (!data) return null;

  const approvedOrders = new Set(
    data.approvals
      .filter((a) => a.decision === "APPROVED")
      .map((a) => a.order_num),
  );
  const rejectedApproval = data.approvals.find(
    (a) => a.decision === "REJECTED",
  );

  return (
    <div className="rounded-3xl border border-hairline bg-white p-5 shadow-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Flujo de aprobación
          </p>
          {data.matched_rule_descripcion && (
            <p className="mt-1 text-xs text-ink-500">
              {data.matched_rule_descripcion}
            </p>
          )}
        </div>
        {data.reinforced && (
          <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-yellow-800 ring-1 ring-yellow-200">
            <Sparkles className="h-3 w-3" strokeWidth={2.5} />
            Reforzado · Doble firma
          </span>
        )}
      </header>

      {/* Sin regla matcheada */}
      {data.required_roles.length === 0 && voucherStatus === "PENDING" && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
          <strong className="font-semibold">No hay regla configurada</strong>{" "}
          para este voucher. Configurá las reglas en{" "}
          <a
            href="/admin/approval-rules"
            className="underline hover:text-amber-900"
          >
            /admin/approval-rules
          </a>{" "}
          antes de poder aprobar.
        </div>
      )}

      {/* Timeline */}
      {data.required_roles.length > 0 && (
        <ol className="mt-4 space-y-2">
          {data.required_roles.map((role, idx) => {
            const orderNum = idx + 1;
            const approval = data.approvals.find(
              (a) => a.order_num === orderNum && a.decision === "APPROVED",
            );
            const isApproved = !!approval;
            const isPending =
              !isApproved && data.next_pending_order === orderNum;
            const isFuture =
              !isApproved &&
              data.next_pending_order !== null &&
              orderNum > data.next_pending_order;

            return (
              <li
                key={orderNum}
                className={`flex items-start gap-3 rounded-xl border p-3 ${
                  isApproved
                    ? "border-positive/20 bg-positive/5"
                    : isPending
                      ? "border-cehta-green/30 bg-cehta-green/5 ring-2 ring-cehta-green/15"
                      : "border-hairline bg-ink-50/30"
                }`}
              >
                <div
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
                    isApproved
                      ? "bg-positive text-white"
                      : isPending
                        ? "bg-cehta-green text-white"
                        : "bg-ink-200 text-ink-500"
                  }`}
                >
                  {isApproved ? (
                    <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
                  ) : isPending ? (
                    <span className="relative flex h-3 w-3">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/60" />
                      <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
                    </span>
                  ) : (
                    orderNum
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-ink-900">
                      {ROLE_LABEL[role]}
                      <span className="ml-1.5 font-mono text-[10px] tabular-nums text-ink-500">
                        ({role})
                      </span>
                    </p>
                    {isApproved && approval && (
                      <p className="font-mono text-[10px] tabular-nums text-positive">
                        Firmado · {new Date(approval.signed_at).toLocaleString("es-CL")}
                      </p>
                    )}
                    {isPending && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-cehta-green/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-cehta-green">
                        <Clock className="h-3 w-3" strokeWidth={2.5} />
                        Próximo paso
                      </span>
                    )}
                    {isFuture && (
                      <span className="text-[10px] uppercase tracking-wider text-ink-400">
                        Esperando
                      </span>
                    )}
                  </div>
                  {approval?.comments && (
                    <p className="mt-1 text-xs italic text-ink-600">
                      &ldquo;{approval.comments}&rdquo;
                    </p>
                  )}
                  {approval?.signature_hash && (
                    <p className="mt-1 truncate font-mono text-[9px] text-ink-400">
                      sig: {approval.signature_hash.slice(0, 16)}…
                      {approval.ip_address ? ` · ${approval.ip_address}` : ""}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Rechazo */}
      {rejectedApproval && (
        <div className="mt-3 rounded-xl border border-negative/20 bg-negative/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-negative"
              strokeWidth={2}
            />
            <div className="min-w-0 flex-1 text-xs">
              <p className="font-semibold text-negative">
                Rechazado por {ROLE_LABEL[rejectedApproval.role]}
              </p>
              <p className="mt-0.5 text-ink-700">
                {rejectedApproval.comments}
              </p>
              <p className="mt-1 font-mono text-[10px] text-ink-400">
                {new Date(rejectedApproval.signed_at).toLocaleString("es-CL")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Botonera */}
      {voucherStatus === "PENDING" && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
          {data.can_current_user_sign && data.current_user_eligible_role && (
            <button
              type="button"
              onClick={() => setShowSignModal(true)}
              disabled={approveMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700 disabled:opacity-60"
            >
              <FileSignature className="h-4 w-4" strokeWidth={1.75} />
              Firmar como {ROLE_LABEL[data.current_user_eligible_role]}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowReject(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-negative/20 bg-white px-4 py-2 text-sm font-medium text-negative hover:bg-negative/5"
          >
            <XCircle className="h-4 w-4" strokeWidth={1.75} />
            Rechazar
          </button>
          {!data.can_current_user_sign && data.next_pending_role && (
            <p className="ml-auto text-[11px] italic text-ink-500">
              Esperando firma de{" "}
              <strong className="not-italic font-semibold text-ink-700">
                {ROLE_LABEL[data.next_pending_role]}
              </strong>
            </p>
          )}
        </div>
      )}

      {/* Modal rechazo */}
      {showReject && (
        <RejectDialog
          voucherId={voucherId}
          onClose={() => setShowReject(false)}
          onSuccess={() => {
            setShowReject(false);
            qc.invalidateQueries({ queryKey: ["voucher-approvals", voucherId] });
            qc.invalidateQueries({ queryKey: ["voucher", voucherId] });
          }}
        />
      )}

      {/* V5++ ola CI — Modal de confirmacion de firma con comentarios. */}
      {showSignModal && data.current_user_eligible_role && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowSignModal(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              approveMut.mutate(
                {
                  role: data.current_user_eligible_role!,
                  comments: signComments.trim() || undefined,
                },
                {
                  onSettled: () => {
                    setShowSignModal(false);
                    setSignComments("");
                  },
                },
              );
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
          >
            <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              <FileSignature className="h-3.5 w-3.5" strokeWidth={2.25} />
              Confirmar firma
            </div>
            <p className="text-sm text-ink-700">
              Voy a firmar este voucher como{" "}
              <span className="font-semibold text-cehta-green">
                {ROLE_LABEL[data.current_user_eligible_role]}
              </span>
              .
            </p>
            <p className="text-xs text-ink-500">
              La firma queda registrada con tu IP, timestamp y un hash
              SHA-256 que sirve de evidencia. No se puede revertir — para
              invalidar habría que anular el voucher.
            </p>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                Comentarios (opcional)
              </label>
              <textarea
                value={signComments}
                onChange={(e) => setSignComments(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Ej: Verificado contra OC-2026-0123"
                className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSignModal(false)}
                disabled={approveMut.isPending}
                className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={approveMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-5 py-2 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-60"
              >
                <FileSignature className="h-4 w-4" strokeWidth={1.75} />
                {approveMut.isPending ? "Firmando…" : "Confirmar firma"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function RejectDialog({
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
        `/vouchers/${voucherId}/reject`,
        { reason: reason.trim() },
        session,
      );
      toast.success("Voucher rechazado");
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
          <XCircle className="h-3.5 w-3.5" strokeWidth={2.25} />
          Rechazar voucher
        </div>
        <p className="text-sm text-ink-600">
          El voucher pasa a REJECTED. Para un nuevo intento, el operador debe
          crear un voucher distinto. La razón queda en el audit log.
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
            placeholder="Ej: Falta firma del proveedor en la factura adjunta · revisar antes de re-emitir"
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
            {loading ? "Rechazando…" : "Rechazar"}
          </button>
        </div>
      </form>
    </div>
  );
}
