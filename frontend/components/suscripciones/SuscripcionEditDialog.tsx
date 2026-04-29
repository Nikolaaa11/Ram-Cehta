"use client";

/**
 * SuscripcionEditDialog — edita una suscripción de acciones FIP CEHTA ESG.
 * PATCH /suscripciones-acciones/{id} — admin/finance.
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

export interface SuscripcionEditable {
  suscripcion_id: number;
  empresa_codigo: string;
  fecha_recibo: string;
  acciones_pagadas: string | number;
  monto_uf?: string | number | null;
  monto_clp: string | number;
  contrato_ref?: string | null;
  recibo_url?: string | null;
  firmado: boolean;
  fecha_firma?: string | null;
}

interface Form {
  fecha_recibo: string;
  acciones_pagadas: string;
  monto_uf: string;
  monto_clp: string;
  contrato_ref: string;
  recibo_url: string;
  firmado: boolean;
  fecha_firma: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suscripcion: SuscripcionEditable;
  onSaved?: () => void;
}

const inputCls =
  "w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green";
const labelCls = "mb-1 block text-xs font-medium text-ink-700";

function fromSuscripcion(s: SuscripcionEditable): Form {
  return {
    fecha_recibo: s.fecha_recibo,
    acciones_pagadas: s.acciones_pagadas != null ? String(s.acciones_pagadas) : "",
    monto_uf: s.monto_uf != null ? String(s.monto_uf) : "",
    monto_clp: s.monto_clp != null ? String(s.monto_clp) : "",
    contrato_ref: s.contrato_ref ?? "",
    recibo_url: s.recibo_url ?? "",
    firmado: !!s.firmado,
    fecha_firma: s.fecha_firma ? s.fecha_firma.slice(0, 16) : "",
  };
}

export function SuscripcionEditDialog({
  open,
  onOpenChange,
  suscripcion,
  onSaved,
}: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(fromSuscripcion(suscripcion));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(fromSuscripcion(suscripcion));
      setError(null);
    }
  }, [open, suscripcion]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        fecha_recibo: form.fecha_recibo || null,
        acciones_pagadas: form.acciones_pagadas
          ? Number(form.acciones_pagadas)
          : null,
        monto_uf: form.monto_uf ? Number(form.monto_uf) : null,
        monto_clp: form.monto_clp ? Number(form.monto_clp) : null,
        contrato_ref: form.contrato_ref.trim() || null,
        recibo_url: form.recibo_url.trim() || null,
        firmado: form.firmado,
        fecha_firma: form.fecha_firma
          ? new Date(form.fecha_firma).toISOString()
          : null,
      };
      return apiClient.patch(
        `/suscripciones/${suscripcion.suscripcion_id}`,
        payload,
        session,
      );
    },
    onSuccess: async () => {
      toast.success("Suscripción actualizada");
      await qc.invalidateQueries({ queryKey: ["suscripciones"] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.detail
          : "Error al actualizar suscripción",
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cehta-green/10 text-cehta-green">
            <Pencil className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <div className="flex-1">
            <DialogTitle>Editar suscripción</DialogTitle>
            <DialogDescription>
              {suscripcion.empresa_codigo} · recibo{" "}
              {suscripcion.fecha_recibo}
            </DialogDescription>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
          className="mt-5 space-y-3"
        >
          {error && (
            <div className="rounded-lg border border-negative/20 bg-negative/5 px-3 py-2 text-xs text-negative">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Fecha recibo *</label>
              <input
                type="date"
                value={form.fecha_recibo}
                onChange={(e) =>
                  setForm({ ...form, fecha_recibo: e.target.value })
                }
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Acciones pagadas *</label>
              <input
                type="number"
                step="0.0001"
                value={form.acciones_pagadas}
                onChange={(e) =>
                  setForm({ ...form, acciones_pagadas: e.target.value })
                }
                required
                className={`${inputCls} tabular-nums`}
              />
            </div>
            <div>
              <label className={labelCls}>Monto CLP *</label>
              <input
                type="number"
                step="1"
                value={form.monto_clp}
                onChange={(e) =>
                  setForm({ ...form, monto_clp: e.target.value })
                }
                required
                className={`${inputCls} tabular-nums`}
              />
            </div>
            <div>
              <label className={labelCls}>Monto UF</label>
              <input
                type="number"
                step="0.01"
                value={form.monto_uf}
                onChange={(e) =>
                  setForm({ ...form, monto_uf: e.target.value })
                }
                className={`${inputCls} tabular-nums`}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Contrato ref</label>
              <input
                value={form.contrato_ref}
                onChange={(e) =>
                  setForm({ ...form, contrato_ref: e.target.value })
                }
                placeholder="N° contrato / referencia interna"
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>URL recibo</label>
              <input
                type="url"
                value={form.recibo_url}
                onChange={(e) =>
                  setForm({ ...form, recibo_url: e.target.value })
                }
                placeholder="https://…"
                className={inputCls}
              />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input
                id="firmado"
                type="checkbox"
                checked={form.firmado}
                onChange={(e) =>
                  setForm({ ...form, firmado: e.target.checked })
                }
                className="h-4 w-4 rounded border-hairline accent-cehta-green"
              />
              <label htmlFor="firmado" className="text-sm text-ink-700">
                Firmado por el inversionista
              </label>
            </div>
            {form.firmado && (
              <div className="col-span-2">
                <label className={labelCls}>Fecha firma</label>
                <input
                  type="datetime-local"
                  value={form.fecha_firma}
                  onChange={(e) =>
                    setForm({ ...form, fecha_firma: e.target.value })
                  }
                  className={inputCls}
                />
              </div>
            )}
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
