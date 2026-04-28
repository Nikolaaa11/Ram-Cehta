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
import type {
  LegalCategoria,
  LegalDocumentCreate,
  LegalDocumentRead,
} from "@/lib/api/schema";

const CATEGORIAS: { value: LegalCategoria; label: string }[] = [
  { value: "contrato", label: "Contrato" },
  { value: "acta", label: "Acta" },
  { value: "declaracion_sii", label: "Declaración SII" },
  { value: "permiso", label: "Permiso" },
  { value: "poliza", label: "Póliza" },
  { value: "estatuto", label: "Estatuto" },
  { value: "otro", label: "Otro" },
];

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaCodigo: string;
  onCreated: () => void;
}

const initialForm = (empresaCodigo: string): LegalDocumentCreate => ({
  empresa_codigo: empresaCodigo,
  categoria: "contrato",
  nombre: "",
  descripcion: "",
  contraparte: "",
  subcategoria: "",
  fecha_emision: null,
  fecha_vigencia_desde: null,
  fecha_vigencia_hasta: null,
  monto: null,
  moneda: "CLP",
  estado: "vigente",
});

export function LegalDocumentCreateDialog({
  open,
  onOpenChange,
  empresaCodigo,
  onCreated,
}: Props) {
  const { session } = useSession();
  const [form, setForm] = useState<LegalDocumentCreate>(initialForm(empresaCodigo));
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: LegalDocumentCreate = {
        ...form,
        nombre: form.nombre.trim(),
        contraparte: form.contraparte || null,
        descripcion: form.descripcion || null,
        subcategoria: form.subcategoria || null,
        fecha_emision: form.fecha_emision || null,
        fecha_vigencia_desde: form.fecha_vigencia_desde || null,
        fecha_vigencia_hasta: form.fecha_vigencia_hasta || null,
        monto: form.monto != null && form.monto !== ("" as never) ? Number(form.monto) : null,
      };
      const created = await apiClient.post<LegalDocumentRead>(
        "/legal",
        payload,
        session,
      );
      // Si hay file → upload separado
      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(
          `${API_BASE}/legal/${created.documento_id}/upload`,
          {
            method: "POST",
            headers: session?.access_token
              ? { Authorization: `Bearer ${session.access_token}` }
              : {},
            body: formData,
          },
        );
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            detail = body?.detail ?? detail;
          } catch {
            // non-JSON
          }
          throw new ApiError(res.status, detail);
        }
      }
      return created;
    },
    onSuccess: () => {
      toast.success("Documento creado");
      onCreated();
      onOpenChange(false);
      setForm(initialForm(empresaCodigo));
      setFile(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : "Error al crear documento");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Nuevo documento legal</DialogTitle>
        <DialogDescription>
          Bóveda legal de {empresaCodigo}. Subí archivo a Dropbox y deja sus
          metadatos para alertas automáticas.
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
            <div>
              <Label>Categoría *</Label>
              <select
                value={form.categoria}
                onChange={(e) =>
                  setForm({ ...form, categoria: e.target.value as LegalCategoria })
                }
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              >
                {CATEGORIAS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <Field
              label="Subcategoría"
              value={form.subcategoria ?? ""}
              onChange={(v) => setForm({ ...form, subcategoria: v })}
              placeholder="cliente, proveedor, bancario…"
            />

            <Field
              label="Nombre"
              colSpan={2}
              required
              value={form.nombre}
              onChange={(v) => setForm({ ...form, nombre: v })}
              placeholder="Contrato Servicio Cloud 2026"
            />

            <Field
              label="Contraparte"
              colSpan={2}
              value={form.contraparte ?? ""}
              onChange={(v) => setForm({ ...form, contraparte: v })}
              placeholder="Banco Santander · Acme SpA · etc."
            />

            <Field
              label="Fecha emisión"
              type="date"
              value={form.fecha_emision ?? ""}
              onChange={(v) => setForm({ ...form, fecha_emision: v })}
            />
            <Field
              label="Vigencia desde"
              type="date"
              value={form.fecha_vigencia_desde ?? ""}
              onChange={(v) => setForm({ ...form, fecha_vigencia_desde: v })}
            />

            <Field
              label="Vigencia hasta"
              type="date"
              value={form.fecha_vigencia_hasta ?? ""}
              onChange={(v) => setForm({ ...form, fecha_vigencia_hasta: v })}
            />

            <div>
              <Label>Estado</Label>
              <select
                value={form.estado}
                onChange={(e) =>
                  setForm({ ...form, estado: e.target.value as LegalDocumentCreate["estado"] })
                }
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              >
                <option value="vigente">Vigente</option>
                <option value="borrador">Borrador</option>
                <option value="renovado">Renovado</option>
                <option value="vencido">Vencido</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>

            <Field
              label="Monto"
              type="number"
              value={form.monto != null ? String(form.monto) : ""}
              onChange={(v) =>
                setForm({ ...form, monto: v ? (Number(v) as never) : null })
              }
            />
            <Field
              label="Moneda"
              value={form.moneda ?? ""}
              onChange={(v) => setForm({ ...form, moneda: v })}
              placeholder="CLP"
            />

            <div className="col-span-2">
              <Label>Descripción</Label>
              <textarea
                value={form.descripcion ?? ""}
                onChange={(e) =>
                  setForm({ ...form, descripcion: e.target.value })
                }
                rows={2}
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>

            <div className="col-span-2">
              <Label>Archivo (opcional, máx 25 MB)</Label>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-100/60 file:px-3 file:py-2 file:text-sm file:text-ink-900 hover:file:bg-ink-100"
              />
              {file && (
                <p className="mt-1 text-xs text-ink-500">
                  {file.name} · {(file.size / 1024).toFixed(1)} KB
                </p>
              )}
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
