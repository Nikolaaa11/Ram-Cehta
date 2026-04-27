"use client";

/**
 * MarkPaidDialog — modal Apple-style con form para marcar una F29 como
 * pagada.
 *
 * Form: fecha_pago (date, default hoy) + comprobante_url (text, opcional).
 * Submit → PATCH /f29/{id}, invalida la query y cierra.
 */
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import type { F29Read } from "@/lib/api/schema";

interface Props {
  trigger: React.ReactNode;
  f29Id: number;
  empresaCodigo: string;
  periodo: string;
}

const inputBase =
  "w-full rounded-lg border-0 ring-1 ring-hairline bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 transition-shadow focus:outline-none focus:ring-2 focus:ring-cehta-green";
const labelBase = "mb-1.5 block text-sm font-medium text-ink-700";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MarkPaidDialog({
  trigger,
  f29Id,
  empresaCodigo,
  periodo,
}: Props) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fechaPago, setFechaPago] = useState(todayISO());
  const [comprobanteUrl, setComprobanteUrl] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch<F29Read>(
        `/f29/${f29Id}`,
        {
          estado: "pagado",
          fecha_pago: fechaPago,
          comprobante_url: comprobanteUrl || null,
        },
        session,
      ),
    onSuccess: async () => {
      toast.success(`F29 ${empresaCodigo} ${periodo} marcada como pagada`);
      await queryClient.invalidateQueries({ queryKey: ["f29"] });
      setOpen(false);
      // Reset for next open
      setFechaPago(todayISO());
      setComprobanteUrl("");
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error al marcar como pagada",
      );
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fechaPago) {
      toast.error("La fecha de pago es obligatoria");
      return;
    }
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <div className="flex gap-4">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cehta-green/10 text-cehta-green"
            aria-hidden="true"
          >
            <CheckCircle2 className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <div className="flex-1">
            <DialogHeader>
              <DialogTitle>Marcar F29 como pagada</DialogTitle>
              <DialogDescription>
                {empresaCodigo} · período {periodo}
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className={labelBase} htmlFor="fecha-pago">
              Fecha de pago <span className="text-negative">*</span>
            </label>
            <input
              id="fecha-pago"
              type="date"
              required
              value={fechaPago}
              onChange={(e) => setFechaPago(e.target.value)}
              className={`${inputBase} tabular-nums`}
            />
          </div>
          <div>
            <label className={labelBase} htmlFor="comprobante-url">
              Comprobante URL (opcional)
            </label>
            <input
              id="comprobante-url"
              type="url"
              value={comprobanteUrl}
              onChange={(e) => setComprobanteUrl(e.target.value)}
              placeholder="https://…/comprobante.pdf"
              className={inputBase}
            />
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <DialogClose asChild>
              <button
                type="button"
                disabled={mutation.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60"
              >
                Cancelar
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {mutation.isPending ? "Guardando…" : "Marcar pagada"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
