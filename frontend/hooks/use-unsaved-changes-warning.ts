"use client";

/**
 * useUnsavedChangesWarning — agrega un beforeunload listener que avisa
 * al user antes de cerrar la pestana o navegar a otra URL fuera de la
 * SPA si hay cambios sin guardar.
 *
 * Limitaciones:
 *  - Los browsers modernos no permiten customizar el mensaje (siempre
 *    muestran el texto estandar tipo "Reload site?").
 *  - No intercepta navegacion interna entre rutas Next.js (eso es harder
 *    porque router.events fue removido en App Router). Para esos casos,
 *    usar un Link con onClick controlado o un Dialog explicito.
 *
 * Uso:
 *   useUnsavedChangesWarning(isDirty);
 */
import { useEffect } from "react";

export function useUnsavedChangesWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Required for legacy browsers (Chrome <= 119 etc.)
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}
