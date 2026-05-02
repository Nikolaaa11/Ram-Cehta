"use client";

/**
 * usePageShortcuts — V4 fase 7.8.
 *
 * Hook genérico para registrar atajos de teclado page-scoped. Soporta:
 *   - Tecla simple ("/", "?", "Escape")
 *   - Patrón "g + X" estilo GitHub/Linear (timeout 1.5s entre teclas)
 *
 * Auto-detecta si el usuario está escribiendo en un input/textarea/select
 * y suspende los handlers para no interferir con typing normal.
 *
 * Ejemplo:
 *   usePageShortcuts({
 *     "/": () => searchInputRef.current?.focus(),
 *     "Escape": clearFilters,
 *     "g a": () => router.push("/dashboard"),
 *   });
 */
import { useEffect } from "react";

export type ShortcutMap = Record<string, () => void>;

function isTypingInField(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function usePageShortcuts(map: ShortcutMap) {
  useEffect(() => {
    let pendingPrefix: string | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const onKey = (e: KeyboardEvent) => {
      // No interceptamos atajos del browser/OS.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const typing = isTypingInField(e.target);

      // "/" siempre se acepta para foco en search aunque el target esté vacío
      if (!typing && e.key === "/" && map["/"]) {
        e.preventDefault();
        map["/"]();
        return;
      }

      if (typing) return;

      // ¿Estamos esperando segunda tecla de un combo "X Y"?
      if (pendingPrefix !== null) {
        const combo = `${pendingPrefix} ${e.key}`;
        const handler = map[combo];
        pendingPrefix = null;
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
        }
        if (handler) {
          e.preventDefault();
          handler();
        }
        return;
      }

      // Tecla simple
      const direct = map[e.key];
      if (direct) {
        e.preventDefault();
        direct();
        return;
      }

      // ¿Es prefijo de algún combo registrado?
      const isPrefix = Object.keys(map).some((k) =>
        k.startsWith(`${e.key} `),
      );
      if (isPrefix) {
        pendingPrefix = e.key;
        if (pendingTimer) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
          pendingPrefix = null;
        }, 1500);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (pendingTimer) clearTimeout(pendingTimer);
    };
  }, [map]);
}
