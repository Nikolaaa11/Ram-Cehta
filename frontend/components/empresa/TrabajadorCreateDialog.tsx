"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaCodigo: string;
  onCreated: () => void;
}

export function TrabajadorCreateDialog({
  open,
  onOpenChange,
  empresaCodigo,
  onCreated,
}: Props) {
  const { session } = useSession();
  const [form, setForm] = useState({
    nombre_completo: "",
    rut: "",
    cargo: "",
    email: "",
    telefono: "",
    fecha_ingreso: new Date().toISOString().slice(0, 10),
    tipo_contrato: "indefinido" as
      | "indefinido"
      | "plazo_fijo"
      | "honorarios"
      | "part_time",
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post(
        "/trabajadores",
        {
          empresa_codigo: empresaCodigo,
          ...form,
          email: form.email || null,
          telefono: form.telefono || null,
          cargo: form.cargo || null,
        },
        session,
      ),
    onSuccess: () => {
      toast.success("Trabajador creado");
      onCreated();
      onOpenChange(false);
      setForm({
        nombre_completo: "",
        rut: "",
        cargo: "",
        email: "",
        telefono: "",
        fecha_ingreso: new Date().toISOString().slice(0, 10),
        tipo_contrato: "indefinido",
      });
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.detail : "Error al crear trabajador",
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Nuevo trabajador</DialogTitle>
        <DialogDescription>
          Datos básicos del nuevo empleado de {empresaCodigo}.
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
              label="Nombre completo"
              required
              colSpan={2}
              value={form.nombre_completo}
              onChange={(v) => setForm({ ...form, nombre_completo: v })}
              placeholder="Juan Pérez Soto"
            />
            <Field
              label="RUT"
              required
              value={form.rut}
              onChange={(v) => setForm({ ...form, rut: v })}
              placeholder="12345678-9"
            />
            <Field
              label="Cargo"
              value={form.cargo}
              onChange={(v) => setForm({ ...form, cargo: v })}
              placeholder="Senior Engineer"
            />
            <Field
              label="Email"
              type="email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
            />
            <Field
              label="Teléfono"
              value={form.telefono}
              onChange={(v) => setForm({ ...form, telefono: v })}
              placeholder="+56 9 1234 5678"
            />
            <Field
              label="Fecha ingreso"
              type="date"
              required
              value={form.fecha_ingreso}
              onChange={(v) => setForm({ ...form, fecha_ingreso: v })}
            />
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Tipo contrato
              </label>
              <select
                value={form.tipo_contrato}
                onChange={(e) =>
                  setForm({
                    ...form,
                    tipo_contrato: e.target.value as typeof form.tipo_contrato,
                  })
                }
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              >
                <option value="indefinido">Indefinido</option>
                <option value="plazo_fijo">Plazo fijo</option>
                <option value="honorarios">Honorarios</option>
                <option value="part_time">Part time</option>
              </select>
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
              {mutation.isPending ? "Creando..." : "Crear"}
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
