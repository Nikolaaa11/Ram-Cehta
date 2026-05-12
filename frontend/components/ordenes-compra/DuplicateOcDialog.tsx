"use client";

/**
 * DuplicateOcDialog — modal para POST /ordenes-compra/{id}/duplicate.
 *
 * Pide solo lo que cambia (numero_oc nuevo obligatorio, fecha y observaciones
 * opcionales). El backend copia proveedor, items, montos, forma_pago, moneda
 * y plazo_pago del original. Si el numero_oc ya existe en la empresa, el
 * backend responde 409 y el toast lo refleja.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Props {
  ocId: number;
  numeroOcOriginal: string;
  trigger: React.ReactNode;
}

interface DuplicateResponse {
  oc_id: number;
  numero_oc: string;
}

export function DuplicateOcDialog({ ocId, numeroOcOriginal, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [numeroOc, setNumeroOc] = useState("");
  const [fechaEmision, setFechaEmision] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<DuplicateResponse>(
        `/ordenes-compra/${ocId}/duplicate`,
        {
          numero_oc: numeroOc.trim(),
          fecha_emision: fechaEmision || null,
          observaciones: observaciones || null,
        },
        session,
      ),
    onSuccess: async (resp) => {
      toast.success(`OC ${resp.numero_oc} creada desde ${numeroOcOriginal}`);
      await queryClient.invalidateQueries({ queryKey: ["ordenes-compra"] });
      setOpen(false);
      router.push(`/ordenes-compra/${resp.oc_id}`);
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error al duplicar la OC",
      );
    },
  });

  const canSubmit = numeroOc.trim().length > 0 && !mutation.isPending;

  function handleOpenChange(next: boolean) {
    if (mutation.isPending) return;
    if (!next) {
      setNumeroOc("");
      setFechaEmision("");
      setObservaciones("");
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <div className="flex gap-4">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cehta-green/10 text-cehta-green"
            aria-hidden="true"
          >
            <Copy className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <div className="flex-1">
            <DialogTitle>Duplicar OC {numeroOcOriginal}</DialogTitle>
            <DialogDescription className="mt-1.5">
              Se copia proveedor, items, montos, forma de pago, plazo, moneda
              y validez. Solo cambian los datos que indiques abajo. La nueva OC
              arranca en estado <span className="font-medium">emitida</span>.
            </DialogDescription>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) mutation.mutate();
          }}
          className="mt-5 space-y-4"
        >
          <div>
            <label
              htmlFor="dup-numero-oc"
              className="block text-xs font-medium text-ink-700"
            >
              Nuevo número OC *
            </label>
            <input
              id="dup-numero-oc"
              required
              autoFocus
              value={numeroOc}
              onChange={(e) => setNumeroOc(e.target.value)}
              placeholder="Ej: OC-2026-042"
              maxLength={50}
              className="mt-1 block w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
            <p className="mt-1 text-xs text-ink-500">
              Debe ser único dentro de la empresa. Si ya existe, vas a ver un
              error y nada se crea.
            </p>
          </div>
          <div>
            <label
              htmlFor="dup-fecha"
              className="block text-xs font-medium text-ink-700"
            >
              Fecha de emisión <span className="text-ink-500">(opcional)</span>
            </label>
            <input
              id="dup-fecha"
              type="date"
              value={fechaEmision}
              onChange={(e) => setFechaEmision(e.target.value)}
              className="mt-1 block w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
            <p className="mt-1 text-xs text-ink-500">
              Si lo dejás vacío, se usa la fecha de hoy.
            </p>
          </div>
          <div>
            <label
              htmlFor="dup-obs"
              className="block text-xs font-medium text-ink-700"
            >
              Observaciones <span className="text-ink-500">(opcional)</span>
            </label>
            <textarea
              id="dup-obs"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
              placeholder="Si lo dejás vacío, se heredan del original"
              className="mt-1 block w-full resize-none rounded-xl border border-hairline bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-3">
            <DialogClose asChild>
              <button
                type="button"
                disabled={mutation.isPending}
                className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 disabled:opacity-60"
              >
                Cancelar
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-60"
            >
              <Copy className="h-4 w-4" strokeWidth={1.5} />
              {mutation.isPending ? "Duplicando…" : "Duplicar OC"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
