"use client";

/**
 * RealtimeProvider — wrapper que monta el hook `useEventStream` globalmente.
 *
 * Se monta una sola vez en el layout autenticado `(app)/layout.tsx`. El
 * hook hace todo el trabajo (conexión SSE, reconnect, dispatching de
 * invalidaciones de TanStack Query). Este componente sólo es el cascarón
 * client-component.
 *
 * Para mostrar el dot de estado en el sidebar / header, importar
 * `<RealtimeIndicator />` directamente — usa el mismo hook (que es
 * idempotente: múltiples montajes comparten el mismo singleton de
 * EventSource via TanStack Query observers).
 *
 * Nota: el hook es safe to mount múltiples veces en el árbol — cada uno
 * abriría su propia conexión, lo cual no es ideal pero tampoco rompe
 * nada (el broadcaster soporta múltiples queues por user). Mantenelo
 * montado UNA VEZ a nivel layout y eso alcanza.
 */

import { useEventStream } from "@/hooks/use-event-stream";

export function RealtimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Llamamos al hook por su side-effect (conexión SSE).
  useEventStream();
  return <>{children}</>;
}
