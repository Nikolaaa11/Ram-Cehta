"use client";

/**
 * OcActions — botones de acción en el header del detalle de OC.
 *
 * Muestra Editar/Marcar pagada/Anular según `oc.allowed_actions` (computado
 * server-side combinando rbac.ROLE_SCOPES + estado de la OC).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, Edit, XCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";

interface Props {
  ocId: number;
  numeroOc: string;
  allowedActions: string[];
}

const linkBtn =
  "inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2";
const successBtn =
  "inline-flex items-center gap-2 rounded-xl bg-cehta-green px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60";
const dangerBtn =
  "inline-flex items-center gap-2 rounded-xl bg-negative/10 px-3.5 py-2 text-sm font-medium text-negative ring-1 ring-negative/20 transition-colors hover:bg-negative/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative focus-visible:ring-offset-2";

export function OcActions({ ocId, numeroOc, allowedActions }: Props) {
  const router = useRouter();
  const { session } = useSession();
  const queryClient = useQueryClient();

  const canEdit = allowedActions.includes("update");
  const canCancel = allowedActions.includes("cancel");
  const canMarkPaid = allowedActions.includes("mark_paid");

  const estadoMutation = useMutation({
    mutationFn: (estado: "pagada" | "anulada") =>
      apiClient.patch<unknown>(
        `/ordenes-compra/${ocId}/estado`,
        { estado },
        session,
      ),
    onSuccess: async (_data, estado) => {
      toast.success(
        estado === "pagada"
          ? `OC ${numeroOc} marcada como pagada`
          : `OC ${numeroOc} anulada`,
      );
      await queryClient.invalidateQueries({ queryKey: ["ordenes-compra"] });
      await queryClient.invalidateQueries({ queryKey: ["solicitudes-pago"] });
      router.refresh();
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error al actualizar la OC",
      );
    },
  });

  if (!canEdit && !canCancel && !canMarkPaid) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && (
        <Link
          href={`/ordenes-compra/${ocId}/editar`}
          className={linkBtn}
          aria-label={`Editar OC ${numeroOc}`}
        >
          <Edit className="h-4 w-4" strokeWidth={1.5} />
          Editar
        </Link>
      )}
      {canMarkPaid && (
        <button
          type="button"
          onClick={() => estadoMutation.mutate("pagada")}
          disabled={estadoMutation.isPending}
          className={successBtn}
        >
          <CheckCircle className="h-4 w-4" strokeWidth={1.5} />
          {estadoMutation.isPending && estadoMutation.variables === "pagada"
            ? "Guardando…"
            : "Marcar pagada"}
        </button>
      )}
      {canCancel && (
        <ConfirmDeleteDialog
          trigger={
            <button type="button" className={dangerBtn}>
              <XCircle className="h-4 w-4" strokeWidth={1.5} />
              Anular
            </button>
          }
          title={`¿Anular OC ${numeroOc}?`}
          description={
            <>
              La orden de compra quedará como{" "}
              <span className="font-medium text-ink-900">anulada</span> y no
              podrá emitirse ni pagarse. Esta acción se registra en el
              historial.
            </>
          }
          confirmText="Anular OC"
          onConfirm={() => estadoMutation.mutateAsync("anulada")}
        />
      )}
    </div>
  );
}
