"use client";

/**
 * useFormAutosave — persiste el estado de un form en localStorage para
 * que si el usuario cierra la pestana o pierde la conexion, al volver
 * encuentre lo que estaba tipeando.
 *
 * Patron de uso:
 *   const { restored, clear, hasSaved } = useFormAutosave(
 *     "voucher-nubox-draft",
 *     { rut, nombre, ... },
 *     { onRestore: (saved) => apply(saved) },
 *   );
 *   ...
 *   await submitForm();
 *   clear(); // borra el draft al guardarse exitosamente
 *
 * Detalles:
 *  - Debounce: escribimos cada 800ms para no saturar localStorage.
 *  - Versionado: si el shape del state cambia entre versiones de la app,
 *    bumpa la `version` y los drafts viejos se ignoran (no se restauran).
 *  - SSR-safe: chequea typeof window.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_PREFIX = "cehta:draft:";
const DEBOUNCE_MS = 800;

interface AutosaveOptions<T> {
  /** Bump this when the shape of T changes incompatibly. Default 1. */
  version?: number;
  /** Callback invoked once on mount if there's a saved draft. */
  onRestore?: (saved: T) => void;
  /** If true, do not autosave (useful while initializing the form). */
  disabled?: boolean;
}

interface StoredDraft<T> {
  v: number;
  ts: number;
  data: T;
}

export function useFormAutosave<T>(
  key: string,
  state: T,
  options: AutosaveOptions<T> = {},
): { restored: T | null; clear: () => void; hasSaved: boolean } {
  const { version = 1, onRestore, disabled = false } = options;
  const fullKey = STORAGE_PREFIX + key;
  const restoredRef = useRef(false);
  const [restored, setRestored] = useState<T | null>(null);
  const [hasSaved, setHasSaved] = useState(false);

  // Restore once on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(fullKey);
      if (!raw) return;
      const parsed: StoredDraft<T> = JSON.parse(raw);
      if (parsed.v !== version) {
        window.localStorage.removeItem(fullKey);
        return;
      }
      setRestored(parsed.data);
      setHasSaved(true);
      onRestore?.(parsed.data);
    } catch {
      // ignore parse errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save (debounced) on every state change
  useEffect(() => {
    if (disabled) return;
    if (typeof window === "undefined") return;
    const handle = setTimeout(() => {
      try {
        const payload: StoredDraft<T> = {
          v: version,
          ts: Date.now(),
          data: state,
        };
        window.localStorage.setItem(fullKey, JSON.stringify(payload));
        setHasSaved(true);
      } catch {
        // QuotaExceededError u otros — ignoramos silenciosamente.
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [state, fullKey, version, disabled]);

  const clear = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(fullKey);
      setHasSaved(false);
    } catch {
      // ignore
    }
  }, [fullKey]);

  return { restored, clear, hasSaved };
}
