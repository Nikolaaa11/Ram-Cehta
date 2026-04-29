"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

/**
 * Wrapper responsive que envuelve el sidebar + main content del layout
 * autenticado. Lógica:
 *
 * - Desktop (md+): comportamiento actual — sidebar fijo a la izquierda,
 *   main content al lado, sin cambios.
 * - Mobile (<md): sidebar oculto por default; un header pegajoso con
 *   hamburger lo abre como drawer overlay con backdrop blur. Click en
 *   un link o en el backdrop lo cierra.
 *
 * Implementado como wrapper externo para no tocar `AppSidebar` (que es
 * propiedad concurrente de varios agentes). El sidebar interno no
 * necesita saber nada del modo mobile.
 */
interface Props {
  sidebar: ReactNode;
  children: ReactNode;
  brandLabel?: string;
}

export function MobileLayoutShell({
  sidebar,
  children,
  brandLabel = "Cehta Capital",
}: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Cerrar el drawer cuando el usuario navega a otra ruta
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Bloquear scroll del body cuando el drawer está abierto
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Cerrar con tecla Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex min-h-screen bg-surface-muted">
      {/* Header mobile (sticky top, sólo visible en pantallas <md) */}
      <header className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center gap-3 border-b border-hairline bg-white/95 px-4 backdrop-blur-md md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menú"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-700 transition-colors duration-150 ease-apple hover:bg-ink-100/40"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <p className="text-sm font-semibold tracking-tight text-ink-900">
          {brandLabel}
        </p>
      </header>

      {/* Sidebar desktop (md+ visible siempre) */}
      <div className="hidden md:flex">{sidebar}</div>

      {/* Sidebar mobile (drawer overlay) */}
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-50 bg-ink-900/30 backdrop-blur-sm md:hidden"
            aria-hidden="true"
          />
          <div
            className="fixed inset-y-0 left-0 z-50 flex transition-transform duration-200 ease-apple md:hidden"
            style={{ transform: "translateX(0)" }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar menú"
              className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/80 text-ink-700 shadow-card backdrop-blur transition-colors duration-150 ease-apple hover:bg-white"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
            {sidebar}
          </div>
        </>
      )}

      {/* Main content — padding-top en mobile para que no choque con el header sticky */}
      <main className="flex-1 overflow-auto p-4 pt-[4.5rem] md:p-8 md:pt-8">
        {children}
      </main>
    </div>
  );
}
