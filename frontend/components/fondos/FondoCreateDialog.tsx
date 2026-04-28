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
  EstadoOutreach,
  FondoCreate,
  FondoRead,
  TipoFondo,
} from "@/lib/api/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

const initial = (): FondoCreate => ({
  nombre: "",
  tipo: "lp",
  estado_outreach: "no_contactado",
  pais: "",
  thesis: "",
  contacto_nombre: "",
  contacto_email: "",
  website: "",
  sectores: [],
});

export function FondoCreateDialog({ open, onOpenChange, onCreated }: Props) {
  const { session } = useSession();
  const [form, setForm] = useState<FondoCreate>(initial());
  const [sectoresStr, setSectoresStr] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initial());
      setSectoresStr("");
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      const sectores = sectoresStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const payload: FondoCreate = {
        ...form,
        nombre: form.nombre.trim(),
        pais: form.pais || null,
        thesis: form.thesis || null,
        contacto_nombre: form.contacto_nombre || null,
        contacto_email: form.contacto_email || null,
        website: form.website || null,
        sectores: sectores.length ? sectores : null,
      };
      return apiClient.post<FondoRead>("/fondos", payload, session);
    },
    onSuccess: () => {
      toast.success("Fondo creado");
      onCreated();
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : "Error al crear fondo");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Nuevo fondo</DialogTitle>
        <DialogDescription>
          LP, banco, programa estatal, family office o angel/VC.
        </DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
          className="mt-4 max-h-[70vh] space-y-3 overflow-y-auto pr-2"
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
              placeholder="Acme Capital Partners"
            />

            <div>
              <Label>Tipo</Label>
              <select
                value={form.tipo}
                onChange={(e) =>
                  setForm({ ...form, tipo: e.target.value as TipoFondo })
                }
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              >
                <option value="lp">LP</option>
                <option value="banco">Banco</option>
                <option value="programa_estado">Programa Estado</option>
                <option value="family_office">Family Office</option>
                <option value="vc">VC</option>
                <option value="angel">Angel</option>
                <option value="otro">Otro</option>
              </select>
            </div>

            <div>
              <Label>Estado outreach</Label>
              <select
                value={form.estado_outreach}
                onChange={(e) =>
                  setForm({
                    ...form,
                    estado_outreach: e.target.value as EstadoOutreach,
                  })
                }
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              >
                <option value="no_contactado">No contactado</option>
                <option value="contactado">Contactado</option>
                <option value="en_negociacion">En negociación</option>
                <option value="cerrado">Cerrado</option>
                <option value="descartado">Descartado</option>
              </select>
            </div>

            <Field
              label="País"
              value={form.pais ?? ""}
              onChange={(v) => setForm({ ...form, pais: v })}
              placeholder="Chile · USA · UK"
            />
            <Field
              label="Región"
              value={form.region ?? ""}
              onChange={(v) => setForm({ ...form, region: v })}
              placeholder="LATAM · EMEA"
            />

            <Field
              label="Ticket min (USD)"
              type="number"
              value={form.ticket_min_usd != null ? String(form.ticket_min_usd) : ""}
              onChange={(v) =>
                setForm({
                  ...form,
                  ticket_min_usd: v ? (Number(v) as never) : null,
                })
              }
            />
            <Field
              label="Ticket max (USD)"
              type="number"
              value={form.ticket_max_usd != null ? String(form.ticket_max_usd) : ""}
              onChange={(v) =>
                setForm({
                  ...form,
                  ticket_max_usd: v ? (Number(v) as never) : null,
                })
              }
            />

            <Field
              colSpan={2}
              label="Sectores (separados por coma)"
              value={sectoresStr}
              onChange={setSectoresStr}
              placeholder="energía, fintech, agro"
            />

            <div className="col-span-2">
              <Label>Thesis</Label>
              <textarea
                value={form.thesis ?? ""}
                onChange={(e) => setForm({ ...form, thesis: e.target.value })}
                rows={2}
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>

            <Field
              label="Contacto nombre"
              value={form.contacto_nombre ?? ""}
              onChange={(v) => setForm({ ...form, contacto_nombre: v })}
            />
            <Field
              label="Contacto email"
              type="email"
              value={form.contacto_email ?? ""}
              onChange={(v) => setForm({ ...form, contacto_email: v })}
            />

            <Field
              colSpan={2}
              label="Website"
              value={form.website ?? ""}
              onChange={(v) => setForm({ ...form, website: v })}
              placeholder="https://acmecapital.com"
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

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium text-ink-700">
      {children}
    </label>
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
      <Label>
        {label}
        {required && <span className="ml-0.5 text-negative">*</span>}
      </Label>
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
