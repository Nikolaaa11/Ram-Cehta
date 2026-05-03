"use client";

/**
 * GlobalShortcutsHelp — V4 fase 7.14.
 *
 * Overlay disponible en TODA la app que muestra los keyboard shortcuts
 * disponibles. Activado con la tecla `?` (Shift+/).
 *
 * Pensado como referencia siempre disponible — el usuario aprende un
 * shortcut, lo olvida, presiona `?` y lo recuerda.
 *
 * Listed shortcuts coincide con lo registrado en `usePageShortcuts` y los
 * shortcuts page-specific de entregables/cartas-gantt/calendario.
 */
import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";

interface ShortcutGroup {
  title: string;
  items: Array<{ keys: string; description: string }>;
}

const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Globales",
    items: [
      { keys: "?", description: "Mostrar / ocultar esta ayuda" },
      { keys: "⌘ K", description: "Búsqueda global (command palette)" },
      { keys: "Esc", description: "Cerrar diálogos / limpiar filtros" },
      { keys: "/", description: "Foco en barra de búsqueda (donde aplique)" },
    ],
  },
  {
    title: "Navegación rápida (g + tecla)",
    items: [
      { keys: "g d", description: "Ir al Dashboard" },
      { keys: "g c", description: "Ir al Calendario" },
      { keys: "g e", description: "Ir a Entregables" },
      { keys: "g r", description: "Ir a Reportes" },
      { keys: "g a", description: "Ir al Asistente AI" },
    ],
  },
  {
    title: "En /entregables",
    items: [
      { keys: "g a", description: "Vista Agenda" },
      { keys: "g p", description: "Vista Próximos" },
      { keys: "g m", description: "Vista Mensual" },
      { keys: "g t", description: "Vista Timeline" },
      { keys: "g h", description: "Vista Heatmap (año completo)" },
    ],
  },
  {
    title: "En /calendario",
    items: [
      { keys: "g m", description: "Tab Mes" },
      { keys: "g o", description: "Tab Obligaciones" },
      { keys: "p", description: "Imprimir mes / Exportar PDF" },
    ],
  },
  {
    title: "En /cartas-gantt",
    items: [
      { keys: "f t", description: "Filtro Todas las empresas" },
      { keys: "f c", description: "Filtro Críticas" },
      { keys: "f p", description: "Filtro En progreso" },
      { keys: "e", description: "Expandir / colapsar todas" },
    ],
  },
];

export function GlobalShortcutsHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignorar si el usuario está escribiendo
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

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Atajos de teclado globales"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/40 p-4 backdrop-blur-sm print:hidden"
    >
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-card-hover ring-1 ring-hairline">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-ink-900">
            <Keyboard className="h-5 w-5 text-cehta-green" strokeWidth={1.75} />
            Atajos de teclado
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100/40"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {SHORTCUTS.map((group) => (
            <div key={group.title}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                {group.title}
              </p>
              <ul className="space-y-1.5">
                {group.items.map((s) => (
                  <li
                    key={`${group.title}-${s.keys}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-ink-700">{s.description}</span>
                    <kbd className="inline-flex shrink-0 items-center gap-1 rounded-md border border-hairline bg-ink-50 px-2 py-0.5 font-mono text-[11px] text-ink-700 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                      {s.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-5 border-t border-hairline pt-3 text-[10px] text-ink-500">
          Los atajos no se activan mientras estés escribiendo en un input.
          Apretá{" "}
          <kbd className="rounded border border-hairline bg-ink-50 px-1 font-mono text-[10px]">
            Esc
          </kbd>{" "}
          para volver al teclado normal o cerrar diálogos.
        </p>
      </div>
    </div>
  );
}
