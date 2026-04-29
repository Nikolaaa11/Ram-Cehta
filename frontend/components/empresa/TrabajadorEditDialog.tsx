"use client";

/**
 * TrabajadorEditDialog — edit del trabajador (mismos campos que Create
 * pero pre-rellenado y con PATCH /trabajadores/{id}).
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type TipoContrato = "indefinido" | "plazo_fijo" | "honorarios" | "part_time";
type EstadoTrabajador = "activo" | "inactivo" | "licencia";

export interface TrabajadorEditable {
  trabajador_id: number;
  nombre_completo: string;
  rut: string;
  cargo?: string | null;
  email?: string | null;
  telefono?: string | null;
  fecha_ingreso: string;
  fecha_egreso?: string | null;
  tipo_contrato?: string | null;
  estado: string;
  notas?: string | null;
}

interface Form {
  nombre_completo: string;
  rut: string;
  cargo: string;
  email: string;
  telefono: string;
  fecha_ingreso: string;
  tipo_contrato: TipoContrato;
  estado: EstadoTrabajador;
  notas: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trabajador: TrabajadorEditable;
  onSaved?: () => void;
}

const inputCls =
  "w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green";
const labelCls = "mb-1 block text-xs font-medium text-ink-700";

function fromTrabajador(t: TrabajadorEditable): Form {
  return {
    nombre_completo: t.nombre_completo,
    rut: t.rut,
    cargo: t.cargo ?? "",
    email: t.email ?? "",
    telefono: t.telefono ?? "",
    fecha_ingreso: t.fecha_ingreso,
    tipo_contrato: (t.tipo_contrato as TipoContrato) ?? "indefinido",
    estado: (t.estado as EstadoTrabajador) ?? "activo",
    notas: t.notas ?? "",
  };
}

export function TrabajadorEditDialog({
  open,
  onOpenChange,
  trabajador,
  onSaved,
}: Props) {
  const { session } = useSession();
  const [form, setForm] = useState<Form>(fromTrabajador(trabajador));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(fromTrabajador(trabajador));
      setError(null);
    }
  }, [open, trabajador]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch(
        `/trabajadores/${trabajador.trabajador_id}`,
        {
          nombre_completo: form.nombre_completo.trim() || null,
          rut: form.rut.trim() || null,
          cargo: form.cargo.trim() || null,
          email: form.email.trim() || null,
          telefono: form.telefono.trim() || null,
          fecha_ingreso: form.fecha_ingreso || null,
          tipo_contrato: form.tipo_contrato,
          estado: form.estado,
          notas: form.notas.trim() || null,
        },
        session,
      ),
    onSuccess: () => {
      toast.success(`Trabajador ${form.nombre_completo} actualizado`);
      onSaved?.();
      onOpenChange(false);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.detail : "Error al actualizar trabajador",
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Editar trabajador</DialogTitle>
        <DialogDescription>
          {trabajador.nombre_completo} · {trabajador.rut}
        </DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
          className="mt-4 space-y-3"
        >
          {error && (
            <div className="rounded-lg border border-negative/20 bg-negative/5 px-3 py-2 text-xs text-negative">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>Nombre completo *</label>
              <input
                value={form.nombre_completo}
                onChange={(e) =>
                  setForm({ ...form, nombre_completo: e.target.value })
                }
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>RUT *</label>
              <input
                value={form.rut}
                onChange={(e) => setForm({ ...form, rut: e.target.value })}
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Cargo</label>
              <input
                value={form.cargo}
                onChange={(e) => setForm({ ...form, cargo: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
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
              <label className={labelCls}>Fecha ingreso *</label>
              <input
                type="date"
                value={form.fecha_ingreso}
                onChange={(e) =>
                  setForm({ ...form, fecha_ingreso: e.target.value })
                }
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Tipo contrato</label>
              <select
                value={form.tipo_contrato}
                onChange={(e) =>
                  setForm({
                    ...form,
                    tipo_contrato: e.target.value as TipoContrato,
                  })
                }
                className={inputCls}
              >
                <option value="indefinido">Indefinido</option>
                <option value="plazo_fijo">Plazo fijo</option>
                <option value="honorarios">Honorarios</option>
                <option value="part_time">Part time</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Estado</label>
              <select
                value={form.estado}
                onChange={(e) =>
                  setForm({
                    ...form,
                    estado: e.target.value as EstadoTrabajador,
                  })
                }
                className={inputCls}
              >
                <option value="activo">Activo</option>
                <option value="licencia">Licencia</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Notas</label>
              <textarea
                value={form.notas}
                onChange={(e) => setForm({ ...form, notas: e.target.value })}
                rows={2}
                className={inputCls}
              />
            </div>
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
