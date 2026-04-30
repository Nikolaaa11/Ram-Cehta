"use client";

/**
 * V4 fase 4 — onboarding tour for first-time users.
 *
 * 5-step interactive walkthrough con spotlight overlay (cutout sobre el
 * target via box-shadow gigante). Persiste progreso en
 * `app.user_preferences.onboarding_tour` via `useTourState`.
 *
 * Características:
 *  - Skippable: cada step tiene "Skip tour" → marca completed=true.
 *  - Resilient: si el target selector no matchea (e.g. user con rol que no
 *    ve la entrada del sidebar), salta el step automáticamente.
 *  - Mobile-aware: en <md, usa una bottom-sheet en vez de tooltip floating.
 *  - Final step navega a /action-center.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOUR_TOTAL_STEPS, useTourState } from "@/hooks/use-user-preferences";

type TooltipPosition = "top" | "bottom" | "left" | "right" | "center";

interface TourStep {
  id: string;
  /** CSS selector del target. `null` para center modal. */
  target: string | null;
  title: string;
  body: string;
  position: TooltipPosition;
  ctaLabel?: string;
}

const STEPS: TourStep[] = [
  {
    id: "welcome",
    target: null,
    title: "Bienvenido a Cehta Capital",
    body:
      "Te muestro los 5 atajos más útiles en menos de 1 minuto. Podés saltarlo en cualquier momento.",
    position: "center",
    ctaLabel: "Empezar",
  },
  {
    id: "cmdk",
    target: "body",
    title: "Búsqueda global",
    body:
      "Apretá Ctrl+K (o Cmd+K en Mac) para abrir la búsqueda global desde cualquier página. Cerrala con Esc.",
    position: "center",
  },
  {
    id: "action-center",
    target: '[data-tour="action-center"]',
    title: "Action Center",
    body:
      "Tu inbox-zero diario: F29 vencidas, OCs pendientes, contratos por renovar. Todo lo que requiere tu atención hoy.",
    position: "right",
  },
  {
    id: "notifications-bell",
    target: '[data-tour="notifications-bell"]',
    title: "Bell de notificaciones",
    body:
      "Acá te llegan alertas en tiempo real: nuevas OCs, F29 procesadas, mentions y más.",
    position: "bottom",
  },
  {
    id: "asistente",
    target: '[data-tour="asistente"]',
    title: "Asistente AI",
    body:
      "Preguntale lo que sea sobre tus empresas. Por ejemplo: \"¿Cuál fue el saldo de CENERGY en marzo?\"",
    position: "right",
  },
];

const TOOLTIP_WIDTH = 340;
const TOOLTIP_GAP = 16; // separación entre target y tooltip
const SPOTLIGHT_PADDING = 8; // halo alrededor del target

interface ResolvedTarget {
  /** El elemento DOM, o null si no encontrado / step sin target. */
  el: HTMLElement | null;
  rect: DOMRect | null;
}

function resolveTarget(selector: string | null): ResolvedTarget {
  if (!selector || typeof document === "undefined") {
    return { el: null, rect: null };
  }
  if (selector === "body") {
    return { el: document.body, rect: null };
  }
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return { el: null, rect: null };
  return { el, rect: el.getBoundingClientRect() };
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isMobile;
}

export interface OnboardingTourProps {
  /** Forzar visible — útil para "Volver a ver el tour". */
  forceOpen?: boolean;
  /** Callback cuando el tour termina (skip o complete). */
  onClose?: () => void;
}

