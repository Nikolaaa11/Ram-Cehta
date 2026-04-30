"use client";

/**
 * RealtimeIndicator — dot pequeño que refleja el estado del SSE stream.
 *
 *   verde sólido    → conectado, sin actividad reciente
 *   verde con pulse → llegó un evento en los últimos 1.5s
 *   gris            → desconectado / reconectando
 *
 * Diseñado para ir en el sidebar/header al lado del email del usuario o de
 * la campana de notificaciones. Tiene `aria-live` para accesibilidad pero
 * en práctica el dot es decorativo — el estado lo aprovecha el flujo
 * normal de queries que se invalidan al recibir eventos.
 */

import { useEffect, useState } from "react";
import { useEventStream } from "@/hooks/use-event-stream";
import { cn } from "@/lib/utils";

const PULSE_DURATION_MS = 1500;

export function RealtimeIndicator() {
  const { connected, lastEvent } = useEventStream();
  const [pulsing, setPulsing] = useState(false);

  // Cuando llega un evento, animamos el dot por 1.5s.
  useEffect(() => {
    if (!lastEvent) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), PULSE_DURATION_MS);
    return () => clearTimeout(t);
  }, [lastEvent]);

  const label = connected
    ? pulsing
      ? `Tiempo real: evento ${lastEvent?.type}`
      : "Tiempo real: conectado"
    : "Tiempo real: desconectado";

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      title={label}
      className="inline-flex h-2 w-2 items-center justify-center"
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full transition-colors duration-200",
          connected ? "bg-positive" : "bg-ink-300",
          pulsing && connected && "animate-ping",
        )}
      />
      {pulsing && connected && (
        // Dot sólido de fondo mientras animate-ping ya está corriendo arriba —
        // así nunca queda invisible mientras pulsa.
        <span className="absolute h-2 w-2 rounded-full bg-positive" />
      )}
    </span>
  );
}
