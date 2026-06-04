"use client";

/**
 * useEventStream — conexión Server-Sent Events al endpoint
 * `GET /api/v1/stream/events`.
 *
 * Connection lifecycle:
 *   - Cuando hay sesión y el componente monta → abre EventSource.
 *   - Si la conexión se cae (network drop, server reinicia) → reconecta
 *     con backoff exponencial (1s, 2s, 4s, 8s, máximo 30s).
 *   - Cuando la sesión cambia (logout / refresh token) → tear down y reconecta.
 *   - Cuando el componente desmonta → cierra cleanly.
 *
 * Channels manejados:
 *   - notification.created → invalida `["notifications", "unread-count"]` y feed.
 *   - notification.read    → mismo (otra pestaña marcó leída).
 *   - audit.action         → invalida queries de audit list.
 *   - etl.completed        → invalida dashboards + toast info.
 *   - etl.failed           → invalida dashboards + toast error.
 *   - system.connected     → ack inicial del server.
 *   - system.heartbeat     → keepalive (no acción).
 *
 * Auth: EventSource no soporta headers custom, así que pasamos el JWT
 * como query param `?token=...`. El backend acepta ambos modos.
 *
 * SSR-safe: guardamos `typeof window !== "undefined"` antes de tocar
 * `EventSource`. En server render, el hook queda inerte.
 */

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

// Round 43 — máximo de intentos consecutivos sin haber tenido nunca un
// `onopen` exitoso. Cuando el JWT expira, EventSource se reconecta con
// el mismo token caducado y el server devuelve 401 indefinidamente
// llenando los logs cada 30s. Si después de 6 intentos seguidos no
// abrimos ni una vez, paramos y dejamos que el user refresque la página
// (el toast lo avisa una sola vez).
const MAX_FAILED_RECONNECTS_WITHOUT_OPEN = 6;

export interface LastEvent {
  type: string;
  at: number; // Date.now() del evento
}

export interface UseEventStreamResult {
  connected: boolean;
  lastEvent: LastEvent | null;
}

/**
 * useEventStream — mount global desde el layout para que cualquier página
 * se beneficie de las invalidaciones de TanStack Query en tiempo real.
 *
 * Devuelve `connected` (verde/gris en UI) y `lastEvent` (para animar el dot
 * cuando llega algo).
 */
