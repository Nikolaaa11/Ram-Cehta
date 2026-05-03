"use client";

/**
 * ImportarGanttDialog — V4 fase 8.
 *
 * Flujo en dos pasos: (1) usuario sube Excel → se llama a
 * `/avance/{codigo}/import-excel/preview` que devuelve los proyectos
 * detectados sin tocar DB. (2) Usuario revisa y confirma → se llama a
 * `/import-excel/commit` que crea/actualiza proyectos+hitos.
 *
 * El parser detecta automáticamente el formato (clásico/EE/REVTECH)
 * por las hojas presentes. Si el formato es desconocido el preview
 * muestra el warning y bloquea el commit.
 *
 * Drag-and-drop: input file estándar + drag-over visual.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  Upload,
  AlertTriangle,
  FileSpreadsheet,
  Loader2,
  ChevronRight,
  Trash2,
  Cloud,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type {
  GanttImportPreview,
  GanttImportResult,
  GanttProyectoPreview,
} from "@/lib/api/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaCodigo: string;
  onImported: () => void;
}

type Step = "upload" | "preview" | "done";

const FORMATO_LABEL: Record<string, string> = {
  classic: "Clásico (RHO/TRONGKAI/DTE)",
  ee: "EE — PROJECT_MANAGEMENT",
  revtech: "REVTECH — Gantt_Master",
  unknown: "Desconocido",
};

export function ImportarGanttDialog({
  open,
  onOpenChange,
  empresaCodigo,
  onImported,
}: Props) {
  const { session } = useSession();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<GanttImportPreview | null>(null);
  const [result, setResult] = useState<GanttImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [expandedCodigos, setExpandedCodigos] = useState<Set<string>>(new Set());

  const reset = () => {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setResult(null);
    setExpandedCodigos(new Set());
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const previewMutation = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      return apiClient.postForm<GanttImportPreview>(
        `/avance/${empresaCodigo}/import-excel/preview`,
        fd,
        session,
      );
    },
    onSuccess: (data) => {
      setPreview(data);
      setStep("preview");
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError
          ? err.detail
          : "No se pudo procesar el archivo. Verificá que sea un .xlsx válido.",
      );
    },
  });

  const commitMutation = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append("file", f);
      return apiClient.postForm<GanttImportResult>(
        `/avance/${empresaCodigo}/import-excel/commit`,
        fd,
        session,
      );
    },
    onSuccess: (data) => {
      setResult(data);
      setStep("done");
      toast.success(data.message);
      onImported();
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "Error al importar el Gantt.",
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () =>
      apiClient.delete<{
        proyectos_borrados: number;
        message: string;
      }>(
        `/avance/${empresaCodigo}/import-excel/proyectos-importados`,
        session,
      ),
    onSuccess: (data) => {
      toast.success(data.message);
      onImported();
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "Error al borrar proyectos importados.",
      );
    },
  });

  // Sync 1-click desde Dropbox: descarga + parsea + commitea
  const dropboxMutation = useMutation({
    mutationFn: async () =>
      apiClient.post<GanttImportResult>(
        `/avance/${empresaCodigo}/import-excel/sync-from-dropbox`,
        {},
        session,
      ),
    onSuccess: (data) => {
      setResult(data);
      setStep("done");
      toast.success(data.message);
      onImported();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 503) {
          toast.error("Dropbox no conectado. Conectalo en /admin/integraciones.");
        } else if (err.status === 404) {
          toast.error(err.detail);
        } else {
          toast.error(err.detail);
        }
      } else {
        toast.error("Error al sincronizar desde Dropbox.");
      }
    },
  });

  const handleFile = (f: File | null) => {
    if (!f) return;
    if (!/\.(xlsx|xlsm)$/i.test(f.name)) {
      toast.error("Sólo archivos .xlsx o .xlsm");
      return;
    }
    setFile(f);
    previewMutation.mutate(f);
  };

  const toggleExpand = (codigo: string) => {
    setExpandedCodigos((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo);
      else next.add(codigo);
      return next;
    });
  };

  const canCommit =
    step === "preview" &&
    preview !== null &&
    preview.formato !== "unknown" &&
    preview.total_proyectos > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
        <div className="border-b border-hairline px-6 py-4">
          <DialogTitle>Importar Carta Gantt</DialogTitle>
          <DialogDescription className="mt-1">
            Subí el Excel del Gantt de {empresaCodigo}. Detectamos
            automáticamente el formato (clásico, EE o REVTECH) y previsualizamos
            antes de persistir.
          </DialogDescription>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {step === "upload" && (
            <>
              {/* Atajo recomendado: Sincronizar desde Dropbox */}
              <button
                type="button"
                onClick={() => dropboxMutation.mutate()}
                disabled={dropboxMutation.isPending || previewMutation.isPending}
                className="mb-3 flex w-full items-center justify-between gap-3 rounded-2xl border border-cehta-green/30 bg-cehta-green/5 px-4 py-3 text-left transition-colors hover:bg-cehta-green/10 disabled:opacity-60"
              >
                <div className="flex items-center gap-3">
                  {dropboxMutation.isPending ? (
                    <Loader2
                      className="h-5 w-5 animate-spin text-cehta-green"
                      strokeWidth={1.75}
                    />
                  ) : (
                    <Cloud
                      className="h-5 w-5 text-cehta-green"
                      strokeWidth={1.75}
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">
                      Sincronizar desde Dropbox
                    </p>
                    <p className="truncate text-[11px] text-ink-500">
                      /Cehta Capital/01-Empresas/{empresaCodigo}/05-Proyectos &amp;
                      Avance/Roadmap.xlsx
                    </p>
                  </div>
                </div>
                <span className="rounded-md bg-cehta-green px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                  Recomendado
                </span>
              </button>

              <div className="relative my-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-400">
                <div className="h-px flex-1 bg-hairline" />
                <span>o subí un archivo manualmente</span>
                <div className="h-px flex-1 bg-hairline" />
              </div>

              <UploadStep
                dragOver={dragOver}
                isLoading={previewMutation.isPending}
                onDragChange={setDragOver}
                onFile={handleFile}
              />
              <div className="mt-3 flex items-center justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "¿Borrar todos los proyectos importados desde Excel para " +
                          empresaCodigo +
                          "? Los proyectos creados manualmente NO se tocan. Esta acción no se puede deshacer.",
                      )
                    ) {
                      deleteMutation.mutate();
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-ink-500 hover:bg-negative/5 hover:text-negative disabled:opacity-60"
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                  )}
                  Borrar todos los proyectos importados
                </button>
              </div>
            </>
          )}

          {step === "preview" && preview && (
            <PreviewStep
              preview={preview}
              expandedCodigos={expandedCodigos}
              onToggleExpand={toggleExpand}
            />
          )}

          {step === "done" && result && <DoneStep result={result} />}
        </div>

        <div className="flex items-center justify-between border-t border-hairline px-6 py-3">
          <button
            type="button"
            onClick={() => handleClose(false)}
            className="rounded-xl px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-100/40"
          >
            {step === "done" ? "Cerrar" : "Cancelar"}
          </button>

          <div className="flex items-center gap-2">
            {step === "preview" && (
              <button
                type="button"
                onClick={reset}
                className="rounded-xl px-3 py-1.5 text-sm font-medium text-ink-700 ring-1 ring-hairline hover:bg-ink-50"
                disabled={commitMutation.isPending}
              >
                Subir otro
              </button>
            )}
            {step === "preview" && (
              <button
                type="button"
                onClick={() => file && commitMutation.mutate(file)}
                disabled={!canCommit || commitMutation.isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700 disabled:opacity-60"
              >
                {commitMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                ) : (
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                )}
                Confirmar e importar
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Upload step ────────────────────────────────────────────────────────────

function UploadStep({
  dragOver,
  isLoading,
  onDragChange,
  onFile,
}: {
  dragOver: boolean;
  isLoading: boolean;
  onDragChange: (v: boolean) => void;
  onFile: (f: File | null) => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        onDragChange(true);
      }}
      onDragLeave={() => onDragChange(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDragChange(false);
        const f = e.dataTransfer.files?.[0] ?? null;
        onFile(f);
      }}
      className={cn(
        "flex min-h-[260px] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors",
        dragOver
          ? "border-cehta-green bg-cehta-green/5"
          : "border-hairline bg-ink-100/30",
      )}
    >
      {isLoading ? (
        <>
          <Loader2
            className="mb-3 h-10 w-10 animate-spin text-cehta-green"
            strokeWidth={1.5}
          />
          <p className="text-sm font-medium text-ink-900">Procesando Excel…</p>
          <p className="mt-1 text-xs text-ink-500">
            Detectando formato y parseando proyectos.
          </p>
        </>
      ) : (
        <>
          <FileSpreadsheet
            className="mb-3 h-12 w-12 text-ink-400"
            strokeWidth={1.5}
          />
          <p className="text-base font-medium text-ink-900">
            Arrastrá el Excel acá
          </p>
          <p className="mt-1 text-xs text-ink-500">
            o hacé click para seleccionarlo · .xlsx / .xlsm · máx 5 MB
          </p>
          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700">
            <Upload className="h-4 w-4" strokeWidth={2} />
            Seleccionar archivo
            <input
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="mt-6 max-w-md text-[11px] text-ink-400">
            Soportamos los 3 formatos del portafolio: clásico (RHO, TRONGKAI,
            DTE), EE (PROJECT_MANAGEMENT) y REVTECH (Gantt_Master con
            avance%).
          </p>
        </>
      )}
    </div>
  );
}

