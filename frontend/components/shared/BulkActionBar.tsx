"use client";

import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";
import type { BulkUpdateResult } from "@/lib/api/schema";

interface EstadoOption {
  value: string;
  label: string;
  description?: string;
}

interface Props {
  /** Cantidad de elementos seleccionados. */
  count: number;
  /** IDs de los items a actualizar. */
  ids: number[];
  /** Endpoint relativo, e.g. "/ordenes-compra/bulk-update-estado". */
  endpoint: string;
  /** Opciones de estado disponibles (cada una dispara un POST). */
  estados: EstadoOption[];
  /** Query keys de TanStack a invalidar después de la mutación. */
  invalidateKeys: (string | string[])[];
  /** Handler para limpiar la selección (sin operación). */
  onClear: () => void;
  /** Etiqueta singular ("OC") y plural ("OCs"). */
  entityLabel: { singular: string; plural: string };
}

/**
 * Barra de acción que aparece pegada al top de la lista cuando hay items
 * seleccionados. Diseñada Apple-style: blur backdrop, ring sutil, slides
 * down con `ease-apple`.
 *
 * Centraliza la llamada al endpoint bulk: levanta toast con el reporte
 * (`X actualizadas, Y fallaron`), invalida las queries y limpia la
 * selección al terminar.
 */
export function BulkActionBar({
  count,
  ids,
  endpoint,
  estados,
  invalidateKeys,
  onClear,
  entityLabel,
}: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [pendingEstado, setPendingEstado] = useState<string | null>(null);

  const handleAction = async (estado: string) => {
    if (!session) {
      toast.error("Sesión expirada");
      return;
    }
    setPendingEstado(estado);
    try {
      const result = await apiClient.post<BulkUpdateResult>(
        endpoint,
        { ids, estado },
        session,
      );
      const ok = result.succeeded;
      const failed = result.failed.length;
      if (failed === 0) {
        toast.success(
          `${ok} ${ok === 1 ? entityLabel.singular : entityLabel.plural} actualizad${ok === 1 ? "a" : "as"}`,
        );
      } else if (ok === 0) {
        toast.error(`Falló: ${result.failed[0]?.detail ?? "razón desconocida"}`);
      } else {
        toast.warning(
          `${ok} actualizad${ok === 1 ? "a" : "as"}, ${failed} fallaron — revisá la auditoría`,
        );
      }
      // Invalidar todas las queries afectadas
      for (const k of invalidateKeys) {
        qc.invalidateQueries({
          queryKey: Array.isArray(k) ? k : [k],
        });
      }
      onClear();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      toast.error(`No se pudo actualizar: ${msg}`);
    } finally {
      setPendingEstado(null);
    }
  };

  if (count === 0) return null;

  return (
    <div className="sticky top-2 z-30 flex items-center gap-3 rounded-2xl border border-cehta-green/30 bg-white/95 px-4 py-2.5 shadow-card ring-1 ring-cehta-green/10 backdrop-blur-md transition-all duration-200 ease-apple">
      <span className="text-sm font-medium text-ink-900">
        {count} {count === 1 ? entityLabel.singular : entityLabel.plural} seleccionad
        {count === 1 ? "a" : "as"}
      </span>
      <span className="text-xs text-ink-400">·</span>
      <span className="text-xs text-ink-500">Cambiar estado a:</span>
      <div className="flex items-center gap-1.5">
        {estados.map((e) => {
          const isPending = pendingEstado === e.value;
          return (
            <button
              key={e.value}
              type="button"
              onClick={() => handleAction(e.value)}
              disabled={pendingEstado !== null}
              title={e.description}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-800 transition-colors duration-150 ease-apple hover:bg-ink-50 disabled:opacity-50"
            >
              {isPending && (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
              )}
              {e.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onClear}
        disabled={pendingEstado !== null}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-500 transition-colors duration-150 ease-apple hover:bg-ink-100/50 disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
        Cancelar
      </button>
    </div>
  );
}
