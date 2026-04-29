"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import {
  useDocumentAnalysis,
  type AnalysisResult,
} from "@/hooks/use-document-analysis";
import { apiClient, ApiError } from "@/lib/api/client";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AiAnalysisPreview } from "@/components/shared/AiAnalysisPreview";
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

/** Mapea el tipo detectado por el AI a una `LegalCategoria` válida. */
function mapDetectedToCategoria(detected: string): LegalCategoria | null {
  const m: Record<string, LegalCategoria> = {
    contrato: "contrato",
    factura: "otro",
    f29: "declaracion_sii",
    liquidacion: "otro",
    trabajador_contrato: "contrato",
  };
  return m[detected] ?? null;
}

/** Aplica los campos extraídos al form, sin pisar lo que el usuario haya tocado. */
function applyAnalysisToForm(
  prev: LegalDocumentCreate,
  result: AnalysisResult,
): LegalDocumentCreate {
  const f = result.fields as Record<string, unknown>;
  const next: LegalDocumentCreate = { ...prev };

  const cat = mapDetectedToCategoria(result.tipo_detectado);
  if (cat && !prev.nombre) next.categoria = cat;

  // Subcategoría inferida desde el tipo del LLM.
  if (!prev.subcategoria) {
    if (result.tipo_detectado === "trabajador_contrato")
      next.subcategoria = "laboral";
    else if (result.tipo_detectado === "factura")
      next.subcategoria = "factura";
    else if (result.tipo_detectado === "f29") next.subcategoria = "f29";
  }

  if (typeof f.contraparte === "string" && !prev.contraparte)
    next.contraparte = f.contraparte;
  if (typeof f.descripcion === "string" && !prev.descripcion)
    next.descripcion = f.descripcion;
  if (typeof f.fecha_inicio === "string" && !prev.fecha_vigencia_desde)
    next.fecha_vigencia_desde = f.fecha_inicio;
  if (typeof f.fecha_fin === "string" && !prev.fecha_vigencia_hasta)
    next.fecha_vigencia_hasta = f.fecha_fin;
  if (typeof f.fecha === "string" && !prev.fecha_emision)
    next.fecha_emision = f.fecha;
  if (typeof f.monto === "number" && prev.monto == null)
    next.monto = f.monto;
  if (typeof f.total === "number" && prev.monto == null) next.monto = f.total;
  if (typeof f.moneda === "string" && (!prev.moneda || prev.moneda === "CLP"))
    next.moneda = f.moneda;

  // Auto-derivar `nombre` si está vacío y tenemos contraparte.
  if (!prev.nombre && typeof f.contraparte === "string") {
    next.nombre = `Contrato ${f.contraparte}`.slice(0, 200);
  }

  return next;
}

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
  const {
    analyze,
    analyzing,
    result,
    error: aiError,
    reset: resetAi,
  } = useDocumentAnalysis();

  // Auto-trigger analysis cuando se selecciona archivo, con debounce 500ms.
  useEffect(() => {
    if (!file) {
      resetAi();
      return;
    }
    const handle = setTimeout(() => {
      void analyze(file, "auto");
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Auto-aplicar si confidence ≥ 0.8 (Apple polish: el usuario igual puede editar).
  useEffect(() => {
    if (result && result.confidence >= 0.8) {
      setForm((prev) => applyAnalysisToForm(prev, result));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.tipo_detectado, result?.confidence]);

  const closeDialog = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setForm(initialForm(empresaCodigo));
      setFile(null);
      setError(null);
      resetAi();
    }
  };

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
      closeDialog(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : "Error al crear documento");
    },
  });

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
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

          {(analyzing || result || aiError) && (
            <AiAnalysisPreview
              analyzing={analyzing}
              error={aiError}
              result={result}
              onApply={
                result && result.confidence < 0.8
                  ? () => setForm((prev) => applyAnalysisToForm(prev, result))
                  : undefined
              }
            />
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
              <Label>
                Archivo (opcional, máx 25 MB)
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-cehta-green">
                  <Sparkles className="h-3 w-3" strokeWidth={2} /> auto-fill IA
                </span>
              </Label>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.txt"
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
              onClick={() => closeDialog(false)}
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