// ─── Preview step ───────────────────────────────────────────────────────────

function PreviewStep({
  preview,
  expandedCodigos,
  onToggleExpand,
}: {
  preview: GanttImportPreview;
  expandedCodigos: Set<string>;
  onToggleExpand: (c: string) => void;
}) {
  const isUnknown = preview.formato === "unknown";

  return (
    <div className="space-y-4">
      {/* Header card con resumen */}
      <div
        className={cn(
          "rounded-2xl border p-4",
          isUnknown
            ? "border-negative/30 bg-negative/5"
            : "border-cehta-green/30 bg-cehta-green/5",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-ink-500">
              Formato detectado
            </p>
            <p
              className={cn(
                "mt-1 text-lg font-semibold",
                isUnknown ? "text-negative" : "text-ink-900",
              )}
            >
              {FORMATO_LABEL[preview.formato] ?? preview.formato}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-ink-500">Proyectos · Hitos</p>
            <p className="text-lg font-semibold tabular-nums text-ink-900">
              {preview.total_proyectos} · {preview.total_hitos}
            </p>
          </div>
        </div>
      </div>

      {/* Warnings */}
      {preview.warnings.length > 0 && (
        <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-warning"
              strokeWidth={1.75}
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-ink-900">
                {preview.warnings.length}{" "}
                {preview.warnings.length === 1 ? "advertencia" : "advertencias"}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-ink-700">
                {preview.warnings.slice(0, 6).map((w, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-warning" />
                    {w}
                  </li>
                ))}
                {preview.warnings.length > 6 && (
                  <li className="italic text-ink-500">
                    + {preview.warnings.length - 6} más
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Lista de proyectos */}
      {!isUnknown && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wider text-ink-500">
            Proyectos detectados
          </p>
          <div className="space-y-1.5">
            {preview.proyectos.map((p) => (
              <ProyectoRow
                key={p.codigo}
                p={p}
                expanded={expandedCodigos.has(p.codigo)}
                onToggle={() => onToggleExpand(p.codigo)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProyectoRow({
  p,
  expanded,
  onToggle,
}: {
  p: GanttProyectoPreview;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-ink-50"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform",
            expanded && "rotate-90",
          )}
          strokeWidth={2}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="neutral" className="font-mono text-[10px]">
              {p.codigo}
            </Badge>
            <p className="truncate text-sm font-medium text-ink-900">
              {p.nombre}
            </p>
          </div>
          <p className="mt-0.5 text-xs text-ink-500">
            {p.hitos.length} {p.hitos.length === 1 ? "hito" : "hitos"} ·{" "}
            {p.estado.replace("_", " ")} · progreso {p.progreso_pct}%
            {p.fecha_inicio && (
              <>
                {" "}
                · {p.fecha_inicio} → {p.fecha_fin_estimada ?? "?"}
              </>
            )}
          </p>
        </div>
      </button>
      {expanded && p.hitos.length > 0 && (
        <ul className="border-t border-hairline px-3 py-2 text-xs">
          {p.hitos.slice(0, 25).map((h, i) => (
            <li
              key={i}
              className="flex items-start gap-2 border-b border-hairline/50 py-1.5 last:border-b-0"
            >
              <span
                className={cn(
                  "mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                  h.estado === "completado"
                    ? "bg-positive"
                    : h.estado === "en_progreso"
                    ? "bg-cehta-green"
                    : h.estado === "cancelado"
                    ? "bg-negative"
                    : "bg-ink-300",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-ink-900">{h.nombre}</p>
                <p className="text-[10px] text-ink-500">
                  {h.fecha_planificada ?? "sin fecha"}
                  {h.encargado && <> · {h.encargado}</>}
                  {h.progreso_pct > 0 && <> · {h.progreso_pct}%</>}
                </p>
              </div>
            </li>
          ))}
          {p.hitos.length > 25 && (
            <li className="py-1.5 text-center italic text-ink-400">
              + {p.hitos.length - 25} hitos más
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ─── Done step ──────────────────────────────────────────────────────────────

function DoneStep({ result }: { result: GanttImportResult }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <span className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-positive/15 text-positive">
        <CheckCircle2 className="h-7 w-7" strokeWidth={1.5} />
      </span>
      <p className="text-base font-medium text-ink-900">
        Importación completada
      </p>
      <p className="mt-1 max-w-md text-sm text-ink-500">{result.message}</p>
      <div className="mt-6 grid grid-cols-2 gap-6 text-center sm:grid-cols-4">
        <Stat label="Proyectos nuevos" value={result.proyectos_creados} />
        <Stat
          label="Proyectos actualizados"
          value={result.proyectos_actualizados}
        />
        <Stat label="Hitos nuevos" value={result.hitos_creados} />
        <Stat label="Hitos actualizados" value={result.hitos_actualizados} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-semibold tabular-nums text-ink-900">{value}</p>
      <p className="mt-0.5 text-[11px] text-ink-500">{label}</p>
    </div>
  );
}
