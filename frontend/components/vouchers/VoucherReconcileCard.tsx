"use client";

/**
 * VoucherReconcileCard — conciliación bancaria de un voucher EXECUTED.
 *
 * Muestra:
 *   - Si voucher.movimiento_id != null → "Conciliado" badge + info del
 *     movimiento + botón "Desconciliar"
 *   - Si voucher.status === EXECUTED y movimiento_id === null →
 *     "Buscar candidatos" → lista de movimientos compatibles → click
 *     en uno hace el match
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CheckCircle2,
  Link2,
  Search,
  Unlink,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import type { MatchCandidate, VoucherFull } from "@/lib/api/schema";

interface Props {
  voucher: VoucherFull;
}

const fmtCLP = (v: number) => `$${Math.round(v).toLocaleString("es-CL")}`;

export function VoucherReconcileCard({ voucher }: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [showCandidates, setShowCandidates] = useState(false);

  const isReconciled = voucher.movimiento_id !== null;
  const canReconcile =
    voucher.status === "EXECUTED" && voucher.movimiento_id === null;
  const canUnreconcile = voucher.status === "RECONCILED";

  const { data: candidates, isLoading } = useQuery<MatchCandidate[]>({
    queryKey: ["voucher-match-candidates", voucher.voucher_id],
    queryFn: () =>
      apiClient.get<MatchCandidate[]>(
        `/vouchers/${voucher.voucher_id}/match-candidates`,
        session,
      ),
    enabled: !!session && showCandidates && canReconcile,
  });

  const linkMut = useMutation({
    mutationFn: async (movimiento_id: number) =>
      apiClient.post(
        `/vouchers/${voucher.voucher_id}/reconcile`,
        { movimiento_id },
        session,
      ),
    onSuccess: () => {
      toast.success("Voucher conciliado · status RECONCILED");
      qc.invalidateQueries({ queryKey: ["voucher", voucher.voucher_id] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["conciliacion-summary"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error", {
        duration: 8000,
      });
    },
  });

  const unlinkMut = useMutation({
    mutationFn: async () =>
      apiClient.post(
        `/vouchers/${voucher.voucher_id}/unreconcile`,
        {},
        session,
      ),
    onSuccess: () => {
      toast.success("Voucher desconciliado · vuelve a EXECUTED");
      qc.invalidateQueries({ queryKey: ["voucher", voucher.voucher_id] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error");
    },
  });

  // Solo mostrar para EXECUTED/RECONCILED
  if (
    voucher.status !== "EXECUTED" &&
    voucher.status !== "RECONCILED" &&
    voucher.status !== "SYNCED" &&
    voucher.status !== "CLOSED"
  ) {
    return null;
  }

  return (
    <div className="rounded-3xl border border-hairline bg-white p-5 shadow-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
          Conciliación bancaria
        </p>
        {isReconciled ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-positive ring-1 ring-positive/20">
            <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
            Conciliado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning ring-1 ring-warning/20">
            Pendiente
          </span>
        )}
      </header>

      {isReconciled ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-xl border border-positive/20 bg-positive/5 p-3">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-positive" strokeWidth={1.75} />
              <p className="text-sm font-semibold text-ink-900">
                Movimiento bancario #{voucher.movimiento_id}
              </p>
            </div>
            <p className="mt-1 text-[11px] text-ink-600">
              Asociado al voucher al ejecutarse el pago. Para corregir un
              match incorrecto, desconciliar y volver a buscar candidatos.
            </p>
          </div>
          {canUnreconcile && (
            <button
              type="button"
              onClick={() => {
                if (
                  confirm(
                    "¿Desconciliar el voucher? Vuelve a estado EXECUTED y libera el movimiento bancario.",
                  )
                ) {
                  unlinkMut.mutate();
                }
              }}
              disabled={unlinkMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl border border-negative/20 bg-white px-3 py-1.5 text-xs font-medium text-negative hover:bg-negative/5 disabled:opacity-60"
            >
              <Unlink className="h-3.5 w-3.5" strokeWidth={1.75} />
              Desconciliar
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-ink-600">
            Este voucher fue ejecutado pero no tiene movimiento bancario
            asignado. Buscá candidatos por monto y fecha (±3 días).
          </p>

          {!showCandidates ? (
            <button
              type="button"
              onClick={() => setShowCandidates(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-cehta-green-700"
            >
              <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
              Buscar candidatos
            </button>
          ) : isLoading ? (
            <p className="text-xs text-ink-500">Buscando…</p>
          ) : !candidates || candidates.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 text-xs text-amber-800">
              Sin candidatos. Verificá que el movimiento bancario esté
              cargado en{" "}
              <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px]">
                core.movimientos
              </code>{" "}
              con el monto exacto.
              <button
                type="button"
                onClick={() => setShowCandidates(false)}
                className="mt-2 block text-cehta-green underline"
              >
                Cerrar búsqueda
              </button>
            </div>
          ) : (
            <ul className="space-y-2">
              {candidates.map((c) => (
                <li
                  key={c.movimiento_id}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-ink-50/30 p-3"
                >
                  <Banknote
                    className="h-4 w-4 shrink-0 text-ink-400"
                    strokeWidth={1.75}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs tabular-nums text-ink-700">
                      Mov #{c.movimiento_id} · {c.fecha}
                    </p>
                    <p className="truncate text-[11px] text-ink-500">
                      {c.descripcion ?? "Sin descripción"}
                    </p>
                    {c.proveedor_nombre && (
                      <p className="text-[10px] text-ink-400">
                        {c.proveedor_nombre}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-mono text-sm font-semibold tabular-nums ${
                        Number(c.monto) < 0 ? "text-negative" : "text-positive"
                      }`}
                    >
                      {fmtCLP(Math.abs(Number(c.monto)))}
                    </p>
                    {c.banco && (
                      <p className="text-[10px] text-ink-400">{c.banco}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        confirm(
                          `¿Conciliar este voucher con el movimiento ${c.movimiento_id}?`,
                        )
                      ) {
                        linkMut.mutate(c.movimiento_id);
                      }
                    }}
                    disabled={linkMut.isPending}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-cehta-green px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white hover:bg-cehta-green-700 disabled:opacity-60"
                  >
                    <Link2 className="h-3 w-3" strokeWidth={2.5} />
                    Match
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
