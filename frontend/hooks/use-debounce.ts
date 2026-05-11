"use client";

/**
 * V5++ ola AS — useDebounce hook.
 *
 * Demora la actualización de un valor hasta que pasa N ms sin cambios.
 * Crítico para campos de búsqueda — evita hacer una request por cada
 * keystroke.
 *
 * Uso típico:
 *   const [search, setSearch] = useState("");
 *   const debouncedSearch = useDebounce(search, 300);
 *
 *   useQuery(['vouchers', debouncedSearch], () => fetch(...));
 *
 * Con debounce 300ms, escribir "vouchers" (8 letras) genera 1 request
 * en vez de 8.
 */
import { useEffect, useState } from "react";

export function useDebounce<T>(value: T, delayMs: number = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/**
 * Variante para callbacks: devuelve una versión "debounceada" de un fn.
 *
 * Uso:
 *   const handleSearch = useDebouncedCallback((q: string) => {
 *     apiCall(q);
 *   }, 300);
 */
export function useDebouncedCallback<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  delayMs: number = 300,
): (...args: TArgs) => void {
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [timer]);

  return (...args: TArgs) => {
    if (timer) clearTimeout(timer);
    const newTimer = setTimeout(() => callback(...args), delayMs);
    setTimer(newTimer);
  };
}
