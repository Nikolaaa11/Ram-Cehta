"use client";

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
import type {
  RiesgoCreate,
  RiesgoRead,
  Severidad,
  Probabilidad,
} from "@/lib/api/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaCodigo: string;
  onCreated: () => void;
}

const initial = (empresa: string): RiesgoCreate => ({
  empresa_codigo: empresa,
  proyecto_id: null,
  titulo: "",
  descripcion: "",
  severidad: "media",
  probabilidad: "media",
  estado: "abierto",
  owner_email: null,
  mitigacion: "",
});

export function CrearRiesgoDialog({
  open,
  onOpenChange,
  empresaCodigo,
  onCreated,
}: Props) {
  const { session } = useSession();
  const [form, setForm] = useState<RiesgoCreate>(initial(empresaCodigo));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initial(empresaCodigo));
      setError(null);
    }
  }, [open, empresaCodigo]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<RiesgoRead>(
        "/avance/riesgos",
        {
          ...form,
          titulo: form.titulo.trim(),
          descripcion: form.descripcion || null,
          owner_email: form.owner_email || null,
          mitigacion: form.mitigacion || null,
        },
        session,
      ),
    onSuccess: () => {
      toast.success("Riesgo registrado");
      onCreated();
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : "Error al crear riesgo");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Nuevo riesgo</DialogTitle>
        <DialogDescription>
          Registrá un riesgo identificado para {empresaCodigo} con su severidad
          y probabilidad.
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

          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Título <span className="text-negative">*</span>
            </label>
            <input
              type="text"
              required
              value={form.titulo}
              onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              placeholder="Dependencia crítica de un solo proveedor"
              className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Severidad
              </label>
              <select
                value={form.severidad}
                onChange={(e) =>
                  setForm({ ...form, severidad: e.target.value as Severidad })
                }
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              >
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Probabilidad
              </label>
              <select
                value={form.probabilidad}
                onChange={(e) =>
                  setForm({
                    ...form,
                    probabilidad: e.target.value as Probabilidad,
                  })
                }
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              >
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Owner email
            </label>
            <input
              type="email"
              value={form.owner_email ?? ""}
              onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
              placeholder="responsable@empresa.cl"
              className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Descripción
            </label>
            <textarea
              value={form.descripcion ?? ""}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              rows={2}
              className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Mitigación
            </label>
            <textarea
              value={form.mitigacion ?? ""}
              onChange={(e) => setForm({ ...form, mitigacion: e.target.value })}
              rows={2}
              placeholder="Plan de mitigación / contingencia"
              className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline hover:bg-ink-100/40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || !form.titulo.trim()}
              className="rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700 disabled:opacity-60"
            >
              {mutation.isPending ? "Guardando…" : "Crear"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
