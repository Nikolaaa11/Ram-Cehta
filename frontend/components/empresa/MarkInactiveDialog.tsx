"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserMinus } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trabajador: { trabajador_id: number; nombre_completo: string };
  onSuccess: () => void;
}

export function MarkInactiveDialog({
  open,
  onOpenChange,
  trabajador,
  onSuccess,
}: Props) {
  const { session } = useSession();
  const [fechaEgreso, setFechaEgreso] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [motivo, setMotivo] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post(
        `/trabajadores/${trabajador.trabajador_id}/inactivar`,
        { fecha_egreso: fechaEgreso, motivo: motivo || null },
        session,
      ),
    onSuccess: () => {
      toast.success(`${trabajador.nombre_completo} marcado como inactivo`);
      onSuccess();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "Error al marcar inactivo",
      );
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <div className="flex gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
            <UserMinus className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <div className="flex-1">
            <AlertDialogTitle>
              Marcar {trabajador.nombre_completo} como inactivo
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esto cambia su estado a inactivo y mueve su carpeta Dropbox de
              Activos/ a Inactivos/. Sus documentos se conservan en histórico.
            </AlertDialogDescription>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Fecha de egreso *
            </label>
            <input
              type="date"
              value={fechaEgreso}
              onChange={(e) => setFechaEgreso(e.target.value)}
              required
              className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Motivo (opcional)
            </label>
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Renuncia / Despido / Fin de plazo"
              className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="rounded-xl bg-warning px-4 py-2 text-sm font-medium text-white hover:bg-warning/90 disabled:opacity-60"
          >
            {mutation.isPending ? "Procesando..." : "Marcar inactivo"}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
