"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, Plus } from "lucide-react";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HitoRead } from "@/lib/api/schema";

interface Props {
  /** ID del proyecto al que pertenecen los hitos. Reservado para invalidación
   * por proyecto en futuras iteraciones. */
  proyectoId: number;
  hitos: HitoRead[];
  empresaCodigo: string;
  canEdit: boolean;
  onAddHito: () => void;
}

export function HitoChecklist({
  proyectoId: _proyectoId,
  hitos,
  empresaCodigo,
  canEdit,
  onAddHito,
}: Props) {
  const { session } = useSession();
  const qc = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: async (hito: HitoRead) => {
      const newEstado = hito.estado === "completado" ? "pendiente" : "completado";
      const body = {
        estado: newEstado,
        fecha_completado:
          newEstado === "completado" ? new Date().toISOString().slice(0, 10) : null,
        progreso_pct: newEstado === "completado" ? 100 : 0,
      };
      return apiClient.patch<HitoRead>(`/avance/hitos/${hito.hito_id}`, body, session);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["avance", empresaCodigo] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error al actualizar hito");
    },
  });

  if (hitos.length === 0) {
    return (
      <div className="rounded-xl bg-ink-100/40 p-4 text-center">
        <p className="text-sm text-ink-500">Sin hitos definidos.</p>
        {canEdit && (
          <button
            type="button"
            onClick={onAddHito}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-cehta-green hover:underline"
          >
            <Plus className="h-3 w-3" strokeWidth={1.5} /> Agregar primer hito
          </button>
        )}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-hairline">
      {hitos.map((hito) => {
        const completed = hito.estado === "completado";
        return (
          <li key={hito.hito_id} className="flex items-center gap-3 py-2">
            <button
              type="button"
              disabled={!canEdit || toggleMutation.isPending}
              onClick={() => toggleMutation.mutate(hito)}
              aria-label={completed ? "Marcar como pendiente" : "Marcar como completado"}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full ring-1 transition-colors duration-150",
                completed
                  ? "bg-positive/10 text-positive ring-positive/30"
                  : "bg-white text-ink-300 ring-hairline hover:ring-cehta-green",
                !canEdit && "cursor-not-allowed opacity-60",
              )}
            >
              {completed ? (
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
              ) : (
                <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-sm",
                  completed
                    ? "text-ink-500 line-through"
                    : "font-medium text-ink-900",
                )}
              >
                {hito.nombre}
              </p>
              {hito.fecha_planificada && (
                <p className="text-xs text-ink-500">
                  Planificado: {toDate(hito.fecha_planificada)}
                  {hito.fecha_completado && ` · Completado: ${toDate(hito.fecha_completado)}`}
                </p>
              )}
            </div>
            <span className="text-xs uppercase tracking-wide text-ink-300">
              {hito.estado.replace("_", " ")}
            </span>
          </li>
        );
      })}
      {canEdit && (
        <li className="pt-3">
          <button
            type="button"
            onClick={onAddHito}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-cehta-green hover:bg-cehta-green/10"
          >
            <Plus className="h-3 w-3" strokeWidth={1.5} /> Agregar hito
          </button>
        </li>
      )}
    </ul>
  );
}
