"use client";

import { useState } from "react";
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
import type { ProyectoCreate, ProyectoRead } from "@/lib/api/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaCodigo: string;
  onCreated: () => void;
}

export function CrearProyectoDialog({
  open,
  onOpenChange,
  empresaCodigo,
  onCreated,
}: Props) {
  const { session } = useSession();
  const [form, setForm] = useState<ProyectoCreate>({
    empresa_codigo: empresaCodigo,
    nombre: "",
    descripcion: "",
    fecha_inicio: null,
    fecha_fin_estimada: null,
    estado: "en_progreso",
    progreso_pct: 0,
    owner_email: null,
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<ProyectoRead>(
        "/avance/proyectos",
        {
          ...form,
          nombre: form.nombre.trim(),
          descripcion: form.descripcion || null,
          fecha_inicio: form.fecha_inicio || null,
          fecha_fin_estimada: form.fecha_fin_estimada || null,
          owner_email: form.owner_email || null,
        },
        session,
      ),
    onSuccess: () => {
      toast.success("Proyecto creado");
      onCreated();
      onOpenChange(false);
      setForm({
        empresa_codigo: empresaCodigo,
        nombre: "",
        descripcion: "",
        fecha_inicio: null,
        fecha_fin_estimada: null,
        estado: "en_progreso",
        progreso_pct: 0,
        owner_email: null,
      });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : "Error al crear proyecto");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Nuevo proyecto</DialogTitle>
        <DialogDescription>
          Roadmap de {empresaCodigo}. Definí inicio y fin estimado para
          renderizar el Gantt.
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
            <Field
              colSpan={2}
              label="Nombre"
              required
              value={form.nombre}
              onChange={(v) => setForm({ ...form, nombre: v })}
              placeholder="Roadmap H1 2026"
            />
            <div className="col-span-2">
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
            <Field
              label="Fecha inicio"
              type="date"
              value={form.fecha_inicio ?? ""}
              onChange={(v) => setForm({ ...form, fecha_inicio: v })}
            />
            <Field
              label="Fecha fin estimada"
              type="date"
              value={form.fecha_fin_estimada ?? ""}
              onChange={(v) => setForm({ ...form, fecha_fin_estimada: v })}
            />
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">Estado</label>
              <select
                value={form.estado}
                onChange={(e) =>
                  setForm({ ...form, estado: e.target.value as ProyectoCreate["estado"] })
                }
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              >
                <option value="planificado">Planificado</option>
                <option value="en_progreso">En progreso</option>
                <option value="pausado">Pausado</option>
                <option value="completado">Completado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
            <Field
              label="Progreso %"
              type="number"
              value={String(form.progreso_pct ?? 0)}
              onChange={(v) =>
                setForm({ ...form, progreso_pct: Math.max(0, Math.min(100, Number(v) || 0)) })
              }
            />
            <Field
              colSpan={2}
              label="Owner email"
              value={form.owner_email ?? ""}
              onChange={(v) => setForm({ ...form, owner_email: v })}
              placeholder="responsable@empresa.cl"
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

function Field({
  label,
  type = "text",
  required = false,
  colSpan,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  type?: string;
  required?: boolean;
  colSpan?: number;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className={colSpan === 2 ? "col-span-2" : ""}>
      <label className="mb-1 block text-xs font-medium text-ink-700">
        {label}
        {required && <span className="ml-0.5 text-negative">*</span>}
      </label>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green"
      />
    </div>
  );
}
