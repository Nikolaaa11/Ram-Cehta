"use client";

/**
 * InviteUserDialog — formulario para asignar un rol a un usuario existente.
 *
 * IMPORTANTE: este endpoint NO crea usuarios en Supabase Auth — el usuario
 * debe estar registrado en `auth.users` previamente. Si el backend devuelve
 * 404/422 ("usuario no existe"), mostramos un mensaje claro al respecto.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { toast } from "@/components/ui/toast";
import {
  ADMIN_ENDPOINTS,
  APP_ROLES,
  type AppRole,
  type CreateUserRoleRequest,
  type UserRoleRead,
} from "@/lib/admin/queries";

export function InviteUserDialog() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("viewer");

  const mutation = useMutation<UserRoleRead, Error, CreateUserRoleRequest>({
    mutationFn: (body) =>
      apiClient.post<UserRoleRead>(ADMIN_ENDPOINTS.users(), body, session),
    onSuccess: () => {
      toast.success("Rol asignado", {
        description: `${email} ahora es ${role}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setEmail("");
      setRole("viewer");
      setOpen(false);
    },
    onError: (err) => {
      let description = err instanceof Error ? err.message : "Error desconocido";
      if (
        err instanceof ApiError &&
        (err.status === 404 || err.status === 422)
      ) {
        description =
          "El usuario debe estar registrado en Supabase Auth primero. Crear el usuario via Supabase Dashboard antes de asignarle un rol.";
      }
      toast.error("No se pudo asignar el rol", { description });
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    mutation.mutate({ email: trimmed, app_role: role });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
        >
          <UserPlus className="h-4 w-4" strokeWidth={1.5} />
          Invitar usuario
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invitar usuario</DialogTitle>
          <DialogDescription>
            Asigná un rol a un usuario que ya esté registrado en Supabase Auth.
            Si el usuario no existe, créalo primero desde el dashboard de
            Supabase.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="invite-email"
              className="text-xs font-medium uppercase tracking-wide text-ink-500"
            >
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@cehtacapital.cl"
              className="block w-full rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 transition-shadow focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="invite-role"
              className="text-xs font-medium uppercase tracking-wide text-ink-500"
            >
              Rol
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
              className="block w-full rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline transition-shadow focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              {APP_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <p className="text-xs text-ink-500">
              <strong>admin</strong> tiene acceso total ·{" "}
              <strong>finance</strong> opera OCs, pagos y F29 ·{" "}
              <strong>viewer</strong> solo lectura.
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <button
              type="submit"
              disabled={mutation.isPending || !email.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {mutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
              )}
              Asignar rol
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
