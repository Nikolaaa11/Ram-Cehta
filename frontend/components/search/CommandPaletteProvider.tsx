"use client";

import { useEffect, useState } from "react";
import { CommandPalette } from "./CommandPalette";

/**
 * Mounta el palette globalmente y escucha el atajo Cmd/Ctrl + K.
 * Se monta una sola vez en el layout `(app)` para que cualquier ruta lo dispare.
 */
export function CommandPaletteProvider() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK =
        (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <CommandPalette open={open} onClose={() => setOpen(false)} />;
}
