"use client";

/**
 * ResetDataButton — V5++ ola CD.
 *
 * Botón premium con confirmación type-to-confirm para borrar/resetear
 * datos antes de subir nueva versión (ej: borrar Gantt viejo antes de
 * subir uno actualizado).
 *
 * Features:
 *   - Botón rojo con icon trash + tooltip
 *   - Dialog con explicación clara de QUÉ se borra
 *   - Type-to-confirm (escribir "BORRAR EVOQUE" antes de habilitar)
 *   - Loading state durante la operación
 *   - Toast success/error
 *   - Audit automático (el backend hace audit_log)
 *
 * Uso:
 *   <ResetDataButton
 *     endpoint={`/avance/${empresa}/import-excel/proyectos-importados`}
 *     method="DELETE"
 *     title="Borrar Gantt anterior"
 *     description="Borrará todos los proyectos importados desde Excel..."
 *     confirmWord={`BORRAR ${empresa}`}
 *     onSuccess={() => refetch()}
 *   />
 */
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ResetDataButtonProps {
  /** URL relativa del endpoint, ej: "/avance/EVOQUE/import-excel/proyectos-importados". */
  endpoint: string;
  /** Método HTTP. Default DELETE. */
  method?: "DELETE" | "POST";
  /** Body opcional para POST (ej: { fecha_desde: '...', confirm: true }). */
  body?: Record<string, unknown>;
  /** Texto del botón. Default "Resetear datos". */
  label?: string;
  /** Título del dialog. */
  title: string;
  /** Descripción de qué se borra y qué NO. Acepta texto o JSX. */
  description: React.ReactNode;
  /** Palabra exacta que el user debe tipear para confirmar (case-sensitive). */
  confirmWord: string;
  /** Callback después de éxito (ej: refetch de la query principal). */
  onSuccess?: (result?: unknown) => void;
  /** Tamaño del botón. Default "sm". */
  size?: "sm" | "md";
  /** Si true, el botón aparece como ghost (transparente). Default false. */
  ghost?: boolean;
  className?: string;
}

export function ResetDataButton({
  endpoint,
  method = "DELETE",
  body,
  label = "Resetear datos",
  title,
  description,
  confirmWord,
  onSuccess,
  size = "sm",
  ghost = false,
  className,
}: ResetDataButtonProps) {
  const { session } = useSession();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (method === "POST") {
        return await apiClient.post(endpoint, body ?? {}, session);
      }
      return await apiClient.delete(endpoint, session);
    },
    onSuccess: (result) => {
      toast.success("Datos eliminados correctamente");
      setOpen(false);
      setTyped("");
      onSuccess?.(result);
    },
    onError: (err) => {
      const detail = err instanceof ApiError ? err.detail : String(err);
      toast.error(`No se pudo borrar: ${detail}`);
    },
  });

  const canConfirm = typed.trim() === confirmWord && !mutation.isPending;

  const handleConfirm = () => {
    if (!canConfirm) return;
    mutation.mutate();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl font-medium transition-all duration-200 ease-apple",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative focus-visible:ring-offset-2",
          size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
          ghost
            ? "bg-transparent text-negative hover:bg-negative/10"
            : "border border-negative/30 bg-negative/5 text-negative hover:bg-negative/10 hover:border-negative/50 hover:-translate-y-0.5",
          className,
        )}
        title={title}
      >
        <Trash2
          className={size === "sm" ? "size-3.5" : "size-4"}
          strokeWidth={1.75}
        />
        {label}
      </button>

      <Dialog open={open} onOpenChange={(v) => { if (!mutation.isPending) setOpen(v); }}>
        <DialogContent className="max-w-md">
          {/* Header con icon warning */}
          <div className="flex items-start gap-3">
            <div className="relative shrink-0">
              <span
                aria-hidden
                className="absolute inset-0 rounded-full bg-negative/20 blur-md"
              />
              <span className="relative inline-flex h-12 w-12 items-center justify-center rounded-full bg-negative/10 ring-2 ring-negative/30">
                <AlertTriangle
                  className="size-6 text-negative"
                  strokeWidth={1.75}
                />
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="font-display text-lg font-semibold tracking-tight text-ink-900">
                {title}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="mt-1 text-sm text-ink-700 space-y-2">
                  {description}
                </div>
              </DialogDescription>
            </div>
          </div>

          {/* Aviso info */}
          <div className="mt-4 rounded-xl bg-amber-50/60 ring-1 ring-amber-200/60 p-3 text-xs text-amber-800">
            <p className="font-semibold mb-1">⚠️ Esta acción NO se puede deshacer.</p>
            <p>
              Quedará registro en la bitácora (quién borró, cuándo, qué). Si tenés
              dudas, mejor cancelá y consultá.
            </p>
          </div>

          {/* Type to confirm */}
          <div className="mt-4">
            <label className="block text-xs font-semibold uppercase tracking-wide text-ink-500 mb-1.5">
              Para confirmar, escribí:{" "}
              <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-900">
                {confirmWord}
              </code>
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Escribí la palabra exacta"
              autoFocus
              className={cn(
                "h-10 w-full rounded-xl bg-white px-3 text-sm ring-1 transition-all duration-150 ease-apple",
                "placeholder:text-ink-300 focus:outline-none",
                typed.length > 0 && typed !== confirmWord
                  ? "ring-warning/40 focus:ring-2 focus:ring-warning"
                  : typed === confirmWord
                    ? "ring-positive/40 focus:ring-2 focus:ring-positive"
                    : "ring-hairline focus:ring-2 focus:ring-cehta-green",
              )}
            />
          </div>

          {/* Buttons */}
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
              className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200",
                canConfirm
                  ? "bg-negative hover:bg-red-600 hover:-translate-y-0.5 hover:shadow-glow-red"
                  : "bg-ink-300 cursor-not-allowed",
              )}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Borrando…
                </>
              ) : (
                <>
                  <Trash2 className="size-4" strokeWidth={2} />
                  Confirmar borrado
                </>
              )}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
