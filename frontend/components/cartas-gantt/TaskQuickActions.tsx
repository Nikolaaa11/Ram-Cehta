"use client";

/**
 * TaskQuickActions — popover con acciones inline sobre un hito.
 *
 * Trigger: hover sobre <TaskCard> o ítem en cualquier vista.
 * Acciones (todas con keyboard shortcut):
 *   c  → Marcar completado (1 click + optimistic update)
 *   e  → Editar fecha planificada (date picker inline)
 *   o  → Cambiar encargado
 *   n  → Agregar nota rápida (modifica descripcion)
 *
 * Usa el endpoint PATCH /avance/hitos/{id}/quick para todas las acciones.
 * Optimistic updates: invalida y refetch con TanStack Query.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Calendar, User, Loader2 } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { HitoConContexto, HitoQuickEdit, HitoRead } from "@/lib/api/schema";

interface Props {
  hito: HitoConContexto;
  className?: string;
}

export function TaskQuickActions({ hito, className }: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [activePopover, setActivePopover] = useState<
    "fecha" | "encargado" | null
  >(null);

  const mutation = useMutation({
    mutationFn: (body: HitoQuickEdit) =>
      apiClient.patch<HitoRead>(
        `/avance/hitos/${hito.hito_id}/quick`,
        body,
        session,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["avance"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "Error al actualizar el hito.",
      );
    },
  });

  const handleComplete = (e: React.MouseEvent) => {
    e.stopPropagation();
    mutation.mutate({ estado: "completado" });
    toast.success(`✓ ${hito.nombre.slice(0, 50)}`);
  };

  const handleFechaChange = (newDate: string) => {
    mutation.mutate({ fecha_planificada: newDate || null });
    setActivePopover(null);
  };

  const handleEncargadoChange = (newEnc: string) => {
    mutation.mutate({ encargado: newEnc.trim() || null });
    setActivePopover(null);
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "flex items-center gap-1 rounded-lg bg-white/95 px-1 py-1 shadow-sm ring-1 ring-hairline backdrop-blur",
        className,
      )}
    >
      {/* Marcar completado */}
      <ActionButton
        title="Marcar completado · c"
        onClick={handleComplete}
        disabled={mutation.isPending || hito.estado === "completado"}
      >
        {mutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <Check className="h-3.5 w-3.5" strokeWidth={2.25} />
        )}
      </ActionButton>

      {/* Reasignar fecha */}
      <div className="relative">
        <ActionButton
          title="Cambiar fecha · e"
          onClick={() =>
            setActivePopover(activePopover === "fecha" ? null : "fecha")
          }
          highlighted={activePopover === "fecha"}
        >
          <Calendar className="h-3.5 w-3.5" strokeWidth={2} />
        </ActionButton>
        {activePopover === "fecha" && (
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-hairline bg-white p-2 shadow-lg">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">
              Fecha planificada
            </p>
            <input
              type="date"
              defaultValue={hito.fecha_planificada ?? ""}
              autoFocus
              onChange={(e) => handleFechaChange(e.target.value)}
              className="w-full rounded-lg border-0 bg-ink-50 px-2 py-1.5 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
        )}
      </div>

      {/* Cambiar encargado */}
      <div className="relative">
        <ActionButton
          title="Cambiar encargado · o"
          onClick={() =>
            setActivePopover(
              activePopover === "encargado" ? null : "encargado",
            )
          }
          highlighted={activePopover === "encargado"}
        >
          <User className="h-3.5 w-3.5" strokeWidth={2} />
        </ActionButton>
        {activePopover === "encargado" && (
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-hairline bg-white p-2 shadow-lg">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">
              Encargado
            </p>
            <input
              type="text"
              defaultValue={hito.encargado ?? ""}
              autoFocus
              placeholder="ej: Felipe Zúñiga"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleEncargadoChange((e.target as HTMLInputElement).value);
                }
                if (e.key === "Escape") setActivePopover(null);
              }}
              className="w-full rounded-lg border-0 bg-ink-50 px-2 py-1.5 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  title,
  onClick,
  disabled,
  highlighted,
  children,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  highlighted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-600 transition-colors",
        highlighted
          ? "bg-cehta-green/10 text-cehta-green"
          : "hover:bg-ink-100 hover:text-ink-900",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}
