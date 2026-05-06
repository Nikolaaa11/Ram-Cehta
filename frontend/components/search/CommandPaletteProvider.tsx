"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

/**
 * Mounta el palette globalmente y escucha el atajo Cmd/Ctrl + K.
 *
 * V5++ perf: lazy load del CommandPalette con dynamic import. Solo se
 * descarga el bundle (~80KB con búsqueda + lucide icons) cuando el user
 * efectivamente abre el palette por primera vez. Sin esto, el chunk
 * estaba en el initial bundle de cada page → +80KB en TTI.
 *
 * También escucha el evento custom `open-command-palette` para que el
 * keyboard hook (gd/gv/etc. shortcuts) lo abra con `/` sin necesitar Cmd+K.
 */
const CommandPalette = dynamic(
  () => import("./CommandPalette").then((m) => m.CommandPalette),
  {
    ssr: false,
    loading: () => null,
  },
);

export function CommandPaletteProvider() {
  const [open, setOpen] = useState(false);
  // Solo cargamos el componente lazy una vez que el user lo abre por primera vez.
  // Después se queda montado para reutilizar el bundle ya descargado.
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK =
        (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setOpen((o) => !o);
        setHasOpenedOnce(true);
      }
    };
    const onCustomOpen = () => {
      setOpen(true);
      setHasOpenedOnce(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onCustomOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onCustomOpen);
    };
  }, []);

  if (!hasOpenedOnce) return null;
  return <CommandPalette open={open} onClose={() => setOpen(false)} />;
}
