"use client";

/**
 * EmpresaEditDialog — dialog Apple-style para editar datos fiscales/contacto
 * de una empresa. Solo admin (`empresa:update`).
 *
 * El campo `codigo` no es editable — es la PK semántica de toda la app.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

interface EmpresaForm {
  razon_social: string;
  rut: string;
  giro: string;
  direccion: string;
  ciudad: string;
  telefono: string;
  representante_legal: string;
  email_firmante: string;
  oc_prefix: string;
}

interface EmpresaSnapshot {
  codigo: string;
  razon_social: string;
  rut?: string | null;
  giro?: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  telefono?: string | null;
  representante_legal?: string | null;
  email_firmante?: string | null;
  oc_prefix?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresa: EmpresaSnapshot;
  onSaved?: () => void;
}

const inputCls =
  "w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green";
const labelCls = "mb-1 block text-xs font-medium text-ink-700";

function fromSnapshot(e: EmpresaSnapshot): EmpresaForm {
  return {
    razon_social: e.razon_social ?? "",
    rut: e.rut ?? "",
    giro: e.giro ?? "",
    direccion: e.direccion ?? "",
    ciudad: e.ciudad ?? "",
    telefono: e.telefono ?? "",
    representante_legal: e.representante_legal ?? "",
    email_firmante: e.email_firmante ?? "",
    oc_prefix: e.oc_prefix ?? "",
  };
}

export function EmpresaEditDialog({ open, onOpenChange, empresa, onSaved }: Props) {
  const { session } = useSession();
  const [form, setForm] = useState<EmpresaForm>(fromSnapshot(empresa));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(fromSnapshot(empresa));
      setError(null);
    }
  }, [open, empresa]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        razon_social: form.razon_social.trim(),
        rut: form.rut.trim() || null,
        giro: form.giro.trim() || null,
        direccion: form.direccion.trim() || null,
        ciudad: form.ciudad.trim() || null,
        telefono: form.telefono.trim() || null,
        representante_legal: form.representante_legal.trim() || null,
        email_firmante: form.email_firmante.trim() || null,
        oc_prefix: form.oc_prefix.trim() || null,
      };
      return apiClient.patch(
        `/catalogos/empresas/${encodeURIComponent(empresa.codigo)}`,
        payload,
        session,
      );
    },
    onSuccess: () => {
      toast.success(`Empresa ${empresa.codigo} actualizada`);
      onSaved?.();
      onOpenChange(false);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.detail : "Error al actualizar la empresa",
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cehta-green/10 text-cehta-green">
            <Building2 className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <div className="flex-1">
            <DialogTitle>Editar empresa</DialogTitle>
            <DialogDescription>
              {empresa.codigo} · datos fiscales y de contacto
            </DialogDescription>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
          className="mt-5 max-h-[70vh] space-y-3 overflow-y-auto pr-1"
        >
          {error && (
            <div className="rounded-lg border border-negative/20 bg-negative/5 px-3 py-2 text-xs text-negative">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>Razón social *</label>
              <input
                value={form.razon_social}
                onChange={(e) =>
                  setForm({ ...form, razon_social: e.target.value })
                }
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>RUT</label>
              <input
                value={form.rut}
                onChange={(e) => setForm({ ...form, rut: e.target.value })}
                placeholder="76.123.456-7"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>OC prefix</label>
              <input
                value={form.oc_prefix}
                onChange={(e) =>
                  setForm({ ...form, oc_prefix: e.target.value })
                }
                placeholder="OC-EMP"
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Giro</label>
              <input
                value={form.giro}
                onChange={(e) => setForm({ ...form, giro: e.target.value })}
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Dirección</label>
              <input
                value={form.direccion}
                onChange={(e) =>
                  setForm({ ...form, direccion: e.target.value })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Ciudad</label>
              <input
                value={form.ciudad}
                onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Teléfono</label>
              <input
                value={form.telefono}
                onChange={(e) =>
                  setForm({ ...form, telefono: e.target.value })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Representante legal</label>
              <input
                value={form.representante_legal}
                onChange={(e) =>
                  setForm({ ...form, representante_legal: e.target.value })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Email firmante</label>
              <input
                type="email"
                value={form.email_firmante}
                onChange={(e) =>
                  setForm({ ...form, email_firmante: e.target.value })
                }
                className={inputCls}
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline hover:bg-ink-100/40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || !form.razon_social.trim()}
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
