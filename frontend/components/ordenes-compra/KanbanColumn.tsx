"use client";

/**
 * KanbanColumn — columna drop-zone para un estado de OC.
 *
 * - `useDroppable` resalta la columna cuando hay una card encima (isOver).
 * - El header lleva un dot del color asociado al estado + count badge.
 * - Empty state minimalista cuando no hay items.
 */
import { useDroppable } from "@dnd-kit/core";
import type { OcListItem } from "@/lib/api/schema";
import type { KanbanEstado } from "@/hooks/use-oc-kanban";
import { KanbanCard } from "./KanbanCard";

interface Props {
  estado: KanbanEstado;
  items: OcListItem[];
  /** Determina si una OC dada en esta columna puede ser arrastrada. */
  canDragItem: (oc: OcListItem) => boolean;
}

const ESTADO_LABEL: Record<KanbanEstado, string> = {
  emitida: "Emitida",
  aprobada: "Aprobada",
  pagada: "Pagada",
  anulada: "Anulada",
};

const ESTADO_DOT: Record<KanbanEstado, string> = {
  emitida: "bg-warning",
  aprobada: "bg-sf-blue",
  pagada: "bg-positive",
  anulada: "bg-ink-300",
};

const ESTADO_RING_OVER: Record<KanbanEstado, string> = {
  emitida: "ring-warning/40 bg-warning/5",
  aprobada: "ring-sf-blue/40 bg-sf-blue/5",
  pagada: "ring-positive/40 bg-positive/5",
  anulada: "ring-ink-300/60 bg-ink-100/40",
};

export function KanbanColumn({ estado, items, canDragItem }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col-${estado}`,
    data: { estado },
  });

  return (
    <div className="flex w-72 shrink-0 flex-col gap-3">
      {/* Column header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${ESTADO_DOT[estado]}`}
            aria-hidden
          />
          <h3 className="text-sm font-semibold text-ink-900">
            {ESTADO_LABEL[estado]}
          </h3>
        </div>
        <span className="rounded-full bg-ink-100/60 px-2 py-0.5 text-xs font-medium text-ink-700 tabular-nums">
          {items.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`min-h-[24rem] rounded-2xl bg-ink-100/30 p-2 ring-1 ring-hairline transition-colors duration-200 ease-apple ${
          isOver ? ESTADO_RING_OVER[estado] : ""
        }`}
      >
        {items.length === 0 ? (
          <div className="flex h-32 items-center justify-center px-4 text-center">
            <p className="text-xs text-ink-500">
              Arrastrá OCs acá para moverlas a {ESTADO_LABEL[estado]}.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((oc) => (
              <KanbanCard
                key={oc.oc_id}
                oc={oc}
                draggable={canDragItem(oc)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
