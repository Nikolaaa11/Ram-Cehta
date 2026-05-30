"use client";

/**
 * HelpButton — Round 152i.
 *
 * Botón flotante "?" presente en todas las páginas (montado 1 vez en el
 * layout). Al hacer clic abre un panel lateral con ayuda CONTEXTUAL según
 * la ruta actual: qué es el módulo, pasos prácticos, tips y link a la guía
 * HTML completa.
 *
 * 100% aditivo: no toca ninguna página existente. La ayuda se edita en
 * lib/help/help-content.ts (un solo archivo).
 */
import { useState } from "react";
import { usePathname } from "next/navigation";
import { HelpCircle, X, BookOpen, CheckCircle2, Lightbulb } from "lucide-react";
import { getHelpForPath } from "@/lib/help/help-content";

export function HelpButton() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);

  // No mostrar en login / páginas públicas
  if (pathname.startsWith("/login") || pathname === "/logout") return null;

  const help = getHelpForPath(pathname);

  return (
    <>
      {/* Botón flotante */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ayuda"
        title="Ayuda de esta sección"
        className="fixed bottom-5 left-5 z-40 hidden size-11 items-center justify-center rounded-full bg-white text-cehta-green shadow-elevated-lg ring-1 ring-hairline transition-transform hover:scale-105 active:scale-95 md:flex print:hidden"
      >
        <HelpCircle className="size-6" strokeWidth={1.8} />
      </button>

      {/* Overlay + panel */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-50 bg-ink-900/20 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <aside
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
            role="dialog"
            aria-label="Panel de ayuda"
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-hairline px-6 py-5">
              <div>
                <div className="flex items-center gap-2 text-cehta-green">
                  <HelpCircle className="size-4" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">
                    Ayuda · esta sección
                  </span>
                </div>
                <h2 className="mt-1 text-xl font-semibold text-ink-900">
                  {help.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* Qué es */}
              <p className="text-sm leading-relaxed text-ink-700">{help.what}</p>

              {/* Pasos */}
              {help.steps && help.steps.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-500">
                    Cómo se usa
                  </h3>
                  <ol className="space-y-2.5">
                    {help.steps.map((s, i) => (
                      <li key={i} className="flex gap-3 text-sm text-ink-700">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-cehta-green/10 text-[11px] font-semibold text-cehta-green">
                          {i + 1}
                        </span>
                        <span className="leading-relaxed">{s}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Tips */}
              {help.tips && help.tips.length > 0 && (
                <div className="mt-6 space-y-2">
                  {help.tips.map((t, i) => (
                    <div
                      key={i}
                      className="flex gap-2.5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900"
                    >
                      <Lightbulb className="size-4 shrink-0 text-amber-500" />
                      <span className="leading-relaxed">{t}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer — links a guías completas */}
            <div className="border-t border-hairline px-6 py-4">
              {help.guide && (
                <a
                  href={help.guide.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-2 flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cehta-green-700"
                >
                  <BookOpen className="size-4" />
                  {help.guide.label}
                </a>
              )}
              <div className="grid grid-cols-2 gap-2">
                <a
                  href="/ayuda/plataforma.html#faq"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100"
                >
                  💬 FAQ Plataforma
                </a>
                <a
                  href="/ayuda/plataforma.html#errores"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
                >
                  ⚠️ Errores comunes
                </a>
                <a
                  href="/ayuda/vouchers.html#faq"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100"
                >
                  💬 FAQ Vouchers
                </a>
                <a
                  href="/ayuda/vouchers.html#tasa-error"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
                >
                  ⚠️ Errores Vouchers
                </a>
              </div>
              <div className="mt-2 flex gap-2">
                <a
                  href="/ayuda/plataforma.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-hairline px-3 py-2 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink-50"
                >
                  <CheckCircle2 className="size-3" />
                  Guía completa Plataforma
                </a>
                <a
                  href="/ayuda/vouchers.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-hairline px-3 py-2 text-[11px] font-medium text-ink-500 transition-colors hover:bg-ink-50"
                >
                  <CheckCircle2 className="size-3" />
                  Guía completa Vouchers
                </a>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
