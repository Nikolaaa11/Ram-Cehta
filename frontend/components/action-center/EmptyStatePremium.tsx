"use client";

/**
 * EmptyStatePremium — Caja regulatoria al día con Sparkles icon grande (R152jj).
 */
import { Sparkles } from "lucide-react";

export function EmptyStatePremium() {
  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-hairline bg-gradient-to-br from-white via-cehta-green/[0.04] to-emerald-50/40 px-8 py-16 text-center shadow-card"
      role="status"
      aria-label="Caja regulatoria al día"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-cehta-green/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-12 -bottom-12 h-40 w-40 rounded-full bg-emerald-200/30 blur-3xl"
      />
      <div className="relative flex flex-col items-center gap-4">
        <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-cehta-green/10 ring-1 ring-cehta-green/20">
          <Sparkles
            className="h-10 w-10 text-cehta-green"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </span>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
          Caja regulatoria al día
        </h2>
        <p className="max-w-md text-sm text-ink-500">
          No tienes nada urgente por los próximos 90 días.
        </p>
      </div>
    </div>
  );
}
