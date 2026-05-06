"use client";

import { useEffect, useState } from "react";

/**
 * useTheme — toggle dark/light mode persistente.
 *
 * Estrategia:
 *   1. Lee `localStorage.theme` al mount
 *   2. Si no está, usa `prefers-color-scheme` del OS
 *   3. Aplica/remueve `class="dark"` en `document.documentElement`
 *      → Tailwind `darkMode: 'class'` aplica los estilos `dark:*`
 *
 * Persiste en localStorage. Funciona offline, no requiere server.
 */

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "cehta-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");

  // Aplicar al mount + cuando cambie
  useEffect(() => {
    const initial = getInitialTheme();
    setThemeState(initial);
    applyTheme(initial);

    // Listener para cambios del OS (si theme === 'system')
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (getInitialTheme() === "system") applyTheme("system");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const setTheme = (next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
    applyTheme(next);
  };

  const toggle = () => {
    const root = document.documentElement;
    const currentlyDark = root.classList.contains("dark");
    setTheme(currentlyDark ? "light" : "dark");
  };

  return { theme, setTheme, toggle };
}
