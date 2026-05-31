"use client";

/**
 * StickyCriticalBar — banda roja sticky abajo cuando hay críticas (R152jj).
 *
 * Click hace scroll suave a #first-critical (el primer item critical en lista).
 */
import { AlertTriangle } from "lucide-react";

interface Props {
  count: number;
  onJump: () => void;
}

export function StickyCriticalBar({ count, onJump }: Props) {
  if (count <= 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 sm:pb-6">
      <button
        type="button"
        onClick={onJump}
        aria-label={`Revisar ${count} obligaciones críticas`}
        className="pointer-events-auto group inline-flex items-center gap-3 rounded-full bg-negative px-5 py-3 text-white shadow-glow-red ring-1 ring-negative/30 transition-all duration-200 ease-apple hover:-translate-y-0.5 hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-negative"
      >
        <AlertTriangle
          className="h-4 w-4 shrink-0 animate-pulse"
          strokeWidth={2.25}
          aria-hidden="true"
        />
        <span className="text-sm font-semibold tabular-nums tracking-tight">
          {count} {count === 1 ? "obligación vencida o crítica" : "obligaciones vencidas o críticas"}
        </span>
        <span className="hidden h-4 w-px bg-white/40 sm:inline-block" />
        <span className="hidden text-xs font-medium opacity-90 group-hover:opacity-100 sm:inline">
          Revisar ahora →
        </span>
      </button>
    </div>
  );
}
