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
import type {
  CalendarEventCreate,
  CalendarEventRead,
  TipoEvento,
} from "@/lib/api/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate?: Date | null;
  onCreated: () => void;
}

const TIPOS: { value: TipoEvento; label: string }[] = [
  { value: "f29", label: "F29" },
  { value: "reporte_lp", label: "Reporte LP" },
  { value: "comite", label: "Comité" },
  { value: "reporte_trimestral", label: "Reporte trimestral" },
  { value: "vencimiento", label: "Vencimiento" },
  { value: "otro", label: "Otro" },
];

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function EventCreateDialog({
  open,
  onOpenChange,
  defaultDate,
  onCreated,
}: Props) {
  const { session } = useSession();
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<TipoEvento>("otro");
  const [fecha, setFecha] = useState<string>(
    defaultDate ? toDateInput(defaultDate) : toDateInput(new Date()),
  );
  const [empresa, setEmpresa] = useState<string>("");
  const [descripcion, setDescripcion] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitulo("");
      setTipo("otro");
      setFecha(defaultDate ? toDateInput(defaultDate) : toDateInput(new Date()));
      setEmpresa("");
      setDescripcion("");
      setError(null);
    }
  }, [open, defaultDate]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: CalendarEventCreate = {
        titulo: titulo.trim(),
        tipo,
        empresa_codigo: empresa.trim() || null,
        descripcion: descripcion.trim() || null,
        fecha_inicio: new Date(`${fecha}T09:00:00Z`).toISOString(),
        todo_el_dia: true,
        notificar_dias_antes: 3,
      };
      return apiClient.post<CalendarEventRead>(
        "/calendar/events",
        payload,
        session,
      );
    },
    onSuccess: () => {
      toast.success("Evento creado");
      onCreated();
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : "Error al crear evento");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Nuevo evento</DialogTitle>
        <DialogDescription>
          Eventos del reglamento (F29, reporte LP, comités) o ad-hoc.
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
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Comité mensual"
              className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Tipo
              </label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoEvento)}
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              >
                {TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Fecha
              </label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Empresa (opcional)
            </label>
            <input
              type="text"
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              placeholder="TRONGKAI · vacío para evento global"
              className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Descripción
            </label>
            <textarea
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
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
              disabled={mutation.isPending || !titulo.trim()}
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
