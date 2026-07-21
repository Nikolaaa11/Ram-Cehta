"use client";

/**
 * useSession — sesión Supabase compartida.
 *
 * MEGAPROMPT PERF: reescrito con store a nivel de módulo +
 * useSyncExternalStore. Antes cada componente que llamaba useSession()
 * (~269 call sites) creaba SU PROPIO useEffect + getSession() +
 * onAuthStateChange listener. Ahora hay UN solo listener global; cada
 * hook solo se suscribe al snapshot compartido.
 *
 * La API pública ({ session, loading }) es idéntica — cero cambios en
 * los consumidores.
 */
import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

interface SessionSnapshot {
  session: Session | null;
  loading: boolean;
}

// ── Store a nivel de módulo (una sola instancia por tab) ───────────────
let snapshot: SessionSnapshot = { session: null, loading: true };
const listeners = new Set<() => void>();
let initialized = false;

function emit(next: SessionSnapshot) {
  snapshot = next;
  listeners.forEach((l) => l());
}

function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const supabase = createClient();

  supabase.auth.getSession().then(({ data: { session } }) => {
    // onAuthStateChange puede haber llegado antes — no pisar con null.
    if (snapshot.loading) emit({ session, loading: false });
  });

  // Listener global único — vive lo que vive el tab; no se desuscribe
  // (el store es un singleton de módulo, no hay unmount).
  supabase.auth.onAuthStateChange((_event, session) => {
    emit({ session, loading: false });
  });
}

function subscribe(listener: () => void) {
  ensureInitialized();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SessionSnapshot {
  return snapshot;
}

// Server render: sin sesión, cargando (igual que el estado inicial previo).
const SERVER_SNAPSHOT: SessionSnapshot = { session: null, loading: true };
function getServerSnapshot(): SessionSnapshot {
  return SERVER_SNAPSHOT;
}

export function useSession() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
