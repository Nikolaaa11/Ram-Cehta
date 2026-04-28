"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, FileText } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { ApiError } from "@/lib/api/client";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trabajadorId: number;
  trabajadorNombre: string;
  onSuccess: () => void;
}

const TIPOS = [
  { value: "contrato", label: "Contrato" },
  { value: "anexo", label: "Anexo" },
  { value: "dni", label: "DNI / Cédula" },
  { value: "cv", label: "CV" },
  { value: "liquidacion", label: "Liquidación" },
  { value: "finiquito", label: "Finiquito" },
  { value: "cert_afp", label: "Certificado AFP" },
  { value: "cert_fonasa", label: "Certificado FONASA" },
  { value: "otro", label: "Otro" },
] as const;

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export function UploadDocumentoDialog({
  open,
  onOpenChange,
  trabajadorId,
  trabajadorNombre,
  onSuccess,
}: Props) {
  const { session } = useSession();
  const [tipo, setTipo] = useState<string>("contrato");
  const [file, setFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Seleccioná un archivo");
      const formData = new FormData();
      formData.append("tipo", tipo);
      formData.append("file", file);

      const response = await fetch(
        `${API_BASE}/trabajadores/${trabajadorId}/documentos`,
        {
          method: "POST",
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
          body: formData,
        },
      );
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const body = await response.json();
          detail = body?.detail ?? detail;
        } catch {
          // non-JSON
        }
        throw new ApiError(response.status, detail);
      }
      return response.json();
    },
    onSuccess: () => {
      toast.success("Documento subido");
      onSuccess();
      onOpenChange(false);
      setFile(null);
      setTipo("contrato");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Error al subir");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Subir documento</DialogTitle>
        <DialogDescription>
          Subí archivo a la carpeta Dropbox de {trabajadorNombre}.
        </DialogDescription>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="mt-4 space-y-3"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Tipo de documento
            </label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
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
              Archivo (máx 25 MB)
            </label>
            <label
              htmlFor="file-input"
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-8 transition-colors duration-150 ease-apple ${
                file
                  ? "border-cehta-green bg-cehta-green/5"
                  : "border-hairline hover:border-cehta-green/50 hover:bg-ink-100/30"
              }`}
            >
              {file ? (
                <>
                  <FileText
                    className="h-8 w-8 text-cehta-green"
                    strokeWidth={1.5}
                  />
                  <p className="mt-2 text-sm font-medium text-ink-900">
                    {file.name}
                  </p>
                  <p className="text-xs text-ink-500">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                </>
              ) : (
                <>
                  <Upload className="h-8 w-8 text-ink-300" strokeWidth={1.5} />
                  <p className="mt-2 text-sm font-medium text-ink-700">
                    Click o arrastrá un archivo
                  </p>
                  <p className="text-xs text-ink-500">PDF, DOCX, JPG, PNG</p>
                </>
              )}
              <input
                id="file-input"
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>
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
              disabled={mutation.isPending || !file}
              className="rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700 disabled:opacity-60"
            >
              {mutation.isPending ? "Subiendo..." : "Subir"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
