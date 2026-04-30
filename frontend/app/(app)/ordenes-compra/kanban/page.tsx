"use client";

/**
 * /ordenes-compra/kanban — vista Kanban con drag-and-drop entre estados.
 *
 * Diseño:
 *  - 4 columnas accionables: emitida, aprobada, pagada, anulada (las
 *    excepcionales borrador/parcial/pendiente/rechazada quedan visibles
 *    en la lista clásica).
 *  - Filtro por empresa sincronizado con `?empresa=CODIGO` (refresh-safe).
 *  - View toggle "Lista | Kanban" — la otra vista vive en /ordenes-compra.
 *  - Optimistic UI: la card se mueve al instante; en error se revierte
 *    + toast con el mensaje del backend.
 *  - Authorization-aware: las cards sin acción accionable muestran 🔒 y
 *    no se pueden arrastrar (el backend igual valida en el endpoint).
 *
 * Notas de implementación:
 *  - Reusa `PATCH /api/v1/ordenes-compra/{id}/estado`. Sin cambios backend.
 *  - El endpoint sólo acepta `emitida|pagada|anulada|parcial` como destino
 *    (la transición a `aprobada` aún no existe en backend). Si el user
 *    suelta una card en la columna `aprobada`, el 422 se muestra como
 *    toast y la card vuelve a su columna — soft-fail by design.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { LayoutGrid, ListIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Surface } from "@/components/ui/surface";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import {
  KANBAN_ESTADOS,
  useOcKanban,
  useUpdateOcEstado,
  type KanbanEstado,
} from "@/hooks/use-oc-kanban";
import { ApiError } from "@/lib/api/client";
import { KanbanColumn } from "@/components/ordenes-compra/KanbanColumn";
import type { OcListItem } from "@/lib/api/schema";

const KANBAN_SET = new Set<string>(KANBAN_ESTADOS);

/** Mapea una columna destino a la acción RBAC requerida (matching backend). */
const ESTADO_ACTION: Record<KanbanEstado, string | null> = {
  emitida: null, // no hay vuelta atrás soportada en backend
  aprobada: "approve", // backend aún no soporta — surface 422
  pagada: "mark_paid",
  anulada: "cancel",
};

function ToggleViewButtons() {
  return (
    <div className="inline-flex rounded-xl bg-ink-100/50 p-0.5 ring-1 ring-hairline">
      <Link
        href="/ordenes-compra"
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:bg-white/60"
      >
        <ListIcon className="h-4 w-4" strokeWidth={1.5} />
        Lista
      </Link>
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-ink-900 shadow-card">
        <LayoutGrid className="h-4 w-4" strokeWidth={1.5} />
        Kanban
      </span>
    </div>
  );
}

export default function OrdenesCompraKanbanPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const empresaParam = searchParams.get("empresa") ?? "";
  const [empresa, setEmpresa] = useState(empresaParam);

  // Mantener URL en sync con el filtro (refresh-safe).
  useEffect(() => {
    if (empresa === empresaParam) return;
    const next = new URLSearchParams(searchParams.toString());
    if (empresa) next.set("empresa", empresa);
    else next.delete("empresa");
    router.replace(`/ordenes-compra/kanban?${next.toString()}`, {
      scroll: false,
    });
  }, [empresa, empresaParam, router, searchParams]);

  const { data: empresas = [] } = useCatalogoEmpresas();
  const { data, isLoading, isError, error } = useOcKanban(empresa);
  const mutation = useUpdateOcEstado();

  // Estado local de OCs — permite optimistic UI (mover card antes de la
  // respuesta del backend). Se sincroniza cuando el query trae nuevos datos.
  const [items, setItems] = useState<OcListItem[]>([]);
  useEffect(() => {
    if (data) setItems(data.items);
  }, [data]);

  const empresaItems = useMemo<ComboboxItem[]>(
    () => [
      { value: "", label: "Todas las empresas" },
      ...empresas.map((e) => ({
        value: e.codigo,
        label: `${e.codigo} — ${e.razon_social}`,
      })),
    ],
    [empresas],
  );

  // Agrupa por estado, filtrando estados fuera del kanban.
  const byEstado = useMemo(() => {
    const groups: Record<KanbanEstado, OcListItem[]> = {
      emitida: [],
      aprobada: [],
      pagada: [],
      anulada: [],
    };
    for (const oc of items) {
      const e = oc.estado.toLowerCase();
      if (KANBAN_SET.has(e)) {
        groups[e as KanbanEstado].push(oc);
      }
    }
    return groups;
  }, [items]);

  /**
   * Determina si una OC dada puede arrastrarse. Como dnd-kit no soporta
   * "puedo soltarla en X pero no en Y" sin un `useDroppable` por par
   * column×card, simplificamos: una card es draggable si el user puede
   * hacer al menos una transición útil desde su estado actual.
   */
  const canDragItem = (oc: OcListItem): boolean => {
    const a = oc.allowed_actions ?? [];
    return a.includes("mark_paid") || a.includes("cancel");
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }, // evita activar drag con click corto
    }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const ocId = active.data.current?.ocId as number | undefined;
    const fromEstado = active.data.current?.estado as string | undefined;
    const toEstado = over.data.current?.estado as KanbanEstado | undefined;
    if (!ocId || !toEstado || !fromEstado || fromEstado === toEstado) return;

    const oc = items.find((i) => i.oc_id === ocId);
    if (!oc) return;

    const requiredAction = ESTADO_ACTION[toEstado];
    if (!requiredAction || !oc.allowed_actions.includes(requiredAction)) {
      toast.error(
        `No tienes permiso para mover esa OC a ${toEstado}`,
      );
      return;
    }

    // Optimistic update — mover la card a la nueva columna.
    const prev = items;
    setItems((curr) =>
      curr.map((i) => (i.oc_id === ocId ? { ...i, estado: toEstado } : i)),
    );

    try {
      await mutation.mutateAsync({ ocId, estado: toEstado });
      toast.success(`OC ${oc.numero_oc} movida a ${toEstado}`);
    } catch (err) {
      // Revert
      setItems(prev);
      const detail =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error al mover la OC";
      toast.error(detail);
    }
  };

  const total = items.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            Kanban OCs
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {data
              ? `${total} orden${total !== 1 ? "es" : ""} en columnas accionables`
              : "Cargando órdenes…"}
          </p>
        </div>
        <ToggleViewButtons />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs uppercase tracking-wide text-ink-500 font-medium">
            Empresa
          </label>
          <Combobox
            items={empresaItems}
            value={empresa}
            onValueChange={setEmpresa}
            placeholder="Todas las empresas"
            triggerClassName="min-w-[14rem]"
          />
        </div>
        {mutation.isPending && (
          <div className="ml-auto flex items-center gap-2 text-xs text-ink-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            Guardando…
          </div>
        )}
      </div>

      {/* Error state */}
      {isError && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm font-medium text-negative">
            Error al cargar órdenes
          </p>
          <p className="mt-1 text-xs text-negative/80">{error?.message}</p>
        </Surface>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {KANBAN_ESTADOS.map((e) => (
            <div
              key={e}
              className="h-96 w-72 shrink-0 animate-pulse rounded-2xl bg-ink-100/40"
            />
          ))}
        </div>
      )}

      {/* Board */}
      {data && !isLoading && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4">
            {KANBAN_ESTADOS.map((estado) => (
              <KanbanColumn
                key={estado}
                estado={estado}
                items={byEstado[estado]}
                canDragItem={canDragItem}
              />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}
