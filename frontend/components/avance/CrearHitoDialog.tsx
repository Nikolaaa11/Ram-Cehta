"use client";

import { useState, useEffect } from "react";
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
import type { HitoCreate, HitoRead } from "@/lib/api/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proyectoId: number | null;
  onCreated: () => void;
}

const initialForm = (): HitoCreate => ({
  nombre: "",
  descripcion: "",
  fecha_planificada: null,
  estado: "pendiente",
  orden: 0,
  progreso_pct: 0,
});

export function CrearHitoDialog({
  open,
  onOpenChange,
  proyectoId,
  onCreated,
}: Props) {
  const { session } = useSession();
  const [form, setForm] = useState<HitoCreate>(initialForm());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initialForm());
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (proyectoId === null) throw new Error("Sin proyecto destino");
      return apiClient.post<HitoRead>(
        `/avance/proyectos/${proyectoId}/hitos`,
        {
          ...form,
          nombre: form.nombre.trim(),
          descripcion: form.descripcion || null,
          fecha_planificada: form.fecha_planificada || null,
        },
        session,
      );
    },
    onSuccess: () => {
      toast.success("Hito creado");
      onCreated();
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : "Error al crear hito");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Nuevo hito</DialogTitle>
        <DialogDescription>
          Hito del proyecto. Aparecerá como dot en el Gantt.
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
              Nombre <span className="text-negative">*</span>
            </label>
            <input
              type="text"
              required
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              placeholder="Lanzamiento beta"
              className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Fecha planificada
            </label>
            <input
              type="date"
              value={form.fecha_planificada ?? ""}
              onChange={(e) =>
                setForm({ ...form, fecha_planificada: e.target.value })
              }
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
              disabled={mutation.isPending || !form.nombre.trim()}
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
