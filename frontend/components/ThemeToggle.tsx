"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { useEffect, useState } from "react";

/**
 * ThemeToggle — botón para alternar dark/light.
 *
 * Se renderea con un placeholder durante SSR (theme=system) y se hidrata
 * en client. Esto evita FOUC (flash of unstyled content) que se ve fea
 * cuando el theme del OS y el guardado en localStorage difieren.
 */
export function ThemeToggle() {
  const { toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDark(document.documentElement.classList.contains("dark"));

    // Re-leer cuando cambie (otro tab puede cambiar localStorage)
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  if (!mounted) {
    // Placeholder neutral mientras hidrata
    return (
      <button
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-500"
        aria-label="Cambiar tema"
      >
        <Sun className="h-4 w-4" strokeWidth={1.5} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
      aria-label={isDark ? "Activar modo claro" : "Activar modo oscuro"}
      title={isDark ? "Modo claro" : "Modo oscuro"}
    >
      {isDark ? (
        <Sun className="h-4 w-4" strokeWidth={1.5} />
      ) : (
        <Moon className="h-4 w-4" strokeWidth={1.5} />
      )}
    </button>
  );
}
