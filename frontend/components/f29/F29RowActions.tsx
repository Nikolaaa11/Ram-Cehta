"use client";

/**
 * F29RowActions — botones por fila en la tabla F29.
 *
 *  - "Marcar pagado": abre MarkPaidDialog (sólo si estado=pendiente y user
 *    tiene `f29:update`).
 *  - Eliminar: ConfirmDeleteDialog → DELETE /f29/{id} (sólo admin con
 *    `f29:delete`).
 *
 * Permisos derivados de `me.allowed_actions` (Disciplina 3).
 */
import { useState } from "react";
import { CheckCircle, Pencil, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { F29EditDialog } from "./F29EditDialog";
import { MarkPaidDialog } from "./MarkPaidDialog";
import type { F29Read } from "@/lib/api/schema";

interface Props {
  f29: F29Read;
  canUpdate: boolean;
  canDelete: boolean;
}

const successPill =
  "inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2";
const ghostPill =
  "inline-flex h-7 w-7 items-center justify-center rounded-lg bg-cehta-green/10 text-cehta-green ring-1 ring-cehta-green/20 transition-colors hover:bg-cehta-green/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green";
const dangerPill =
  "inline-flex h-7 w-7 items-center justify-center rounded-lg bg-negative/10 text-negative ring-1 ring-negative/20 transition-colors hover:bg-negative/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative";

export function F29RowActions({ f29, canUpdate, canDelete }: Props) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const showMarkPaid = canUpdate && f29.estado === "pendiente";

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete<void>(`/f29/${f29.f29_id}`, session),
    onMutate: async () => {
      // Optimistic update: removemos la fila localmente; revertimos en error.
      await queryClient.cancelQueries({ queryKey: ["f29"] });
      const snapshot = queryClient.getQueriesData<{
        items: F29Read[];
        total: number;
      }>({ queryKey: ["f29"] });
      snapshot.forEach(([key, data]) => {
        if (!data) return;
        queryClient.setQueryData(key, {
          ...data,
          items: data.items.filter((it) => it.f29_id !== f29.f29_id),
          total: Math.max(0, data.total - 1),
        });
      });
      return { snapshot };
    },
    onSuccess: () => {
      toast.success(
        `F29 ${f29.empresa_codigo} ${f29.periodo_tributario} eliminada`,
      );
    },
    onError: (err, _vars, ctx) => {
      // Revert optimistic update
      ctx?.snapshot.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error al eliminar la F29",
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["f29"] });
    },
  });

  if (!showMarkPaid && !canDelete && !canUpdate) {
    return <span className="text-xs text-ink-300">—</span>;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {canUpdate && (
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className={ghostPill}
          aria-label={`Editar F29 ${f29.empresa_codigo} ${f29.periodo_tributario}`}
          title="Editar"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      )}
      {showMarkPaid && (
        <MarkPaidDialog
          f29Id={f29.f29_id}
          empresaCodigo={f29.empresa_codigo}
          periodo={f29.periodo_tributario}
          trigger={
            <button type="button" className={successPill}>
              <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
              Marcar pagado
            </button>
          }
        />
      )}
      {canDelete && (
        <ConfirmDeleteDialog
          trigger={
            <button
              type="button"
              className={dangerPill}
              aria-label={`Eliminar F29 ${f29.empresa_codigo} ${f29.periodo_tributario}`}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          }
          title="¿Eliminar obligación F29?"
          description={
            <>
              Vas a eliminar la F29 de{" "}
              <span className="font-medium text-ink-900">
                {f29.empresa_codigo}
              </span>{" "}
              del período{" "}
              <span className="font-medium text-ink-900">
                {f29.periodo_tributario}
              </span>
              . Esta acción no se puede deshacer.
            </>
          }
          confirmText="Eliminar"
          onConfirm={() => deleteMutation.mutateAsync()}
        />
      )}
      {canUpdate && (
        <F29EditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          f29={f29}
        />
      )}
    </div>
  );
}