export function useEventStream(): UseEventStreamResult {
  const { session, loading } = useSession();
  const qc = useQueryClient();

  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<LastEvent | null>(null);

  // Refs para no re-crear el EventSource en cada render.
  const esRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teardownRef = useRef(false);
  // Round 43 — flag para abandonar reconexión si nunca se abrió correctamente.
  const everOpenedRef = useRef(false);
  const stoppedRef = useRef(false);
  const stoppedToastShownRef = useRef(false);

  useEffect(() => {
    // SSR guard.
    if (typeof window === "undefined") return;
    // Esperar a que la sesión esté resuelta.
    if (loading) return;
    if (!session?.access_token) {
      // Sin sesión → asegurarse que no quede conexión abierta de antes.
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
      return;
    }

    teardownRef.current = false;
    // Round 43 — reset por cada nuevo effect run (token cambió o se restablece).
    // Si el JWT fresco SÍ funciona, el bucle de reconnect arranca limpio.
    everOpenedRef.current = false;
    stoppedRef.current = false;
    stoppedToastShownRef.current = false;
    reconnectAttemptRef.current = 0;

    // Round 105 — utility: decode JWT exp claim para detectar tokens
    // expirados client-side antes de pegarle al backend. Evita spam de
    // 401 en logs cuando el access_token vive en la sesion expirado
    // (Supabase a veces tarda en hacer el silent refresh).
    const tokenIsExpired = (jwt: string): boolean => {
      try {
        const parts = jwt.split(".");
        if (parts.length < 2 || !parts[1]) return false;
        const padded = parts[1].padEnd(
          parts[1].length + ((4 - (parts[1].length % 4)) % 4),
          "=",
        );
        const payload = JSON.parse(
          atob(padded.replace(/-/g, "+").replace(/_/g, "/")),
        );
        if (typeof payload.exp !== "number") return false;
        const now = Math.floor(Date.now() / 1000);
        // Margen de 5s para evitar race en el borde.
        return payload.exp < now - 5;
      } catch {
        return false;
      }
    };

    const connect = () => {
      if (teardownRef.current) return;

      // Round 105 — si el token guardado ya expiro, NO intentamos
      // conectar. Marcamos stopped y esperamos a que useSession refresh
      // el access_token (eso dispara el useEffect y reentra a connect()).
      if (tokenIsExpired(session.access_token)) {
        stoppedRef.current = true;
        setConnected(false);
        return;
      }

      // Cleanup previo (paranoia — si reconnect se dispara con uno abierto).
      esRef.current?.close();

      const url =
        `${API_BASE}/stream/events?token=` +
        encodeURIComponent(session.access_token);
      let es: EventSource;
      try {
        es = new EventSource(url);
      } catch (err) {
        // Algunos browsers viejos pueden tirar al construir. Fallback: log y
        // reintenta con backoff.
        console.warn("[sse] EventSource construct failed", err);
        scheduleReconnect();
        return;
      }
      esRef.current = es;

      es.onopen = () => {
        setConnected(true);
        reconnectAttemptRef.current = 0;
        // Round 43 — vimos al menos una conexión OK; futuros errores
        // serán tratados como cortes normales (reconectar con backoff).
        everOpenedRef.current = true;
      };

      // El evento default cubre frames `data:` sin `event:` propio. El
      // backend siempre setea `event:` (ver app/api/v1/stream.py), así
      // que registramos handlers explícitos por canal.

      const handle = (channel: string, raw: string) => {
        let data: unknown = null;
        try {
          data = JSON.parse(raw);
        } catch {
          // Algunos channels (system.connected) mandan JSON simple — si parsea mal,
          // no rompemos el handler, solo dejamos pasar el ping con data=null.
        }
        setLastEvent({ type: channel, at: Date.now() });

        switch (channel) {
          case "notification.created":
          case "notification.read":
            qc.invalidateQueries({ queryKey: ["notifications"] });
            break;
          case "audit.action":
            qc.invalidateQueries({ queryKey: ["audit"] });
            break;
          case "etl.completed": {
            qc.invalidateQueries({ queryKey: ["dashboard"] });
            qc.invalidateQueries({ queryKey: ["ceo"] });
            qc.invalidateQueries({ queryKey: ["etl"] });
            const d = data as
              | {
                  status?: string;
                  rows_loaded?: number;
                  rows_rejected?: number;
                }
              | null;
            const summary = d
              ? `${d.rows_loaded ?? 0} filas cargadas` +
                (d.rows_rejected ? `, ${d.rows_rejected} rechazadas` : "")
              : "ETL completado";
            toast.success("ETL completado", { description: summary });
            break;
          }
          case "etl.failed": {
            qc.invalidateQueries({ queryKey: ["etl"] });
            const d = data as { error_message?: string } | null;
            toast.error("ETL falló", {
              description: d?.error_message ?? "Revisa /admin/etl",
            });
            break;
          }
          case "mailbox.received": {
            // Email nuevo — invalidar lista + status (badge sidebar)
            qc.invalidateQueries({ queryKey: ["mailbox"] });
            const d = data as { from_email?: string; subject?: string } | null;
            if (d?.subject) {
              toast.info("Email nuevo en inbox", {
                description: `${d.from_email} · ${d.subject.slice(0, 60)}`,
              });
            }
            break;
          }
          case "mailbox.classified": {
            // Email clasificado — refresh detalle si el user lo está viendo
            qc.invalidateQueries({ queryKey: ["mailbox"] });
            qc.invalidateQueries({ queryKey: ["mailbox-detail"] });
            break;
          }
          case "system.connected":
          case "system.heartbeat":
          default:
            // No-op — solo actualizamos lastEvent (ya lo hicimos arriba).
            break;
        }
      };

      const channels = [
        "notification.created",
        "notification.read",
        "audit.action",
        "etl.completed",
        "etl.failed",
        "mailbox.received",
        "mailbox.classified",
        "system.connected",
        "system.heartbeat",
      ] as const;
      for (const ch of channels) {
        es.addEventListener(ch, (evt: MessageEvent) => handle(ch, evt.data));
      }

      es.onerror = () => {
        // EventSource intenta reconectar automáticamente, pero en caso de
        // 401 / 5xx persistente puede quedar en CLOSED. Cerramos manualmente
        // y reintentamos con backoff propio para tener control.
        setConnected(false);
        es.close();
        if (esRef.current === es) {
          esRef.current = null;
        }
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (teardownRef.current) return;
      // Round 43 — si nunca abrimos y ya intentamos N veces, asumimos JWT
      // expirado/inválido y abandonamos. Evita spam de 401 cada 30s en logs.
      if (
        !everOpenedRef.current &&
        reconnectAttemptRef.current >= MAX_FAILED_RECONNECTS_WITHOUT_OPEN
      ) {
        stoppedRef.current = true;
        if (!stoppedToastShownRef.current) {
          stoppedToastShownRef.current = true;
          toast.error(
            "Conexión en tiempo real perdida — actualizá la página para reconectar",
            { duration: 10_000 },
          );
        }
        return;
      }
      const idx = Math.min(
        reconnectAttemptRef.current,
        RECONNECT_BACKOFF_MS.length - 1,
      );
      const delay = RECONNECT_BACKOFF_MS[idx];
      reconnectAttemptRef.current += 1;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = setTimeout(() => {
        if (stoppedRef.current) return;
        connect();
      }, delay);
    };

    connect();

    return () => {
      teardownRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
    };
    // Reconectar cuando cambia el access_token (refresh) o termina el loading.
    // session.access_token cubre ambos casos: si rota el token, abrimos nueva
    // conexión con el JWT fresco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session?.access_token]);

  return { connected, lastEvent };
}
