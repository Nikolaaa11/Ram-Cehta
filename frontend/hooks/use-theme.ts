"use client";

import { useEffect, useState } from "react";

/**
 * useTheme — toggle dark/light mode persistente.
 *
 * V5++ ola CA fix: DEFAULT = LIGHT MODE.
 *   - Si no hay nada en localStorage → light (no más auto-dark por OS)
 *   - Solo cambia a dark si el user explícitamente lo elige
 *   - Persiste la elección en localStorage
 *
 * Razón: la plataforma está diseñada con palette Apple light-first
 * (verde Cehta sobre blanco). El dark mode forzado por OS rompía la
 * estética premium y causaba contrastes ilegibles.
 */

type Theme = "light" | "dark";

const STORAGE_KEY = "cehta-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  // R152DDDDDD — Safari en private mode lanza SecurityError al leer
  // localStorage. Sin try/catch, toda la app crasheaba al montar.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark") return "dark";
  } catch {
    // Private mode / cookies bloqueadas → defaultear a light.
  }
  return "light";
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");

  // Aplicar al mount
  useEffect(() => {
    const initial = getInitialTheme();
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  const setTheme = (next: Theme) => {
    // R152DDDDDD — try/catch defensivo: quota exceeded / private mode.
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistencia falla pero el cambio visual sigue funcionando.
    }
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
