"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * useKeyboardShortcuts — atajos globales tipo Vim/Notion.
 *
 * Atajos:
 *   - g d   → /dashboard
 *   - g p   → /mis-pendientes (V5++ ola AW)
 *   - g v   → /vouchers
 *   - g e   → /admin/empresas
 *   - g i   → /admin/mailbox (Inbox)
 *   - g f   → /f29
 *   - g t   → /f22 (tax 22)
 *   - g c   → /admin/cartolas-runs
 *   - g b   → /admin/bitacora (V5++ ola AW)
 *   - g a   → /admin
 *   - g o   → /ordenes-compra
 *   - g r   → /reportes
 *   - ?     → Mostrar overlay con todos los shortcuts (futuro)
 *   - /     → Focus search palette
 *
 * Se registra una sola vez en el layout. Detecta combos secuenciales
 * (ej: "g" → "v" en <500ms = ir a /vouchers).
 *
 * Skipea cuando el user está tipeando en input/textarea/contentEditable.
 */
export function useKeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    let firstKey: string | null = null;
    let firstKeyTimer: ReturnType<typeof setTimeout> | null = null;

    const isTyping = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.tagName === "INPUT") return true;
      if (target.tagName === "TEXTAREA") return true;
      if (target.tagName === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignorar si modificadores típicos de browser (Ctrl/Cmd) están activos.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;

      const key = e.key.toLowerCase();

      // Single-key shortcuts
      if (firstKey === null) {
        if (key === "/") {
          // Focus en search palette si existe
          e.preventDefault();
          const palette = document.querySelector<HTMLInputElement>(
            'input[type="search"], input[placeholder*="Buscar"]',
          );
          if (palette) {
            palette.focus();
          } else {
            // Disparar evento custom para que CommandPalette se abra
            window.dispatchEvent(new CustomEvent("open-command-palette"));
          }
          return;
        }
        if (key === "g") {
          firstKey = "g";
          firstKeyTimer = setTimeout(() => {
            firstKey = null;
          }, 800);
          return;
        }
        return;
      }

      // Two-key combos (g + X)
      if (firstKey === "g") {
        if (firstKeyTimer) clearTimeout(firstKeyTimer);
        firstKey = null;
        const routes: Record<string, string> = {
          d: "/dashboard",
          p: "/mis-pendientes",     // V5++ ola AW
          v: "/vouchers",
          e: "/admin/empresas",
          i: "/admin/mailbox",
          f: "/f29",
          t: "/f22",
          c: "/admin/cartolas-runs",
          b: "/admin/bitacora",     // V5++ ola AW
          a: "/admin",
          o: "/ordenes-compra",
          r: "/reportes",
        };
        const target = routes[key];
        if (target) {
          e.preventDefault();
          router.push(target as never);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (firstKeyTimer) clearTimeout(firstKeyTimer);
    };
  }, [router]);
}
