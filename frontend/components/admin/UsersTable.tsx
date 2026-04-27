"use client";

/**
 * UsersTable — gestión de roles de usuarios.
 *
 * - Cambio de rol inline (`<select>`) → PATCH /admin/users/{id}/role
 * - Eliminar (revocar acceso) → DELETE /admin/users/{id}, con confirmación.
 * - Auto-protección: el usuario actual no puede borrarse a sí mismo
 *   (botón disabled + tooltip explicativo).
 * - Gating fino: el botón eliminar solo aparece si
 *   `me.allowed_actions.includes("user:delete")`.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldOff, Trash2, UserPlus, PlugZap } from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useMe } from "@/hooks/use-me";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleTooltip } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { toDate } from "@/lib/format";
import {
  ADMIN_ENDPOINTS,
  APP_ROLES,
  roleLabel,
  roleVariant,
  type UpdateUserRoleRequest,
  type UserRoleRead,
} from "@/lib/admin/queries";
import { InviteUserDialog } from "./InviteUserDialog";

const COLUMNS = ["Email", "Nombre", "Rol", "Asignado", "Asignado por", ""];

function TableSkeleton() {
  return (
    <Surface padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-hairline text-sm">
          <thead className="bg-ink-100/40">
            <tr>
              {COLUMNS.map((h, idx) => (
                <th
                  key={`${h}-${idx}`}
                  className="px-4 py-3 text-left text-xs uppercase tracking-wide text-ink-500 font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {Array.from({ length: 4 }).map((_, i) => (
              <tr key={i}>
                {COLUMNS.map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <Skeleton className="h-4 w-24" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

export function UsersTable() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { data, isLoading, error } = useApiQuery<UserRoleRead[]>(
    ["admin-users"],
    ADMIN_ENDPOINTS.users(),
  );

  const [confirmDelete, setConfirmDelete] = useState<UserRoleRead | null>(null);

  const isEndpointMissing =
    error instanceof ApiError && (error.status === 404 || error.status === 405);

  const canDelete = me?.allowed_actions?.includes("user:delete") ?? false;

  // Mutations ----------------------------------------------------------------

  const roleMutation = useMutation<
    UserRoleRead,
    Error,
    { userId: string; body: UpdateUserRoleRequest; email: string | null }
  >({
    mutationFn: ({ userId, body }) =>
      apiClient.patch<UserRoleRead>(
        ADMIN_ENDPOINTS.userRole(userId),
        body,
        session,
      ),
    onMutate: async ({ userId, body }) => {
      await queryClient.cancelQueries({ queryKey: ["admin-users"] });
      const previous = queryClient.getQueryData<UserRoleRead[]>([
        "admin-users",
      ]);
      queryClient.setQueryData<UserRoleRead[]>(["admin-users"], (old) =>
        old?.map((u) =>
          u.user_id === userId ? { ...u, app_role: body.app_role } : u,
        ),
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      const ctx = context as { previous?: UserRoleRead[] } | undefined;
      if (ctx?.previous) {
        queryClient.setQueryData(["admin-users"], ctx.previous);
      }
      toast.error("No se pudo cambiar el rol", {
        description: err instanceof Error ? err.message : "Error desconocido",
      });
    },
    onSuccess: (_data, vars) => {
      toast.success("Rol actualizado", {
        description: `${vars.email ?? "Usuario"} → ${vars.body.app_role}.`,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const deleteMutation = useMutation<
    void,
    Error,
    { userId: string; email: string | null }
  >({
    mutationFn: ({ userId }) =>
      apiClient.delete<void>(ADMIN_ENDPOINTS.user(userId), session),
    onSuccess: (_data, vars) => {
      toast.success("Usuario revocado", {
        description: `${vars.email ?? "El usuario"} ya no tiene acceso.`,
      });
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err) => {
      toast.error("No se pudo revocar", {
        description: err instanceof Error ? err.message : "Error desconocido",
      });
    },
  });

  // Render -------------------------------------------------------------------

  const items = data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-ink-500 tabular-nums">
          {data
            ? `${items.length} usuario${items.length !== 1 ? "s" : ""} con rol asignado`
            : "Cargando usuarios…"}
        </p>
        <InviteUserDialog />
      </div>

      {isLoading && <TableSkeleton />}

      {!isLoading && isEndpointMissing && (
        <Surface className="py-16">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
              <PlugZap className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
            </div>
            <p className="text-base font-semibold text-ink-900">
              Endpoint usuarios no disponible
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              El backend aún no expone{" "}
              <code className="font-mono text-xs">/admin/users</code>.
            </p>
          </div>
        </Surface>
      )}

      {!isLoading && error && !isEndpointMissing && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm font-medium text-negative">
            Error al cargar usuarios
          </p>
          <p className="mt-1 text-xs text-negative/80">
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
        </Surface>
      )}

      {!isLoading && !error && items.length === 0 && (
        <Surface className="py-16">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
              <UserPlus className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
            </div>
            <p className="text-base font-semibold text-ink-900">
              Sin usuarios con rol asignado
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              Asigná el primer rol con el botón &ldquo;Invitar usuario&rdquo;.
            </p>
          </div>
        </Surface>
      )}

      {!isLoading && !error && items.length > 0 && (
        <Surface padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-hairline text-sm">
              <thead className="bg-ink-100/40">
                <tr>
                  {COLUMNS.map((h, idx) => (
                    <th
                      key={`${h}-${idx}`}
                      className="px-4 py-3 text-left text-xs uppercase tracking-wide text-ink-500 font-medium"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {items.map((u) => {
                  const isSelf = me?.sub === u.user_id;
                  const isUpdatingRole =
                    roleMutation.isPending &&
                    roleMutation.variables?.userId === u.user_id;
                  return (
                    <tr
                      key={u.user_id}
                      className="transition-colors duration-150 hover:bg-ink-100/30"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-ink-900">
                        {u.email ?? "—"}
                        {isSelf && (
                          <span className="ml-2 text-xs text-ink-500">
                            (vos)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink-700">
                        {u.full_name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Badge variant={roleVariant(u.app_role)}>
                            {roleLabel(u.app_role)}
                          </Badge>
                          <select
                            aria-label={`Cambiar rol de ${u.email ?? u.user_id}`}
                            value={u.app_role}
                            disabled={isUpdatingRole}
                            onChange={(e) => {
                              const next = e.target.value;
                              if (next === u.app_role) return;
                              roleMutation.mutate({
                                userId: u.user_id,
                                body: { app_role: next },
                                email: u.email,
                              });
                            }}
                            className="rounded-lg bg-white px-2 py-1 text-xs text-ink-700 ring-1 ring-hairline transition-shadow focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:opacity-50"
                          >
                            {APP_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                          {isUpdatingRole && (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-ink-300"
                              strokeWidth={1.5}
                            />
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500 tabular-nums">
                        {u.assigned_at ? toDate(u.assigned_at) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500">
                        {u.assigned_by_email ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {canDelete ? (
                          isSelf ? (
                            <SimpleTooltip content="No puedes revocarte a vos mismo">
                              <button
                                type="button"
                                disabled
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-300"
                              >
                                <Trash2
                                  className="h-3.5 w-3.5"
                                  strokeWidth={1.5}
                                />
                                Revocar
                              </button>
                            </SimpleTooltip>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(u)}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-negative transition-colors hover:bg-negative/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative"
                            >
                              <Trash2
                                className="h-3.5 w-3.5"
                                strokeWidth={1.5}
                              />
                              Revocar
                            </button>
                          )
                        ) : (
                          <span className="text-xs text-ink-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* Confirm delete */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-negative">
              <ShieldOff className="h-5 w-5" strokeWidth={1.5} />
              Revocar acceso
            </DialogTitle>
            <DialogDescription>
              ¿Seguro que querés revocar el acceso de{" "}
              <strong className="text-ink-900">
                {confirmDelete?.email ?? "este usuario"}
              </strong>
              ? Perderá inmediatamente todos sus permisos en la plataforma.
              Podés volver a asignarle un rol más tarde.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (!confirmDelete) return;
                deleteMutation.mutate({
                  userId: confirmDelete.user_id,
                  email: confirmDelete.email,
                });
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-negative px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-negative/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {deleteMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
              )}
              Revocar acceso
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
