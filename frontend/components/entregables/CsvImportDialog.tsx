"use client";

/**
 * CsvImportDialog — V4 fase 7.7.
 *
 * Modal para importar entregables masivos desde CSV. Workflow:
 *   1. Mostrar formato esperado + botón descarga template
 *   2. Drag&drop o selector de archivo
 *   3. POST multipart al backend
 *   4. Mostrar resumen (importados / saltados / fallidos) + errores por fila
 *
 * Idempotente: filas duplicadas (mismo id_template+periodo) se cuentan
 * como saltadas, no fallan.
 */
import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, FileUp, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSession } from "@/hooks/use-session";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface CsvImportError {
  row: number;
  error: string;
  raw: Record<string, string>;
}

interface CsvImportResponse {
  rows_received: number;
  rows_imported: number;
  rows_skipped: number;
  rows_failed: number;
  errors: CsvImportError[];
  sample_imported_ids: number[];
}

const TEMPLATE_HEADERS = [
  "id_template",
  "nombre",
  "categoria",
  "fecha_limite",
  "frecuencia",
  "prioridad",
  "responsable",
  "periodo",
  "descripcion",
  "subcategoria",
  "referencia_normativa",
  "estado",
  "notas",
  "adjunto_url",
  "alerta_15",
  "alerta_10",
  "alerta_5",
  "empresa_codigo",
];

const TEMPLATE_SAMPLE_ROW = [
  "ejemplo_template_id",
  "Ejemplo de entregable",
  "INTERNO",
  "2026-12-31",
  "anual",
  "media",
  "Equipo Ops",
  "2026",
  "Descripción opcional",
  "Subcategoria opcional",
  "Art. 99 del Reglamento",
  "pendiente",
  "Notas adicionales",
  "https://www.dropbox.com/...",
  "true",
  "true",
  "true",
  "CSL",
];

function downloadTemplate() {
  const csv = [
    TEMPLATE_HEADERS.join(","),
    TEMPLATE_SAMPLE_ROW.map((v) =>
      v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v,
    ).join(","),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "entregables_template.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CsvImportDialog({ open, onOpenChange }: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<CsvImportResponse | null>(null);

  const handleFile = (f: File | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast.error("Solo archivos .csv");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast.error("Archivo muy grande (máx 5 MB)");
      return;
    }
    setFile(f);
    setResult(null);
  };

  const handleUpload = async () => {
    if (!file || !session) return;
    setUploading(true);
    try {
      const apiBase =
        process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
      const formData = new FormData();
      formData.append("file", file);
      const resp = await fetch(`${apiBase}/entregables/import-csv`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new ApiError(
          resp.status,
          errBody.detail ?? `HTTP ${resp.status}`,
        );
      }
      const data = (await resp.json()) as CsvImportResponse;
      setResult(data);
      qc.invalidateQueries({ queryKey: ["entregables"] });
      if (data.rows_imported > 0) {
        toast.success(`${data.rows_imported} entregables importados`);
      } else if (data.rows_failed > 0) {
        toast.error(`Falló: ${data.rows_failed} filas con error`);
      } else {
        toast.info("No se importó nada (todas duplicadas)");
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Error subiendo CSV");
    } finally {
      setUploading(false);
    }
  };

  const close = () => {
    if (uploading) return;
    setFile(null);
    setResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5 text-cehta-green" strokeWidth={1.75} />
            Importar entregables desde CSV
          </DialogTitle>
          <DialogDescription>
            Subí un .csv con tu listado masivo de entregables. Las filas
            duplicadas (mismo id_template + período) se saltan
            automáticamente.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <>
            {/* Botón descarga template */}
            <div className="mt-4 rounded-xl border border-info/20 bg-info/5 p-3">
              <div className="flex items-start gap-3">
                <Download
                  className="mt-0.5 h-4 w-4 shrink-0 text-info"
                  strokeWidth={1.75}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-ink-700">
                    ¿Primera vez? Descargá el template con el formato exacto.
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    Headers requeridos: id_template, nombre, categoria,
                    fecha_limite, frecuencia, prioridad, responsable, periodo
                  </p>
                  <button
                    type="button"
                    onClick={downloadTemplate}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-info px-2.5 py-1 text-xs font-medium text-white hover:bg-info/90"
                  >
                    <Download className="h-3 w-3" strokeWidth={2} />
                    Descargar template.csv
                  </button>
                </div>
              </div>
            </div>

            {/* Drag&drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) handleFile(dropped);
              }}
              onClick={() => inputRef.current?.click()}
              className={cn(
                "mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
                dragActive
                  ? "border-cehta-green bg-cehta-green/5"
                  : "border-hairline bg-ink-50/50 hover:border-cehta-green/40 hover:bg-cehta-green/5",
              )}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <Upload
                className="mb-2 h-8 w-8 text-ink-400"
                strokeWidth={1.5}
              />
              {file ? (
                <>
                  <p className="text-sm font-semibold text-ink-900">
                    {file.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    {(file.size / 1024).toFixed(1)} KB · listo para subir
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-ink-900">
                    Arrastrá tu .csv acá o click para seleccionar
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    Máximo 5 MB · UTF-8
                  </p>
                </>
              )}
            </div>
          </>
        )}

        {/* Resultado del import */}
        {result && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-positive/30 bg-positive/5 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  Importados
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-positive">
                  {result.rows_imported}
                </p>
              </div>
              <div className="rounded-xl border border-info/30 bg-info/5 p-3 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  Saltados (dup)
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-info">
                  {result.rows_skipped}
                </p>
              </div>
              <div
                className={cn(
                  "rounded-xl border p-3 text-center",
                  result.rows_failed > 0
                    ? "border-negative/30 bg-negative/5"
                    : "border-hairline bg-white",
                )}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  Fallidos
                </p>
                <p
                  className={cn(
                    "mt-1 text-2xl font-bold tabular-nums",
                    result.rows_failed > 0 ? "text-negative" : "text-ink-400",
                  )}
                >
                  {result.rows_failed}
                </p>
              </div>
            </div>

            {result.rows_imported > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-positive/20 bg-positive/5 px-3 py-2 text-sm text-positive">
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                {result.rows_imported} entregables nuevos en la base.
              </div>
            )}

            {result.errors.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-negative">
                  <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
                  Errores por fila ({result.errors.length})
                </p>
                <div className="max-h-64 overflow-y-auto rounded-xl border border-hairline">
                  <table className="min-w-full divide-y divide-hairline text-xs">
                    <thead className="bg-ink-50 text-[10px] uppercase tracking-wider text-ink-500">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Fila</th>
                        <th className="px-2 py-1.5 text-left">Error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {result.errors.map((e) => (
                        <tr key={e.row} className="bg-white">
                          <td className="whitespace-nowrap px-2 py-1.5 font-medium tabular-nums text-ink-700">
                            #{e.row}
                          </td>
                          <td className="px-2 py-1.5 text-negative">
                            {e.error}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={close}
            disabled={uploading}
            className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100/40 disabled:opacity-60"
          >
            {result ? "Cerrar" : "Cancelar"}
          </button>
          {!result && (
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || uploading}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-60"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                  Importando…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" strokeWidth={2} />
                  Importar
                </>
              )}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
