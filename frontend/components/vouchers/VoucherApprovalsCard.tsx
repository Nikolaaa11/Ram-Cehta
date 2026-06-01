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

// Round 4 — avatares premium por rol
const ROLE_INITIAL: Record<CompanyRole, string> = {
  GG: "G",
  COO: "C",
  CONTADOR: "K",
  OPERADOR: "O",
  DIRECTOR: "D",
  TESORERIA: "T",
};

const ROLE_GRADIENT: Record<CompanyRole, string> = {
  GG: "from-sf-blue to-blue-600",
  COO: "from-cehta-green-700 to-cehta-green",
  CONTADOR: "from-amber-500 to-amber-700",
  OPERADOR: "from-slate-500 to-slate-700",
  DIRECTOR: "from-purple-600 to-purple-800",
  TESORERIA: "from-emerald-500 to-teal-600",
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

  // Observaciones 14/05/2026 — en DRAFT no fetcheamos approvals reales
  // (todavía no existen), pero igualmente queremos mostrar el preview del
  // flujo. El backend devuelve required_roles + approvals=[] cuando es
  // DRAFT, así que hacemos el fetch siempre y dejamos que el render
  // diferencie por voucherStatus.
  const { data, isLoading } = useQuery<VoucherApprovalsState>({
    queryKey: ["voucher-approvals", voucherId],
    queryFn: () =>
      apiClient.get<VoucherApprovalsState>(
        `/vouchers/${voucherId}/approvals`,
        session,
      ),
    enabled: !!session,
    // En DRAFT permitimos fallar silenciosamente — el card sigue mostrando
    // el header informativo aunque no haya data.
    retry: voucherStatus === "DRAFT" ? false : 2,
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
      // Round 84 — si el error es "voucher ya tiene todas las firmas" o
      // "el proximo rol es X, no Y" (race de doble-click), invalidar la
      // query para que la UI refresque y NO mostrar toast rojo confuso.
      const detail = err instanceof ApiError ? err.detail : "";
      const isStaleRace =
        detail.includes("ya tiene todas las firmas") ||
        detail.includes("próximo rol que debe firmar") ||
        detail.includes("proximo rol que debe firmar");
      if (isStaleRace) {
        qc.invalidateQueries({ queryKey: ["voucher-approvals", voucherId] });
        qc.invalidateQueries({ queryKey: ["voucher", voucherId] });
        toast.success(
          "Firma ya registrada · estado actualizado",
          { duration: 4000 },
        );
        return;
      }
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

  // En DRAFT sin data del backend, mostramos un placeholder visible
  // — Observaciones 14/05/2026 #3.
  if (!data) {
    return (
      <div className="rounded-3xl border border-hairline bg-white p-5 shadow-card">
        <header className="flex items-baseline justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Flujo de aprobación
            </p>
            <p className="mt-1 text-xs text-ink-500">
              {voucherStatus === "DRAFT"
                ? "Se calculará cuando envíes a aprobación. Las reglas dependen del monto + tipo + empresa."
                : "Sin información disponible."}
            </p>
          </div>
        </header>
        {voucherStatus === "DRAFT" && (
          <div className="mt-4 rounded-xl border border-dashed border-cehta-green/30 bg-cehta-green/5 p-3">
            <p className="text-[11px] text-cehta-green">
              <strong className="font-semibold">Tip:</strong> apenas hagas
              click en <span className="font-mono">Enviar a aprobación</span>,
              acá aparecen los aprobadores requeridos (Líder + Director) y
              pueden firmar uno por uno.
            </p>
          </div>
        )}
      </div>
    );
  }

  const approvedOrders = new Set(
    data.approvals
      .filter((a) => a.decision === "APPROVED")
      .map((a) => a.order_num),
  );
  const rejectedApproval = data.approvals.find(
    (a) => a.decision === "REJECTED",
  );

  // Round 4 premium — métricas para el header
  const totalSteps = data.required_roles.length;
  const signedSteps = data.approvals.filter(
    (a) => a.decision === "APPROVED",
  ).length;
  const progressPct =
    totalSteps > 0 ? Math.round((signedSteps / totalSteps) * 100) : 0;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-hairline bg-gradient-to-br from-white via-cehta-green/[0.02] to-cehta-green/[0.04] p-6 shadow-card">
      {/* Decoración halo verde */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full bg-cehta-green/10 blur-3xl"
      />

      {/* HEADER PREMIUM */}
      <header className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-3 py-1 ring-1 ring-cehta-green/20">
              <FileSignature
                className="h-3.5 w-3.5 text-cehta-green"
                strokeWidth={2.25}
              />
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
                Flujo de aprobación
              </p>
            </div>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink-900">
              {voucherStatus === "APPROVED" ||
              voucherStatus === "EXECUTED" ||
              voucherStatus === "SYNCED" ||
              voucherStatus === "RECONCILED"
                ? "Voucher aprobado"
                : voucherStatus === "REJECTED"
                  ? "Voucher rechazado"
                  : signedSteps === 0
                    ? "Esperando primera firma"
                    : `${signedSteps} de ${totalSteps} firmas registradas`}
            </h2>
            {data.matched_rule_descripcion && (
              <p className="mt-1 text-xs text-ink-500">
                {data.matched_rule_descripcion}
              </p>
            )}
          </div>
          {data.reinforced && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">
              <Sparkles className="h-3 w-3" strokeWidth={2.5} />
              Reforzado · Doble firma
            </span>
          )}
        </div>

        {/* Progress bar premium */}
        {totalSteps > 0 && voucherStatus !== "REJECTED" && (
          <div className="mt-4 flex items-center gap-3">
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cehta-green-700 via-cehta-green to-positive transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-700">
              {progressPct}%
            </span>
          </div>
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

      {/* Timeline PREMIUM con avatares + conectores verticales */}
      {data.required_roles.length > 0 && (
        <ol className="relative mt-5 space-y-0">
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
            const isLast = idx === data.required_roles.length - 1;

            return (
              <li key={orderNum} className="relative">
                {/* Conector vertical entre items */}
                {!isLast && (
                  <span
                    aria-hidden
                    className={`absolute left-[26px] top-14 h-[calc(100%-32px)] w-0.5 ${
                      isApproved ? "bg-positive/40" : "bg-ink-200"
                    }`}
                  />
                )}

                <div
                  className={`group relative flex items-start gap-4 rounded-2xl p-4 transition-all ${
                    isApproved
                      ? "bg-positive/5 ring-1 ring-positive/15"
                      : isPending
                        ? "bg-gradient-to-br from-cehta-green/8 via-cehta-green/4 to-transparent ring-2 ring-cehta-green/30 shadow-card"
                        : "bg-ink-50/40 ring-1 ring-hairline"
                  } ${idx > 0 ? "mt-3" : ""}`}
                >
                  {/* AVATAR grande con gradient + estado */}
                  <div className="relative shrink-0">
                    {isApproved ? (
                      <div
                        className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${ROLE_GRADIENT[role]} text-white shadow-lg`}
                      >
                        <CheckCircle2 className="h-7 w-7" strokeWidth={2.5} />
                      </div>
                    ) : isPending ? (
                      <div className="relative">
                        <span
                          aria-hidden
                          className="absolute inset-0 rounded-2xl bg-cehta-green/30 blur-md animate-pulse"
                        />
                        <div
                          className={`relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${ROLE_GRADIENT[role]} text-white font-display text-2xl font-bold shadow-lg`}
                        >
                          {ROLE_INITIAL[role]}
                        </div>
                        {/* Dot pulsante de "active" */}
                        <span
                          aria-hidden
                          className="absolute -right-1 -top-1 flex h-4 w-4"
                        >
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cehta-green opacity-75" />
                          <span className="relative inline-flex h-4 w-4 rounded-full bg-cehta-green ring-2 ring-white" />
                        </span>
                      </div>
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-100 font-display text-2xl font-bold text-ink-400 ring-1 ring-ink-200">
                        {ROLE_INITIAL[role]}
                      </div>
                    )}
                  </div>

                  {/* CONTENIDO */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="font-display text-lg font-semibold tracking-tight text-ink-900">
                          {ROLE_LABEL[role]}
                        </p>
                        <p className="text-[10px] font-mono uppercase tracking-wider text-ink-500">
                          Paso {orderNum} / {totalSteps} · {role}
                        </p>
                      </div>
                      {isApproved && approval && (
                        <div className="text-right">
                          <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-positive ring-1 ring-positive/20">
                            <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
                            Firmado
                          </span>
                          <p className="mt-1 font-mono text-[10px] tabular-nums text-ink-500">
                            {new Date(approval.signed_at).toLocaleString(
                              "es-CL",
                              {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </p>
                        </div>
                      )}
                      {isPending && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-cehta-green/15 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-cehta-green ring-1 ring-cehta-green/30">
                          <Clock className="h-3 w-3" strokeWidth={2.5} />
                          Esperando firma ahora
                        </span>
                      )}
                      {isFuture && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-400">
                          En cola
                        </span>
                      )}
                    </div>

                    {/* Comentario del firmante */}
                    {approval?.comments && (
                      <div className="mt-2 rounded-lg bg-white/70 px-3 py-2 ring-1 ring-positive/15">
                        <p className="text-sm italic text-ink-700">
                          &ldquo;{approval.comments}&rdquo;
                        </p>
                      </div>
                    )}

                    {/* Evidencia técnica de la firma */}
                    {approval?.signature_hash && (
                      <p className="mt-1.5 flex flex-wrap gap-x-2 truncate font-mono text-[9px] text-ink-400">
                        <span>sig: {approval.signature_hash.slice(0, 12)}…</span>
                        {approval.ip_address && <span>IP {approval.ip_address}</span>}
                      </p>
                    )}
                  </div>
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
        <div className="mt-4 border-t border-hairline pt-4">
          <div className="flex flex-wrap items-center gap-2">
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

          {/* Round 82 — guidance cuando el current user NO puede firmar:
              explicar POR QUÉ y mostrar quiénes SÍ pueden. */}
          {!data.can_current_user_sign && data.next_pending_role && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
              {data.current_user_already_signed ? (
                <p>
                  <strong className="font-semibold">No podés firmar este paso:</strong>{" "}
                  ya firmaste otro paso de este voucher. Por regla anti-doble-firma,
                  un mismo usuario no puede firmar 2 pasos del mismo flujo. Necesitamos
                  otro {ROLE_LABEL[data.next_pending_role]} para continuar.
                </p>
              ) : (
                <p>
                  <strong className="font-semibold">
                    Tu cuenta no tiene el rol {ROLE_LABEL[data.next_pending_role]}
                  </strong>{" "}
                  en esta empresa. Haz logout y entrá con una de las cuentas
                  autorizadas para firmar este paso:
                </p>
              )}
              {data.next_pending_signers_emails &&
                data.next_pending_signers_emails.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 font-mono text-[11px]">
                    {data.next_pending_signers_emails.map((email) => (
                      <li key={email}>· {email}</li>
                    ))}
                  </ul>
                )}
              {data.next_pending_signers_emails &&
                data.next_pending_signers_emails.length === 0 && (
                  <p className="mt-1 italic">
                    ⚠ No hay usuarios con rol {ROLE_LABEL[data.next_pending_role]}
                    {" "}disponibles (todos ya firmaron otros pasos). Contactá al
                    admin para agregar otro firmante.
                  </p>
                )}
            </div>
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
