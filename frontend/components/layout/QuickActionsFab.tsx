"use client";

/**
 * QuickActionsFab — V4 fase 7.14.
 *
 * Floating Action Button (FAB) que aparece en todas las páginas del shell
 * autenticado. Click expande un radial menu con las acciones más comunes:
 *   - 🔍 Búsqueda global (abre Cmd+K)
 *   - ✨ Pregunta AI
 *   - 📋 Ir a entregables
 *   - 📅 Ir a calendario
 *   - 📊 Reporte CV
 *
 * Pensado para mobile primarily — en desktop el sidebar y Cmd+K cubren
 * estas acciones, pero el FAB las hace accesibles con un solo toque desde
 * cualquier página.
 *
 * UX:
 * - Default cerrado, icon `Plus` que rota 45° al abrir → `X`.
 * - Click fuera → cierra.
 * - Esc → cierra.
 * - `print:hidden` para no aparecer en PDFs exportados.
 */
import { useEffect, useState } from "react";
import {
  CalendarDays,
  ClipboardList,
  FileText,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Action {
  href?: string;
  onClick?: () => void;
  label: string;
  icon: typeof Plus;
  shortcut?: string;
  /** Color tone del ring + icono. */
  tone: "info" | "positive" | "warning" | "negative" | "default";
}

const ACTIONS: Action[] = [
  {
    label: "Búsqueda global",
    icon: Search,
    shortcut: "⌘K",
    tone: "default",
    onClick: () => {
      // Dispatch del evento que escucha CommandPaletteProvider
      const e = new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
        bubbles: true,
      });
      window.dispatchEvent(e);
    },
  },
  {
    label: "Pregunta al AI",
    icon: Sparkles,
    href: "/asistente",
    tone: "info",
  },
  {
    label: "Entregables",
    icon: ClipboardList,
    href: "/entregables",
    tone: "positive",
  },
  {
    label: "Calendario",
    icon: CalendarDays,
    href: "/calendario",
    tone: "default",
  },
  {
    label: "Reporte CV",
    icon: FileText,
    href: "/entregables/reporte",
    tone: "warning",
  },
];

const TONE_BG: Record<Action["tone"], string> = {
  default: "bg-ink-100 text-ink-700 hover:bg-ink-200",
  positive: "bg-positive/15 text-positive hover:bg-positive/25",
  warning: "bg-warning/15 text-warning hover:bg-warning/25",
  negative: "bg-negative/15 text-negative hover:bg-negative/25",
  info: "bg-cehta-green/15 text-cehta-green hover:bg-cehta-green/25",
};

export function QuickActionsFab() {
  const [open, setOpen] = useState(false);

  // Cerrar con Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Backdrop click-to-close cuando abierto */}
      {open && (
        <button
          type="button"
          aria-label="Cerrar menú de acciones"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-ink-900/10 backdrop-blur-[2px] print:hidden md:hidden"
        />
      )}

      <div
        className="fab-container fixed right-4 z-40 flex flex-col items-end gap-2 print:hidden md:right-6 md:bottom-6"
      >
        {/* Action buttons revealed cuando open */}
        {open &&
          ACTIONS.map((action, idx) => {
            const Icon = action.icon;
            const inner = (
              <>
                <span
                  className={cn(
                    "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors",
                    TONE_BG[action.tone],
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <span className="rounded-lg bg-ink-900 px-2.5 py-1 text-xs font-medium text-white shadow-card">
                  {action.label}
                  {action.shortcut && (
                    <kbd className="ml-1.5 rounded bg-ink-700 px-1 font-mono text-[10px]">
                      {action.shortcut}
                    </kbd>
                  )}
                </span>
              </>
            );

            const styleProps = {
              className: cn(
                "group flex flex-row-reverse items-center gap-2",
                "animate-in slide-in-from-bottom-2 fade-in",
              ),
              style: { animationDelay: `${idx * 30}ms` },
              onClick: () => {
                action.onClick?.();
                setOpen(false);
              },
            };

            if (action.href) {
              return (
                <a key={action.label} href={action.href} {...styleProps}>
                  {inner}
                </a>
              );
            }
            return (
              <button
                key={action.label}
                type="button"
                {...styleProps}
              >
                {inner}
              </button>
            );
          })}

        {/* FAB principal — premium con glow + ripple-style pulse cuando idle */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Cerrar acciones rápidas" : "Acciones rápidas"}
          aria-expanded={open}
          className={cn(
            "group relative inline-flex h-14 w-14 items-center justify-center rounded-full overflow-hidden",
            "bg-gradient-to-br from-cehta-green via-emerald-600 to-cehta-green-700",
            "text-white shadow-glow-green",
            "transition-all duration-300 ease-apple",
            "hover:scale-110 hover:shadow-elevated-lg active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2",
          )}
        >
          {/* Pulse ring sutil cuando idle (closed) */}
          {!open && (
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-cehta-green/30 animate-pulse-ring"
            />
          )}
          {/* Shimmer sweep on hover */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 ease-apple group-hover:translate-x-full"
          />
          {open ? (
            <X
              className="relative h-6 w-6 transition-transform duration-300 ease-apple rotate-0"
              strokeWidth={2.5}
            />
          ) : (
            <Plus
              className="relative h-6 w-6 transition-transform duration-300 ease-apple group-hover:rotate-90"
              strokeWidth={2.5}
            />
          )}
        </button>
      </div>
    </>
  );
}
