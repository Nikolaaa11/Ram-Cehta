"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Surface } from "@/components/ui/surface";

/**
 * Error boundary para rutas /empresa/[codigo]/*. Atrapa cualquier error
 * server-side o client-side y muestra un fallback amistoso con botón
 * de reintentar (Next.js retry pattern).
 */
export default function EmpresaErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Loggear a consola — Sentry ya lo captura via global-error si está configurado.
    console.error("Empresa route error:", error);
  }, [error]);

  return (
    <div className="space-y-6">
      <Surface className="border border-negative/20 bg-negative/5 ring-1 ring-negative/20">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-negative/15 text-negative">
            <AlertTriangle className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <div className="flex-1">
            <Surface.Title className="text-negative">
              No se pudo cargar la página
            </Surface.Title>
            <Surface.Subtitle>
              {error.message || "Error desconocido"}
              {error.digest && (
                <span className="ml-2 text-xs text-ink-300">
                  (digest: {error.digest})
                </span>
              )}
            </Surface.Subtitle>
            <Surface.Body className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => reset()}
                className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-apple hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
              >
                <RotateCw className="h-4 w-4" strokeWidth={2} />
                Reintentar
              </button>
              <p className="text-xs text-ink-500">
                Si persiste, verificá que el backend esté actualizado:{" "}
                <code className="rounded bg-ink-100/60 px-1 py-0.5">
                  flyctl deploy
                </code>
              </p>
            </Surface.Body>
          </div>
        </div>
      </Surface>
    </div>
  );
}
