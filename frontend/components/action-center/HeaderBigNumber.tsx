"use client";

/**
 * HeaderBigNumber — número GIGANTE animado del total de obligaciones (R152jj).
 *
 * Usa AnimatedNumber con tipografía font-display text-6xl. Sub-label
 * "obligaciones próximas en 90 días".
 */
import { AnimatedNumber } from "@/components/charts/AnimatedNumber";

interface Props {
  total: number;
}

export function HeaderBigNumber({ total }: Props) {
  return (
    <div
      className="flex flex-col items-start"
      aria-label={`${total} obligaciones próximas en 90 días`}
    >
      <AnimatedNumber
        value={total}
        format="int"
        className="font-display text-6xl font-semibold tracking-tight text-ink-900 leading-none tabular-nums"
      />
      <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-ink-500">
        obligaciones próximas en 90 días
      </p>
    </div>
  );
}
