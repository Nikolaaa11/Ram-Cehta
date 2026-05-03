"use client";

/**
 * ErrorState — V4 fase 7.16.
 *
 * Componente universal para errores de carga con botón de retry. Reemplaza
 * los error states ad-hoc por la app — ahora todos tienen el mismo estilo
 * y siempre ofrecen acción de recuperación.
 *
 * Uso típico con TanStack Query:
 *   {error && (
 *     <ErrorState
 *       title="No se pudo cargar la lista"
 *       error={error}
 *       onRetry={refetch}
 *     />
 *   )}
 */
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface Props {
  title?: string;
  description?: string;
  /** Si se pasa el error, se intenta extraer el detalle automáticamente. */
  error?: Error | null;
  onRetry?: () => void;
  /** Variante visual: 'inline' (compacta dentro de cards) o 'page' (full block). */
  variant?: "page" | "inline";
  className?: string;
}

function extractDetail(error: Error | null | undefined): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return "No tenés permisos para ver esta sección. Contactá al admin.";
    }
    if (error.status === 404) {
      return "La información solicitada ya no existe o no se encontró.";
    }
    if (error.status === 503) {
      return "Servicio no configurado. Contactá al admin.";
    }
    if (error.status >= 500) {
      return `Error del servidor (HTTP ${error.status}). Probá más tarde.`;
    }
    return error.detail;
  }
  return error.message || "Error desconocido";
}

export function ErrorState({
  title = "No se pudo cargar la información",
  description,
  error,
  onRetry,
  variant = "page",
  className,
}: Props) {
  const detail = description ?? extractDetail(error) ?? undefined;

  if (variant === "inline") {
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl border border-negative/30 bg-negative/5 px-3 py-2.5",
          className,
        )}
      >
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-negative"
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-negative">{title}</p>
          {detail && (
            <p className="mt-0.5 text-[11px] text-ink-600">{detail}</p>
          )}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-lg border border-negative/30 bg-white px-2 py-1 text-[11px] font-medium text-negative hover:bg-negative/5"
          >
            <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
            Reintentar
          </button>
        )}
      </div>
    );
  }

  return (
    <Surface
      className={cn(
        "border border-negative/20 bg-negative/5 py-10 text-center",
        className,
      )}
    >
      <div className="mx-auto max-w-md">
        <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-negative/15 text-negative">
          <AlertTriangle className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <p className="text-base font-semibold text-negative">{title}</p>
        {detail && <p className="mt-1 text-sm text-ink-600">{detail}</p>}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-negative px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-negative/90"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
            Reintentar
          </button>
        )}
      </div>
    </Surface>
  );
}
