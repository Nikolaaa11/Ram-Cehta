"use client";

/**
 * Error boundary global del segmento (app/(app)/).
 *
 * QA fix 14/05/2026 — antes una excepcion en cualquier child del segmento
 * /(app)/ rompia con la pantalla blanca de Next.js, sin posibilidad de
 * recuperar sin refrescar manualmente. Ahora hay un fallback con CTA
 * para reintentar.
 *
 * Next.js convencion: error.tsx debe ser "use client" y recibir
 * `error` + `reset` props. `reset()` re-renderiza el segmento desde
 * cero — TanStack Query queries se mantienen pero el render se reinicia.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, Check, Copy, Home, RefreshCw } from "lucide-react";

export default function AppSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Logging local; en prod Vercel + Sentry ya capturan.
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.error("[(app)/error.tsx] segment error:", error);
    }
  }, [error]);

  const copyDigest = async () => {
    const payload = [
      `Digest: ${error.digest ?? "n/a"}`,
      `Message: ${error.message}`,
      `URL: ${typeof window !== "undefined" ? window.location.href : "n/a"}`,
      `Timestamp: ${new Date().toISOString()}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Si clipboard API falla (HTTP no-secure, permisos), mostrar prompt
      // fallback no es nice pero al menos el user ve el texto.
      // eslint-disable-next-line no-alert
      alert(payload);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="rounded-3xl border border-red-200 bg-red-50/40 p-8 shadow-card">
        <div className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 ring-1 ring-red-200">
          <AlertTriangle className="size-3.5 text-red-600" strokeWidth={2} />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red-700">
            Algo falló en esta sección
          </p>
        </div>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-ink-900">
          No pudimos cargar esta página
        </h1>
        <p className="mt-2 text-sm text-ink-700 leading-relaxed">
          Una excepción interrumpió el render. Es probable que sea un blip
          transitorio (red lenta, sesión vencida, deploy en curso). Reintenta
          o volvé al inicio.
        </p>

        {error.message && (
          <details className="mt-4 rounded-xl border border-red-200 bg-white p-3">
            <summary className="cursor-pointer text-xs font-semibold text-ink-700">
              Detalle técnico
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-ink-600">
              {error.message}
              {error.digest && (
                <>
                  {"\n\nDigest: "}
                  <span className="font-mono">{error.digest}</span>
                </>
              )}
            </pre>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copyDigest}
                className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-ink-50 px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-ink-100"
              >
                {copied ? (
                  <>
                    <Check className="size-3 text-cehta-green" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    Copiar para soporte
                  </>
                )}
              </button>
              <a
                href={`mailto:soporte@cehta.cl?subject=${encodeURIComponent(
                  `Error en la app (digest ${error.digest ?? "n/a"})`,
                )}&body=${encodeURIComponent(
                  `Estaba haciendo: [describí qué intentabas hacer]\n\n` +
                    `Digest: ${error.digest ?? "n/a"}\nMessage: ${error.message}`,
                )}`}
                className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-ink-50 px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-ink-100"
              >
                Reportar por email
              </a>
            </div>
            <p className="mt-2 text-[10px] text-ink-500">
              Si esto pasa varias veces, mandanos el digest junto con la
              acción que estabas haciendo.
            </p>
          </details>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white hover:bg-cehta-green-700"
          >
            <RefreshCw className="size-4" />
            Reintentar
          </button>
          <Link
            href={"/dashboard" as Route}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50"
          >
            <Home className="size-4" />
            Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
