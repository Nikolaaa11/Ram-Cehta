"use client";

/**
 * V4 fase 4 — botón "Volver a ver el tour".
 *
 * Resetea la preferencia `onboarding_tour` a `{completed: false, current_step: 0}`
 * y monta el tour para que arranque desde el primer step.
 *
 * Pensado para vivir en `/2fa` (página de configuración del user) — el
 * lugar más natural para "settings que afectan tu experiencia".
 */

import { useState } from "react";
import { PlayCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTourState } from "@/hooks/use-user-preferences";
import { OnboardingTour } from "./OnboardingTour";

export function ReplayTourButton() {
  const { setState, isPending } = useTourState();
  const [showTour, setShowTour] = useState(false);

  const handleReplay = async () => {
    try {
      await setState({ completed: false, current_step: 0 });
      setShowTour(true);
      toast.success("Tour reiniciado");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo reiniciar el tour",
      );
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleReplay}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : (
          <PlayCircle className="h-4 w-4" strokeWidth={1.75} />
        )}
        Volver a ver el tour
      </button>
      {showTour && (
        <OnboardingTour
          forceOpen
          onClose={() => setShowTour(false)}
        />
      )}
    </>
  );
}
