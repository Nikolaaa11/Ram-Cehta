"use client";

/**
 * F29EditDialog — edita todos los campos del F29 (no solo mark paid).
 *
 * PATCH /f29/{id} con validación cross-field (estado=pagado exige fecha_pago).
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { F29Read } from "@/lib/api/schema";

type Estado = "pendiente" | "pagado" | "vencido" | "exento";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  f29: F29Read;
  onSaved?: () => void;
}

interface Form {
  estado: Estado;
  fecha_pago: string;
  comprobante_url: string;
  monto_a_pagar: string;
}

const inputCls =
  "w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green";
const labelCls = "mb-1 block text-xs font-medium text-ink-700";

function fromF29(f: F29Read): Form {
  return {
    estado: (f.estado as Estado) ?? "pendiente",
    fecha_pago: f.fecha_pago ?? "",
    comprobante_url: f.comprobante_url ?? "",
    monto_a_pagar: f.monto_a_pagar != null ? String(f.monto_a_pagar) : "",
  };
}

export function F29EditDialog({ open, onOpenChange, f29, onSaved }: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(fromF29(f29));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(fromF29(f29));
      setError(null);
    }
  }, [open, f29]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        estado: form.estado,
        comprobante_url: form.comprobante_url.trim() || null,
        monto_a_pagar: form.monto_a_pagar.trim()
          ? Number(form.monto_a_pagar)
          : null,
      };
      // Solo incluimos fecha_pago si tiene valor; si está vacía, mandamos null
      // para limpiarla en estados ≠ pagado.
      payload.fecha_pago = form.fecha_pago || null;
      return apiClient.patch<F29Read>(`/f29/${f29.f29_id}`, payload, session);
    },
    onSuccess: async () => {
      toast.success(
        `F29 ${f29.empresa_codigo} ${f29.periodo_tributario} actualizada`,
      );
      await qc.invalidateQueries({ queryKey: ["f29"] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.detail : "Error al actualizar F29",
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="flex gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cehta-green/10 text-cehta-green">
            <Pencil className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <div className="flex-1">
            <DialogTitle>Editar F29</DialogTitle>
            <DialogDescription>
              {f29.empresa_codigo} · período {f29.periodo_tributario}
            </DialogDescription>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (form.estado === "pagado" && !form.fecha_pago) {
              setError("estado=pagado requiere fecha de pago");
              return;
            }
            mutation.mutate();
          }}
          className="mt-5 space-y-3"
        >
          {error && (
            <div className="rounded-lg border border-negative/20 bg-negative/5 px-3 py-2 text-xs text-negative">
              {error}
            </div>
          )}
          <div>
            <label className={labelCls}>Estado</label>
            <select
              value={form.estado}
              onChange={(e) =>
                setForm({ ...form, estado: e.target.value as Estado })
              }
              className={inputCls}
            >
              <option value="pendiente">Pendiente</option>
              <option value="pagado">Pagado</option>
              <option value="vencido">Vencido</option>
              <option value="exento">Exento</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Monto a pagar</label>
            <input
              type="number"
              step="1"
              value={form.monto_a_pagar}
              onChange={(e) =>
                setForm({ ...form, monto_a_pagar: e.target.value })
              }
              className={`${inputCls} tabular-nums`}
              placeholder="0"
            />
          </div>
          <div>
            <label className={labelCls}>
              Fecha pago {form.estado === "pagado" && <span className="text-negative">*</span>}
            </label>
            <input
              type="date"
              value={form.fecha_pago}
              onChange={(e) => setForm({ ...form, fecha_pago: e.target.value })}
              className={`${inputCls} tabular-nums`}
            />
          </div>
          <div>
            <label className={labelCls}>Comprobante URL</label>
            <input
              type="url"
              value={form.comprobante_url}
              onChange={(e) =>
                setForm({ ...form, comprobante_url: e.target.value })
              }
              placeholder="https://…/comprobante.pdf"
              className={inputCls}
            />
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline hover:bg-ink-100/40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700 disabled:opacity-60"
            >
              {mutation.isPending ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
