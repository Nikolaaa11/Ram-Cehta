"use client";

/**
 * HitoChecklist — Round 2 premium upgrade.
 *
 * Features:
 *   - Drag-to-reorder (HTML5 native, sin lib externa)
 *   - Persiste el orden vía PATCH /avance/hitos/{id} con campo `orden`
 *   - Optimistic UI: el orden se actualiza al instante, rollback en error
 *   - Fechas relativas ("vence en 5d", "vencido hace 2d") con color tonal
 *   - Bulk "Marcar todos como completados"
 *   - Animaciones suaves de entrada
 */
import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, Plus, GripVertical, CheckSquare } from "lucide-react";
import { toast } from "sonner";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HitoRead } from "@/lib/api/schema";

interface Props {
  proyectoId: number;
  hitos: HitoRead[];
  empresaCodigo: string;
  canEdit: boolean;
  onAddHito: () => void;
}

type DateInfo = {
  relative: string;
  tone: "positive" | "warning" | "negative" | "neutral";
};

function getRelativeDate(
  fechaPlanificada: string | null | undefined,
  estado: string,
): DateInfo | null {
  if (!fechaPlanificada) return null;
  if (estado === "completado") {
    return { relative: "Completado", tone: "positive" };
  }
  if (estado === "cancelado") {
    return { relative: "Cancelado", tone: "neutral" };
  }
  const planned = new Date(fechaPlanificada);
  planned.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round(
    (planned.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diff < 0) {
    return { relative: `Vencido hace ${-diff}d`, tone: "negative" };
  }
  if (diff === 0) return { relative: "Vence hoy", tone: "warning" };
  if (diff <= 7) return { relative: `Vence en ${diff}d`, tone: "warning" };
  if (diff <= 30) return { relative: `Vence en ${diff}d`, tone: "neutral" };
  return { relative: `Vence en ${diff}d`, tone: "neutral" };
}

const TONE_CLASS: Record<DateInfo["tone"], string> = {
  positive: "bg-positive/10 text-positive",
  warning: "bg-warning/10 text-warning",
  negative: "bg-negative/10 text-negative",
  neutral: "bg-ink-100/60 text-ink-500",
};

export function HitoChecklist({
  proyectoId: _proyectoId,
  hitos,
  empresaCodigo,
  canEdit,
  onAddHito,
}: Props) {
  const { session } = useSession();
  const qc = useQueryClient();

  // Local order para optimistic UI durante drag
  const [localOrder, setLocalOrder] = useState<number[] | null>(null);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  // Construye lista visualmente ordenada (local si está dragging, sino server)
  const orderedHitos = useMemo(() => {
    if (!localOrder) return hitos;
    const byId = new Map(hitos.map((h) => [h.hito_id, h]));
    const result: HitoRead[] = [];
    for (const id of localOrder) {
      const h = byId.get(id);
      if (h) result.push(h);
    }
    // Append any hitos not in localOrder (defensive)
    for (const h of hitos) {
      if (!localOrder.includes(h.hito_id)) result.push(h);
    }
    return result;
  }, [hitos, localOrder]);

  const toggleMutation = useMutation({
    mutationFn: async (hito: HitoRead) => {
      const newEstado = hito.estado === "completado" ? "pendiente" : "completado";
      const body = {
        estado: newEstado,
        fecha_completado:
          newEstado === "completado" ? new Date().toISOString().slice(0, 10) : null,
        progreso_pct: newEstado === "completado" ? 100 : 0,
      };
      return apiClient.patch<HitoRead>(
        `/avance/hitos/${hito.hito_id}`,
        body,
        session,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["avance", empresaCodigo] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error al actualizar hito");
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (newOrder: number[]) => {
      // Persiste cada hito con su nuevo orden (1, 2, 3...). Backend ya acepta
      // `orden: int | None` en HitoUpdate.
      await Promise.all(
        newOrder.map((id, idx) =>
          apiClient.patch<HitoRead>(
            `/avance/hitos/${id}`,
            { orden: idx + 1 },
            session,
          ),
        ),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["avance", empresaCodigo] });
      setLocalOrder(null);
      toast.success("Orden de hitos actualizado");
    },
    onError: (err) => {
      setLocalOrder(null);
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo guardar el orden",
      );
    },
  });

  const bulkCompleteMutation = useMutation({
    mutationFn: async () => {
      const pending = hitos.filter((h) => h.estado !== "completado");
      const today = new Date().toISOString().slice(0, 10);
      await Promise.all(
        pending.map((h) =>
          apiClient.patch<HitoRead>(
            `/avance/hitos/${h.hito_id}`,
            {
              estado: "completado",
              fecha_completado: today,
              progreso_pct: 100,
            },
            session,
          ),
        ),
      );
      return pending.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["avance", empresaCodigo] });
      toast.success(`${count} hito${count === 1 ? "" : "s"} marcado${count === 1 ? "" : "s"} como completado${count === 1 ? "" : "s"}`);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError
          ? err.detail
          : "Error al completar hitos en bloque",
      );
    },
  });

  const handleDragStart = (e: React.DragEvent<HTMLLIElement>, id: number) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    // Necesario en Firefox
    e.dataTransfer.setData("text/plain", String(id));
  };

  const handleDragOver = (e: React.DragEvent<HTMLLIElement>, id: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragOverId) setDragOverId(id);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLLIElement>, targetId: number) => {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    // Compute new order
    const baseOrder = orderedHitos.map((h) => h.hito_id);
    const fromIdx = baseOrder.indexOf(draggedId);
    const toIdx = baseOrder.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    const next = [...baseOrder];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, draggedId);
    setLocalOrder(next); // optimistic
    setDraggedId(null);
    setDragOverId(null);
    reorderMutation.mutate(next);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  // Empty state
  if (hitos.length === 0) {
    return (
      <div className="rounded-xl bg-gradient-to-br from-ink-100/30 to-ink-100/10 p-6 text-center ring-1 ring-hairline">
        <p className="text-sm text-ink-500">Sin hitos definidos.</p>
        {canEdit && (
          <button
            type="button"
            onClick={onAddHito}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cehta-green-700"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Agregar primer hito
          </button>
        )}
      </div>
    );
  }

  const pendingCount = hitos.filter((h) => h.estado !== "completado").length;
  const isReordering = reorderMutation.isPending;

  return (
    <div>
      <ul
        className={cn(
          "divide-y divide-hairline rounded-xl ring-1 ring-hairline bg-white/50",
          isReordering && "opacity-70 pointer-events-none",
        )}
      >
        {orderedHitos.map((hito) => {
          const completed = hito.estado === "completado";
          const dateInfo = getRelativeDate(hito.fecha_planificada, hito.estado);
          const isDragged = draggedId === hito.hito_id;
          const isDragOver = dragOverId === hito.hito_id;
          return (
            <li
              key={hito.hito_id}
              draggable={canEdit && hitos.length > 1}
              onDragStart={(e) => handleDragStart(e, hito.hito_id)}
              onDragOver={(e) => handleDragOver(e, hito.hito_id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, hito.hito_id)}
              onDragEnd={handleDragEnd}
              className={cn(
                "group flex items-center gap-2 px-3 py-2.5 transition-all duration-150",
                isDragged && "opacity-40",
                isDragOver && "bg-cehta-green/8 ring-2 ring-inset ring-cehta-green/30",
                !isDragged && !isDragOver && "hover:bg-ink-50/60",
              )}
            >
              {/* Drag handle */}
              {canEdit && hitos.length > 1 && (
                <span
                  className="cursor-grab text-ink-300 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
                  aria-label="Arrastrar para reordenar"
                  title="Arrastrar para reordenar"
                >
                  <GripVertical className="h-4 w-4" strokeWidth={1.5} />
                </span>
              )}

              {/* Checkbox */}
              <button
                type="button"
                disabled={!canEdit || toggleMutation.isPending}
                onClick={() => toggleMutation.mutate(hito)}
                aria-label={
                  completed ? "Marcar como pendiente" : "Marcar como completado"
                }
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 transition-all duration-150",
                  completed
                    ? "bg-positive text-white ring-positive shadow-sm"
                    : "bg-white text-ink-300 ring-hairline hover:scale-110 hover:ring-cehta-green hover:text-cehta-green",
                  !canEdit && "cursor-not-allowed opacity-60",
                )}
              >
                {completed ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                ) : (
                  <Circle className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
              </button>

              {/* Texto del hito */}
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
                  <p className="text-[11px] text-ink-500">
                    {toDate(hito.fecha_planificada)}
                    {hito.fecha_completado &&
                      ` · Completado ${toDate(hito.fecha_completado)}`}
                  </p>
                )}
              </div>

              {/* Progreso si > 0 y no completado */}
              {!completed && hito.progreso_pct > 0 && (
                <span className="text-xs font-medium tabular-nums text-ink-600">
                  {hito.progreso_pct}%
                </span>
              )}

              {/* Fecha relativa pill */}
              {dateInfo && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium",
                    TONE_CLASS[dateInfo.tone],
                  )}
                >
                  {dateInfo.relative}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {/* Footer actions */}
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onAddHito}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-cehta-green transition-colors hover:bg-cehta-green/10"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Agregar hito
          </button>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={() => bulkCompleteMutation.mutate()}
              disabled={bulkCompleteMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-positive/30 bg-white px-2.5 py-1.5 text-xs font-medium text-positive transition-colors hover:bg-positive/5 disabled:opacity-50"
              title={`Marcar ${pendingCount} hitos pendientes como completados`}
            >
              <CheckSquare className="h-3.5 w-3.5" strokeWidth={2} />
              {bulkCompleteMutation.isPending
                ? "Procesando..."
                : `Completar ${pendingCount} pendientes`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
