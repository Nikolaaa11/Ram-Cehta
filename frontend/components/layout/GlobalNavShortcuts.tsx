"use client";

/**
 * GlobalNavShortcuts — V4 fase 7.14.
 *
 * Registra atajos globales de navegación tipo "g + tecla" estilo
 * GitHub/Linear:
 *   - g d → Dashboard
 *   - g c → Calendario
 *   - g e → Entregables
 *   - g r → Reportes
 *   - g a → Asistente AI
 *   - g p → Compliance
 *
 * Wait window: 1.5s entre `g` y la segunda tecla, después se cancela.
 *
 * No interfiere con la `g` que escribe el usuario en inputs (auto-detect
 * via target.tagName).
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const NAV_MAP: Record<string, string> = {
  d: "/dashboard",
  c: "/calendario",
  e: "/entregables",
  r: "/reportes",
  a: "/asistente",
  p: "/compliance",
};

export function GlobalNavShortcuts() {
  const router = useRouter();

  useEffect(() => {
    let pendingG = false;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (isTyping) return;

      if (pendingG) {
        const dest = NAV_MAP[e.key];
        if (dest) {
          e.preventDefault();
          router.push(dest as never);
        }
        pendingG = false;
        if (pendingTimer) clearTimeout(pendingTimer);
        return;
      }

      if (e.key === "g") {
        pendingG = true;
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
          pendingG = false;
        }, 1500);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (pendingTimer) clearTimeout(pendingTimer);
    };
  }, [router]);

  return null;
}
