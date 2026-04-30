"use client";

/**
 * KanbanCard — tarjeta arrastrable de una OC dentro del Kanban.
 *
 * - `useDraggable` de @dnd-kit/core para drag-and-drop.
 * - Click (sin drag) navega al detalle. Detectamos drag vs click con
 *   `isDragging`: si es false al onClick, fue tap puro.
 * - Si la fila no permite ninguna transición útil (mark_paid / cancel)
 *   mostramos un 🔒 en la esquina y deshabilitamos el drag (`disabled`).
 *   El backend igual tiene la última palabra (per-OC RBAC en el endpoint).
 */
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Lock } from "lucide-react";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import type { OcListItem } from "@/lib/api/schema";
import { toCLP, toDate } from "@/lib/format";

interface Props {
  oc: OcListItem;
  /** Si false, la card muestra 🔒 y no puede arrastrarse. */
  draggable: boolean;
}

export function KanbanCard({ oc, draggable }: Props) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `oc-${oc.oc_id}`,
      data: { ocId: oc.oc_id, estado: oc.estado },
      disabled: !draggable,
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  const onClick = (e: React.MouseEvent) => {
    // Evitar navegar si el click vino del listener de drag
    // (dnd-kit dispara onClick al final del drag con un threshold corto).
    if (isDragging) {
      e.preventDefault();
      return;
    }
    router.push(`/ordenes-compra/${oc.oc_id}`);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative cursor-pointer rounded-xl bg-white p-3 ring-1 ring-hairline shadow-card transition-shadow duration-200 ease-apple hover:shadow-card-hover ${
        isDragging ? "ring-cehta-green" : ""
      }`}
      onClick={onClick}
      {...attributes}
    >
      {/* Drag handle — solo visible en hover */}
      {draggable && (
        <div
          {...listeners}
          className="absolute left-1 top-1/2 -translate-y-1/2 cursor-grab opacity-0 transition-opacity group-hover:opacity-60 active:cursor-grabbing"
          aria-label={`Arrastrar OC ${oc.numero_oc}`}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4 text-ink-500" strokeWidth={1.5} />
        </div>
      )}

      {/* Indicador 🔒 si no puede moverse */}
      {!draggable && (
        <div
          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-ink-100/60 text-ink-500"
          title="Sin permiso para mover esta OC"
        >
          <Lock className="h-3 w-3" strokeWidth={1.5} />
        </div>
      )}

      <div className={`pl-${draggable ? "4" : "0"} space-y-1.5`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-medium text-ink-900">
            {oc.numero_oc}
          </span>
          <span className="rounded-full bg-ink-100/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-700">
            {oc.moneda}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-ink-700">
          <EmpresaLogo empresaCodigo={oc.empresa_codigo} size={16} />
          <span>{oc.empresa_codigo}</span>
        </div>

        <div className="text-sm font-medium text-ink-900 tabular-nums">
          {oc.moneda === "CLP" ? toCLP(oc.total) : `${oc.moneda} ${oc.total}`}
        </div>

        <div className="flex items-center justify-between text-[11px] text-ink-500">
          <span>
            {oc.proveedor_id ? `Prov #${oc.proveedor_id}` : "Sin proveedor"}
          </span>
          <span className="tabular-nums">{toDate(oc.fecha_emision)}</span>
        </div>
      </div>
    </div>
  );
}
