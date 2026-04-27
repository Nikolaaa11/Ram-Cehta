"use client";

/**
 * ProveedorActions — botones Editar/Eliminar en el header del detalle de
 * proveedor (client island dentro de un server component).
 *
 * Permisos (Disciplina 3): se leen exclusivamente desde
 * `me.allowed_actions`, derivado server-side desde rbac.ROLE_SCOPES. Nunca
 * inferir desde `app_role`.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Edit, Trash2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { useMe } from "@/hooks/use-me";
import { apiClient, ApiError } from "@/lib/api/client";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";

interface Props {
  proveedorId: number;
  razonSocial: string;
}

const linkBtn =
  "inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2";
const dangerBtn =
  "inline-flex items-center gap-2 rounded-xl bg-negative/10 px-3.5 py-2 text-sm font-medium text-negative ring-1 ring-negative/20 transition-colors hover:bg-negative/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative focus-visible:ring-offset-2";

export function ProveedorActions({ proveedorId, razonSocial }: Props) {
  const router = useRouter();
  const { session } = useSession();
  const { data: me } = useMe();
  const queryClient = useQueryClient();

  const canEdit = me?.allowed_actions.includes("proveedor:update") ?? false;
  const canDelete = me?.allowed_actions.includes("proveedor:delete") ?? false;

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiClient.delete<void>(`/proveedores/${proveedorId}`, session),
    onSuccess: async () => {
      toast.success(`Proveedor "${razonSocial}" eliminado`);
      await queryClient.invalidateQueries({ queryKey: ["proveedores"] });
      router.push("/proveedores");
      router.refresh();
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error al eliminar el proveedor",
      );
    },
  });

  if (!canEdit && !canDelete) return null;

  return (
    <div className="flex items-center gap-2">
      {canEdit && (
        <Link
          href={`/proveedores/${proveedorId}/editar`}
          className={linkBtn}
          aria-label={`Editar proveedor ${razonSocial}`}
        >
          <Edit className="h-4 w-4" strokeWidth={1.5} />
          Editar
        </Link>
      )}
      {canDelete && (
        <ConfirmDeleteDialog
          trigger={
            <button type="button" className={dangerBtn}>
              <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              Eliminar
            </button>
          }
          title="¿Eliminar proveedor?"
          description={
            <>
              Esta acción marca el proveedor{" "}
              <span className="font-medium text-ink-900">
                &ldquo;{razonSocial}&rdquo;
              </span>{" "}
              como inactivo. Sus OCs históricas se conservan, pero no podrá
              seleccionarse en nuevas órdenes de compra.
            </>
          }
          confirmText="Eliminar"
          onConfirm={() => deleteMutation.mutateAsync()}
        />
      )}
    </div>
  );
}
