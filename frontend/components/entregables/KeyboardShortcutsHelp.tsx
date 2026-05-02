"use client";

/**
 * KeyboardShortcutsHelp — V4 fase 7.6.
 *
 * Overlay con la lista de shortcuts disponibles en `/entregables`.
 * Se abre con `?` (Shift + /) y se cierra con Escape o click fuera.
 *
 * Patrón estándar de power-users (GitHub, Linear, Notion).
 */
import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { cn } from "@/lib/utils";

const SHORTCUTS: Array<{ key: string; description: string; group: string }> = [
  // Navegación
  { key: "?", description: "Mostrar / ocultar esta ayuda", group: "General" },
  { key: "g + a", description: "Ir a vista Agenda", group: "Vistas" },
  { key: "g + p", description: "Ir a vista Próximos", group: "Vistas" },
  { key: "g + m", description: "Ir a vista Mensual", group: "Vistas" },
  { key: "g + t", description: "Ir a vista Timeline", group: "Vistas" },
  { key: "g + h", description: "Ir a vista Heatmap (año completo)", group: "Vistas" },

  // Búsqueda
  { key: "/", description: "Foco en búsqueda libre", group: "Filtros" },
  { key: "Esc", description: "Limpiar filtros / cerrar diálogo", group: "Filtros" },

  // Selección bulk (vista Agenda)
  {
    key: "Shift + A",
    description: "Seleccionar todos los del mes en foco",
    group: "Bulk (vista Agenda)",
  },
  {
    key: "Shift + X",
    description: "Limpiar selección",
    group: "Bulk (vista Agenda)",
  },
];

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignorar si el usuario está escribiendo en un input/textarea/select
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Ver atajos de teclado (?)"
        aria-label="Ver atajos de teclado"
        className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-600 transition-colors hover:bg-ink-50"
      >
        <Keyboard className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span className="hidden sm:inline">Atajos</span>
        <kbd className="hidden rounded border border-hairline bg-ink-50 px-1 py-0.5 font-mono text-[10px] sm:inline">
          ?
        </kbd>
      </button>
    );
  }

  // Agrupar por categoría
  const groups = SHORTCUTS.reduce<Record<string, typeof SHORTCUTS>>(
    (acc, s) => {
      if (!acc[s.group]) acc[s.group] = [];
      acc[s.group]!.push(s);
      return acc;
    },
    {},
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Atajos de teclado"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-card-hover ring-1 ring-hairline">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink-900">
            <Keyboard className="h-5 w-5 text-cehta-green" strokeWidth={1.75} />
            Atajos de teclado
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg p-1 text-ink-500 hover:bg-ink-100/40"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="space-y-4">
          {Object.entries(groups).map(([groupName, shortcuts]) => (
            <div key={groupName}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                {groupName}
              </p>
              <ul className="space-y-1.5">
                {shortcuts.map((s) => (
                  <li
                    key={s.key + s.description}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-ink-700">{s.description}</span>
                    <kbd
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-md border border-hairline bg-ink-50 px-2 py-0.5 font-mono text-[11px] text-ink-700 shadow-[0_1px_0_rgba(0,0,0,0.04)]",
                      )}
                    >
                      {s.key}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-5 border-t border-hairline pt-3 text-[10px] text-ink-500">
          Los atajos no se activan mientras estés escribiendo en un input.
          Apretá <kbd className="rounded border border-hairline bg-ink-50 px-1 font-mono text-[10px]">Esc</kbd> para volver al teclado normal.
        </p>
      </div>
    </div>
  );
}

/**
 * Hook que registra los shortcuts de navegación + filtros para la página
 * de entregables. Devuelve nada — los handlers se invocan via los setters
 * que recibe.
 *
 * `g + X` es el patrón estándar de "go to" (GitHub/Linear). Esperamos la
 * 'g' y dentro de 1.5s aceptamos la siguiente tecla como destino.
 */
export function useEntregablesShortcuts(opts: {
  setVista: (
    v: "agenda" | "proximos" | "mensual" | "timeline" | "heatmap",
  ) => void;
  focusSearch?: () => void;
  clearFilters?: () => void;
}) {
  useEffect(() => {
    let pendingG = false;
    let pendingGTimer: ReturnType<typeof setTimeout> | null = null;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      // "/" abre la búsqueda incluso si el foco está en otro lugar
      if (!isTyping && e.key === "/" && opts.focusSearch) {
        e.preventDefault();
        opts.focusSearch();
        return;
      }

      if (isTyping) return;

      if (pendingG) {
        if (e.key === "a") {
          e.preventDefault();
          opts.setVista("agenda");
        } else if (e.key === "p") {
          e.preventDefault();
          opts.setVista("proximos");
        } else if (e.key === "m") {
          e.preventDefault();
          opts.setVista("mensual");
        } else if (e.key === "t") {
          e.preventDefault();
          opts.setVista("timeline");
        } else if (e.key === "h") {
          e.preventDefault();
          opts.setVista("heatmap");
        }
        pendingG = false;
        if (pendingGTimer) clearTimeout(pendingGTimer);
        return;
      }

      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        pendingG = true;
        if (pendingGTimer) clearTimeout(pendingGTimer);
        pendingGTimer = setTimeout(() => {
          pendingG = false;
        }, 1500);
        return;
      }

      if (e.key === "Escape" && opts.clearFilters) {
        opts.clearFilters();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (pendingGTimer) clearTimeout(pendingGTimer);
    };
  }, [opts]);
}
