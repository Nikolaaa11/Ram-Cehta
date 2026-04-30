"use client";

/**
 * V4 fase 4 — onboarding tour for first-time users.
 *
 * Wrapper que monta el tour SOLO si:
 *  - El user está autenticado.
 *  - El backend ya respondió con la preferencia (no flicker durante load).
 *  - El tour NO está marcado como completado.
 *
 * Si todas las condiciones se cumplen, el primer step (Bienvenida — center
 * modal) se muestra automáticamente en el primer render.
 */

import { useTourState } from "@/hooks/use-user-preferences";
import { OnboardingTour } from "./OnboardingTour";

export function TourTrigger() {
  const { isLoading, state } = useTourState();

  // Mientras se está cargando la preferencia, NO mostramos nada — evita
  // que el tour flickee para users que ya lo completaron.
  if (isLoading) return null;
  // Si ya completó, no renderizamos.
  if (state.completed) return null;

  return <OnboardingTour />;
}
