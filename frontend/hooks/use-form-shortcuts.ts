"use client";

/**
 * useFormShortcuts — atajos de teclado para formularios largos.
 *
 * Diferente de useKeyboardShortcuts (navegacion Vim g+X global), este se
 * registra dentro de una pagina con form y maneja combinaciones con
 * modificador (Ctrl/Cmd) que SI funcionan mientras el foco esta en inputs.
 *
 * Recibe un mapa { "mod+s": handler, "mod+enter": handler, "esc": handler }:
 *  - "mod" = Cmd en Mac, Ctrl en Win/Linux.
 *  - Las teclas se separan con "+".
 *  - Handler recibe el KeyboardEvent — llama preventDefault() si querés
 *    bloquear el default del browser (ej: bloquear el "guardar pagina"
 *    de Ctrl+S).
 *
 * Uso:
 *   useFormShortcuts({
 *     "mod+s": (e) => { e.preventDefault(); submit(); },
 *     "mod+enter": (e) => { e.preventDefault(); addLine(); },
 *     "esc": () => router.back(),
 *   });
 */
import { useEffect } from "react";

type Handler = (e: KeyboardEvent) => void;
type Shortcuts = Record<string, Handler>;

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform);
}

function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+").map((p) => p.trim());
  const expectMod = parts.includes("mod");
  const expectShift = parts.includes("shift");
  const expectAlt = parts.includes("alt");
  const key = parts.filter(
    (p) => !["mod", "shift", "alt", "ctrl", "meta"].includes(p),
  )[0];

  const modPressed = isMac() ? e.metaKey : e.ctrlKey;
  if (expectMod && !modPressed) return false;
  if (!expectMod && modPressed) return false;
  if (expectShift !== e.shiftKey) return false;
  if (expectAlt !== e.altKey) return false;
  if (!key) return false;
  return e.key.toLowerCase() === key.toLowerCase();
}

export function useFormShortcuts(shortcuts: Shortcuts): void {
  useEffect(() => {
    function listener(e: KeyboardEvent) {
      for (const [combo, handler] of Object.entries(shortcuts)) {
        if (matches(e, combo)) {
          handler(e);
          return;
        }
      }
    }
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [shortcuts]);
}
