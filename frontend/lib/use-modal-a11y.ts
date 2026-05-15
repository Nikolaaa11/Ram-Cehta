/**
 * useModalA11y — Round 23 QA marathon
 *
 * Hook reutilizable que agrega accesibilidad básica a modales/diálogos
 * manuales (los que no usan Radix Dialog). Pensado para drop-in en
 * componentes existentes sin reescribir su estructura JSX.
 *
 * Comportamientos:
 *  1. Focus trap: Tab / Shift+Tab queda contenido dentro del modal.
 *  2. ESC cierra (llama a `onClose`).
 *  3. Focus inicial al primer elemento focuseable cuando abre.
 *  4. Restaura el focus al elemento que tenía el foco antes de abrir.
 *  5. Bloquea scroll del body mientras está abierto.
 *
 * Uso típico:
 *
 *   const ref = useModalA11y({ open, onClose });
 *   return open ? (
 *     <div role="dialog" aria-modal="true" ref={ref}>
 *       <button>Cancelar</button>
 *       <button>Confirmar</button>
 *     </div>
 *   ) : null;
 *
 * No usa portales — se asume que el caller ya tiene su propio overlay.
 */
import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface UseModalA11yOptions {
  open: boolean;
  onClose: () => void;
  /** Si false, ESC no cierra (útil cuando hay confirm interno). Default: true. */
  closeOnEscape?: boolean;
  /** Si false, no bloquea scroll del body. Default: true. */
  lockBodyScroll?: boolean;
}

export function useModalA11y({
  open,
  onClose,
  closeOnEscape = true,
  lockBodyScroll = true,
}: UseModalA11yOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevActiveRef = useRef<HTMLElement | null>(null);

  // Effect 1 — focus inicial + restauración
  useEffect(() => {
    if (!open) return;

    // Guarda el elemento que tenía foco antes de abrir
    prevActiveRef.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;

    // Focus al primer focusable dentro del container (siguiente tick para
    // que React monte el contenido)
    const t = window.setTimeout(() => {
      const el = containerRef.current;
      if (!el) return;
      const first = el.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      first?.focus();
    }, 0);

    return () => {
      window.clearTimeout(t);
      // Restaura foco al elemento previo si todavía existe en DOM
      const prev = prevActiveRef.current;
      if (prev && typeof prev.focus === "function" && document.body.contains(prev)) {
        prev.focus();
      }
    };
  }, [open]);

  // Effect 2 — keydown: ESC + Tab trap
  useEffect(() => {
    if (!open) return;

    function handleKey(e: KeyboardEvent) {
      if (closeOnEscape && e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const el = containerRef.current;
      if (!el) return;
      const focusables = Array.from(
        el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((n) => !n.hasAttribute("disabled") && n.tabIndex !== -1);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || !el.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, [open, closeOnEscape, onClose]);

  // Effect 3 — body scroll lock
  useEffect(() => {
    if (!open || !lockBodyScroll) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open, lockBodyScroll]);

  return containerRef;
}