export function OnboardingTour({ forceOpen, onClose }: OnboardingTourProps) {
  const { state, setState, isLoading } = useTourState();
  const router = useRouter();
  const isMobile = useIsMobile();
  // Re-render cuando la window se redimensiona (para reposicionar tooltip).
  const [, setTick] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Decide si el tour está abierto: forceOpen, o (no completed && cargado).
  const open = forceOpen || (!isLoading && !state.completed);
  const stepIndex = Math.min(
    Math.max(state.current_step, 0),
    STEPS.length - 1,
  );
  const step = STEPS[stepIndex];

  const close = useCallback(
    async (markCompleted: boolean) => {
      try {
        await setState({
          completed: markCompleted,
          current_step: markCompleted ? STEPS.length : stepIndex,
        });
      } catch {
        // Si el PUT falla (e.g. backend caído), no bloqueamos al user — el
        // tour se cierra igual a nivel UI; el próximo refresh va a re-disparar
        // pero al menos no quedó un overlay infinito.
      }
      onClose?.();
    },
    [setState, stepIndex, onClose],
  );

  const next = useCallback(async () => {
    const isLast = stepIndex >= STEPS.length - 1;
    if (isLast) {
      await close(true);
      // Navegamos al Action Center como CTA final.
      router.push("/action-center");
      return;
    }
    try {
      await setState({
        completed: false,
        current_step: stepIndex + 1,
      });
    } catch {
      // Falla silenciosa — el siguiente render va a quedar en el step actual.
    }
  }, [stepIndex, close, setState, router]);

  // Reposicionar tooltip al resize/scroll.
  useEffect(() => {
    if (!open) return;
    const tick = () => setTick((t) => t + 1);
    window.addEventListener("resize", tick);
    window.addEventListener("scroll", tick, true);
    return () => {
      window.removeEventListener("resize", tick);
      window.removeEventListener("scroll", tick, true);
    };
  }, [open]);

  // Skip step si el target no existe.
  useEffect(() => {
    if (!open || !step) return;
    if (step.target === null || step.target === "body") return;
    const found = document.querySelector(step.target);
    if (!found) {
      // Auto-avanzar al siguiente step. Si era el último, marcar completed.
      if (stepIndex >= STEPS.length - 1) {
        void close(true);
      } else {
        void setState({ completed: false, current_step: stepIndex + 1 });
      }
    }
    // Solo correr cuando cambia el step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, open]);

  // Esc cierra el tour (skip).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void close(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const target = useMemo<ResolvedTarget>(
    () => (step ? resolveTarget(step.target) : { el: null, rect: null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step?.target, open],
  );

  if (!open || !step) return null;

  const hasSpotlight =
    !isMobile &&
    target.el !== null &&
    target.el !== document.body &&
    target.rect !== null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={step.title}
      className="fixed inset-0 z-[100]"
    >
      {/* Overlay con cutout para el spotlight (si aplica). */}
      <SpotlightOverlay rect={hasSpotlight ? target.rect : null} />

      {/* Tooltip / bottom-sheet con el contenido. */}
      {isMobile ? (
        <BottomSheet
          step={step}
          stepIndex={stepIndex}
          onNext={next}
          onSkip={() => void close(true)}
        />
      ) : (
        <FloatingTooltip
          step={step}
          stepIndex={stepIndex}
          targetRect={target.rect}
          onNext={next}
          onSkip={() => void close(true)}
        />
      )}
    </div>
  );
}

/**
 * Overlay con un agujero (spotlight) sobre el target. Si `rect` es null,
 * renderea un overlay full-screen oscuro normal.
 */
function SpotlightOverlay({ rect }: { rect: DOMRect | null }) {
  if (!rect) {
    return (
      <div
        aria-hidden
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
    );
  }
  // Box con fondo transparente + box-shadow gigante para crear el "cutout".
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute rounded-2xl ring-2 ring-cehta-green/70 transition-all duration-200 ease-apple"
      style={{
        top: rect.top - SPOTLIGHT_PADDING,
        left: rect.left - SPOTLIGHT_PADDING,
        width: rect.width + SPOTLIGHT_PADDING * 2,
        height: rect.height + SPOTLIGHT_PADDING * 2,
        boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
      }}
    />
  );
}

interface StepCardProps {
  step: TourStep;
  stepIndex: number;
  onNext: () => void;
  onSkip: () => void;
}

function StepBadge({ stepIndex }: { stepIndex: number }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-300">
      Paso {stepIndex + 1} de {TOUR_TOTAL_STEPS}
    </p>
  );
}

