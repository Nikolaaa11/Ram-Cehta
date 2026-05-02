"use client";

/**
 * BulkActionBar — V4 fase 7.5.
 *
 * Barra flotante que aparece cuando hay entregables seleccionados en la
 * vista Agenda. Permite cambiar el estado de varios a la vez (cierre de
 * mes en segundos).
 *
 * Para `entregado` / `no_entregado` se abre el dialog reutilizable con
 * el mismo flujo que un solo update (pide adjunto, motivo, etc.). Para
 * `en_proceso` / `pendiente` el cambio es directo sin diálogo.
 */
import { useState } from "react";
import {
  CheckCircle2,
  Loader2,
  PauseCircle,
  UserCog,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  type EstadoEntregable,
  useBulkReassignEntregables,
  useBulkUpdateEntregables,
  useEntregablesFacets,
} from "@/hooks/use-entregables";
import { cn } from "@/lib/utils";

interface Props {
  selectedIds: number[];
  onClear: () => void;
}

export function BulkActionBar({ selectedIds, onClear }: Props) {
  const [pendingTarget, setPendingTarget] = useState<EstadoEntregable | null>(
    null,
  );
  const [adjuntoUrl, setAdjuntoUrl] = useState("");
  const [motivo, setMotivo] = useState("");
  const [notas, setNotas] = useState("");
  const [reassignOpen, setReassignOpen] = useState(false);
  const [nuevoResponsable, setNuevoResponsable] = useState("");
  const bulk = useBulkUpdateEntregables();
  const reassign = useBulkReassignEntregables();
  const { data: facets } = useEntregablesFacets();

  if (selectedIds.length === 0) return null;

  const quickAction = async (estado: EstadoEntregable) => {
    try {
      const result = await bulk.mutateAsync({
        ids: selectedIds,
        estado,
      });
      reportResult(result);
      onClear();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error en bulk update");
    }
  };

  const submitDialog = async () => {
    if (!pendingTarget) return;
    if (pendingTarget === "no_entregado" && !motivo.trim()) {
      toast.error("Indicá el motivo de no entrega");
      return;
    }
    try {
      const result = await bulk.mutateAsync({
        ids: selectedIds,
        estado: pendingTarget,
        adjunto_url: adjuntoUrl.trim() || null,
        motivo_no_entrega:
          pendingTarget === "no_entregado" ? motivo.trim() : null,
        notas: notas.trim() || null,
      });
      reportResult(result);
      setPendingTarget(null);
      setAdjuntoUrl("");
      setMotivo("");
      setNotas("");
      onClear();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error en bulk update");
    }
  };

  const reportResult = (r: { updated_ids: number[]; already_target: number[]; auto_generated_next_periods: number }) => {
    const parts = [`${r.updated_ids.length} actualizados`];
    if (r.already_target.length > 0)
      parts.push(`${r.already_target.length} ya estaban en ese estado`);
    if (r.auto_generated_next_periods > 0)
      parts.push(`${r.auto_generated_next_periods} próximos períodos auto-creados`);
    toast.success(parts.join(" · "));
  };

  const submitReassign = async () => {
    if (!nuevoResponsable.trim()) {
      toast.error("Indicá el nuevo responsable");
      return;
    }
    try {
      const result = await reassign.mutateAsync({
        ids: selectedIds,
        responsable: nuevoResponsable.trim(),
      });
      toast.success(
        `${result.updated_ids.length} reasignados a "${nuevoResponsable.trim()}"`,
      );
      setReassignOpen(false);
      setNuevoResponsable("");
      onClear();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error en bulk reassign",
      );
    }
  };

  return (
    <>
      {/* Barra flotante fija al pie */}
      <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 print:hidden">
        <div className="flex items-center gap-3 rounded-2xl bg-ink-900 px-4 py-2.5 text-white shadow-card-hover ring-1 ring-ink-700">
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-cehta-green px-1.5 text-xs font-bold">
              {selectedIds.length}
            </span>
            seleccionados
          </span>
          <span className="h-5 w-px bg-ink-700" />
          <button
            type="button"
            onClick={() => setPendingTarget("entregado")}
            disabled={bulk.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-positive px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-positive/90 disabled:opacity-60"
          >
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
            Entregados
          </button>
          <button
            type="button"
            onClick={() => quickAction("en_proceso")}
            disabled={bulk.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-info/90 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-info disabled:opacity-60"
          >
            <PauseCircle className="h-3.5 w-3.5" strokeWidth={2} />
            En proceso
          </button>
          <button
            type="button"
            onClick={() => setPendingTarget("no_entregado")}
            disabled={bulk.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-negative/90 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-negative disabled:opacity-60"
          >
            <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
            No entregados
          </button>
          <button
            type="button"
            onClick={() => setReassignOpen(true)}
            disabled={bulk.isPending || reassign.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-info/90 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-info disabled:opacity-60"
          >
            <UserCog className="h-3.5 w-3.5" strokeWidth={2} />
            Reasignar
          </button>
          {(bulk.isPending || reassign.isPending) && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          )}
          <span className="h-5 w-px bg-ink-700" />
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 hover:text-white"
            aria-label="Cancelar selección"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
            Cancelar
          </button>
        </div>
      </div>

      {/* Dialog de confirmación con metadata */}
      {pendingTarget !== null && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingTarget(null);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-card-hover ring-1 ring-hairline">
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink-900">
              {pendingTarget === "entregado" ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-positive" strokeWidth={1.75} />
                  Marcar {selectedIds.length} como entregados
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-negative" strokeWidth={1.75} />
                  Marcar {selectedIds.length} como no entregados
                </>
              )}
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              {pendingTarget === "entregado"
                ? "Si los templates son recurrentes, se auto-generarán los próximos períodos."
                : "El motivo es obligatorio y queda en el audit log para Comité de Vigilancia."}
            </p>

            <div className="mt-4 space-y-3">
              {pendingTarget === "entregado" && (
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                    Adjunto común (URL Dropbox o ruta)
                  </label>
                  <input
                    type="text"
                    value={adjuntoUrl}
                    onChange={(e) => setAdjuntoUrl(e.target.value)}
                    placeholder="https://www.dropbox.com/..."
                    className="w-full rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                  <p className="mt-1 text-[10px] text-ink-500">
                    Se aplica a todos los seleccionados. Dejá vacío si los adjuntos
                    son distintos por cada uno.
                  </p>
                </div>
              )}

              {pendingTarget === "no_entregado" && (
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-negative">
                    Motivo común *
                  </label>
                  <input
                    type="text"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ej.: pendiente revisión externa"
                    className="w-full rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-negative/30 focus:outline-none focus:ring-2 focus:ring-negative"
                    autoFocus
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  Notas (opcional, se aplica a todos)
                </label>
                <textarea
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  rows={2}
                  className="w-full resize-none rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingTarget(null)}
                disabled={bulk.isPending}
                className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100/40 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitDialog}
                disabled={bulk.isPending}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-60",
                  pendingTarget === "no_entregado"
                    ? "bg-negative hover:bg-negative/90"
                    : "bg-cehta-green hover:bg-cehta-green-700",
                )}
              >
                {bulk.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                )}
                Confirmar {selectedIds.length}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reassign dialog */}
      {reassignOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReassignOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-card-hover ring-1 ring-hairline">
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink-900">
              <UserCog className="h-5 w-5 text-info" strokeWidth={1.75} />
              Reasignar {selectedIds.length} entregable
              {selectedIds.length !== 1 ? "s" : ""}
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              Cambiá el responsable de los seleccionados a otra persona o
              equipo. Auditado individualmente.
            </p>

            <div className="mt-4">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Nuevo responsable *
              </label>
              <input
                type="text"
                list="bulk-reassign-suggestions"
                value={nuevoResponsable}
                onChange={(e) => setNuevoResponsable(e.target.value)}
                placeholder="Ej.: Equipo Legal Cehta"
                className="w-full rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                autoFocus
              />
              <datalist id="bulk-reassign-suggestions">
                {(facets?.responsables ?? []).map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <p className="mt-1 text-[10px] text-ink-500">
                Sugerencias del autocomplete vienen de los responsables ya
                presentes en el sistema.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReassignOpen(false)}
                disabled={reassign.isPending}
                className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100/40 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitReassign}
                disabled={reassign.isPending || !nuevoResponsable.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-info px-4 py-2 text-sm font-medium text-white hover:bg-info/90 disabled:opacity-60"
              >
                {reassign.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                )}
                Reasignar {selectedIds.length}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
