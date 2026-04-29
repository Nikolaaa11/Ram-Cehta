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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaCodigo: string;
  onCreated: () => void;
}

type TipoContrato = "indefinido" | "plazo_fijo" | "honorarios" | "part_time";

type FormState = {
  nombre_completo: string;
  rut: string;
  cargo: string;
  email: string;
  telefono: string;
  fecha_ingreso: string;
  tipo_contrato: TipoContrato;
};

const initialForm = (): FormState => ({
  nombre_completo: "",
  rut: "",
  cargo: "",
  email: "",
  telefono: "",
  fecha_ingreso: new Date().toISOString().slice(0, 10),
  tipo_contrato: "indefinido",
});

const VALID_TIPOS: readonly TipoContrato[] = [
  "indefinido",
  "plazo_fijo",
  "honorarios",
  "part_time",
] as const;

function applyAnalysisToForm(prev: FormState, result: AnalysisResult): FormState {
  const f = result.fields as Record<string, unknown>;
  const next = { ...prev };
  if (typeof f.nombre_completo === "string" && !prev.nombre_completo)
    next.nombre_completo = f.nombre_completo;
  if (typeof f.rut === "string" && !prev.rut) next.rut = f.rut;
  if (typeof f.cargo === "string" && !prev.cargo) next.cargo = f.cargo;
  if (typeof f.email === "string" && !prev.email) next.email = f.email;
  if (typeof f.telefono === "string" && !prev.telefono)
    next.telefono = f.telefono;
  if (typeof f.fecha_ingreso === "string" && f.fecha_ingreso)
    next.fecha_ingreso = f.fecha_ingreso;
  if (
    typeof f.tipo_contrato === "string" &&
    VALID_TIPOS.includes(f.tipo_contrato as TipoContrato)
  ) {
    next.tipo_contrato = f.tipo_contrato as TipoContrato;
  }
  return next;
}

export function TrabajadorCreateDialog({
  open,
  onOpenChange,
  empresaCodigo,
  onCreated,
}: Props) {
  const { session } = useSession();
  const [form, setForm] = useState<FormState>(initialForm());
  const [error, setError] = useState<string | null>(null);
  const [aiFile, setAiFile] = useState<File | null>(null);
  const {
    analyze,
    analyzing,
    result: aiResult,
    error: aiError,
    reset: resetAi,
  } = useDocumentAnalysis();

  // Auto-trigger con debounce 500ms.
  useEffect(() => {
    if (!aiFile) {
      resetAi();
      return;
    }
    const handle = setTimeout(() => {
      void analyze(aiFile, "trabajador_contrato");
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiFile]);

  // Auto-aplicar si confidence ≥ 0.8.
  useEffect(() => {
    if (aiResult && aiResult.confidence >= 0.8) {
      setForm((prev) => applyAnalysisToForm(prev, aiResult));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiResult?.tipo_detectado, aiResult?.confidence]);

  const closeDialog = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setForm(initialForm());
      setAiFile(null);
      setError(null);
      resetAi();
    }
  };

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
      closeDialog(false);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.detail : "Error al crear trabajador",
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
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

          {/* AI Document Analyzer — V3 fase 7 */}
          <div className="rounded-xl border border-hairline bg-ink-100/30 p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-cehta-green" strokeWidth={2} />
              <span className="text-xs font-medium text-ink-700">
                Auto-fill desde contrato laboral
              </span>
            </div>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              onChange={(e) => setAiFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-ink-700 file:mr-2 file:rounded-md file:border-0 file:bg-cehta-green/10 file:px-2 file:py-1 file:text-xs file:font-medium file:text-cehta-green hover:file:bg-cehta-green/15"
            />
            {(analyzing || aiResult || aiError) && (
              <div className="mt-2">
                <AiAnalysisPreview
                  analyzing={analyzing}
                  error={aiError}
                  result={aiResult}
                  onApply={
                    aiResult && aiResult.confidence < 0.8
                      ? () =>
                          setForm((prev) => applyAnalysisToForm(prev, aiResult))
                      : undefined
                  }
                />
              </div>
            )}
          </div>

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
                    tipo_contrato: e.target.value as TipoContrato,
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
              onClick={() => closeDialog(false)}
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