function StepActions({ step, stepIndex, onNext, onSkip }: StepCardProps) {
  const isLast = stepIndex >= STEPS.length - 1;
  const ctaLabel = step.ctaLabel ?? (isLast ? "Ir al Action Center" : "Próximo");
  return (
    <div className="mt-5 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onSkip}
        className="text-xs text-ink-500 underline underline-offset-2 hover:text-ink-700"
      >
        Skip tour
      </button>
      <button
        type="button"
        onClick={onNext}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2",
          "text-sm font-medium text-white shadow-sm",
          "transition-all duration-150 ease-apple hover:bg-cehta-green-700",
        )}
      >
        {ctaLabel}
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

function FloatingTooltip({
  step,
  stepIndex,
  targetRect,
  onNext,
  onSkip,
}: StepCardProps & { targetRect: DOMRect | null }) {
  const pos = computeTooltipPos(step.position, targetRect);
  return (
    <div
      style={pos.style}
      className={cn(
        "absolute w-[340px] max-w-[calc(100vw-32px)] rounded-2xl bg-white shadow-glass",
        "ring-1 ring-hairline p-5",
        "animate-in fade-in zoom-in-95 duration-200",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-cehta-green/15">
            <Sparkles className="h-3.5 w-3.5 text-cehta-green" strokeWidth={1.75} />
          </span>
          <StepBadge stepIndex={stepIndex} />
        </div>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Saltar tour"
          className="rounded-lg p-1 text-ink-500 hover:bg-ink-50 hover:text-ink-700"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      <h3 className="mt-3 font-display text-base font-semibold tracking-tight text-ink-900">
        {step.title}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{step.body}</p>
      <StepActions step={step} stepIndex={stepIndex} onNext={onNext} onSkip={onSkip} />
    </div>
  );
}

function BottomSheet({ step, stepIndex, onNext, onSkip }: StepCardProps) {
  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-5 shadow-glass ring-1 ring-hairline",
        "animate-in slide-in-from-bottom duration-300",
      )}
    >
      <div
        aria-hidden
        className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-100"
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-cehta-green/15">
            <Sparkles className="h-3.5 w-3.5 text-cehta-green" strokeWidth={1.75} />
          </span>
          <StepBadge stepIndex={stepIndex} />
        </div>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Saltar tour"
          className="rounded-lg p-1 text-ink-500 hover:bg-ink-50 hover:text-ink-700"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      <h3 className="mt-3 font-display text-lg font-semibold tracking-tight text-ink-900">
        {step.title}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{step.body}</p>
      <StepActions step={step} stepIndex={stepIndex} onNext={onNext} onSkip={onSkip} />
    </div>
  );
}

/**
 * Computa la posición del tooltip relativo al target. Para "center"
 * (welcome step) lo centra. Para top/bottom/left/right respeta TOOLTIP_GAP
 * y se asegura de no salirse del viewport.
 */
function computeTooltipPos(
  position: TooltipPosition,
  rect: DOMRect | null,
): { style: React.CSSProperties } {
  if (typeof window === "undefined") {
    return { style: {} };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (position === "center" || !rect) {
    return {
      style: {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      },
    };
  }

  let top = 0;
  let left = 0;
  if (position === "top") {
    top = Math.max(8, rect.top - TOOLTIP_GAP - 200);
    left = Math.max(8, rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2);
  } else if (position === "bottom") {
    top = Math.min(vh - 8, rect.bottom + TOOLTIP_GAP);
    left = Math.max(8, rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2);
  } else if (position === "left") {
    top = Math.max(8, rect.top + rect.height / 2 - 80);
    left = Math.max(8, rect.left - TOOLTIP_GAP - TOOLTIP_WIDTH);
  } else {
    // right
    top = Math.max(8, rect.top + rect.height / 2 - 80);
    left = Math.min(vw - TOOLTIP_WIDTH - 8, rect.right + TOOLTIP_GAP);
  }

  // Clamp horizontal para que no se salga del viewport.
  left = Math.min(Math.max(8, left), vw - TOOLTIP_WIDTH - 8);
  top = Math.min(Math.max(8, top), vh - 200);

  return { style: { top, left } };
}
