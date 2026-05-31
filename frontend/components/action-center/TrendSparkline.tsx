"use client";

/**
 * TrendSparkline — distribución de obligaciones por semana (próximas 12 sem) (R152jj).
 *
 * Agrupa los items por bucket de 7 días desde hoy. Muestra sparkline + label.
 */
import { useMemo } from "react";
import { Sparkline } from "@/components/charts/Sparkline";
import type { ObligationItem } from "@/lib/api/schema";

interface Props {
  obligations: ObligationItem[];
}

const WEEKS = 12;

export function TrendSparkline({ obligations }: Props) {
  const { buckets, peakWeek, peakCount } = useMemo(() => {
    // R152jj — usar Array de length fija + cast para evitar
    // noUncheckedIndexedAccess (TS strict). Cada index es siempre un number.
    const b = new Array<number>(WEEKS).fill(0);
    for (const o of obligations) {
      const d = o.days_until;
      const idx = d < 0 ? 0 : Math.min(Math.floor(d / 7), WEEKS - 1);
      b[idx] = (b[idx] as number) + 1;
    }
    let peakWeek = 0;
    let peakCount = 0;
    for (let i = 0; i < b.length; i++) {
      const v = b[i] as number;
      if (v > peakCount) {
        peakCount = v;
        peakWeek = i;
      }
    }
    return { buckets: b, peakWeek, peakCount };
  }, [obligations]);

  const hasSignal = buckets.some((v) => v > 0);

  // Trend: comparar mitad inicial vs final
  const trend: "up" | "down" | "flat" = useMemo(() => {
    const first = buckets.slice(0, WEEKS / 2).reduce((a, b) => a + b, 0);
    const last = buckets.slice(WEEKS / 2).reduce((a, b) => a + b, 0);
    if (first === last) return "flat";
    return first > last ? "down" : "up";
  }, [buckets]);

  if (!hasSignal) return null;

  return (
    <div className="rounded-2xl border border-hairline bg-white px-4 py-3 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Carga regulatoria — próximas 12 semanas
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            Semana pico: <span className="font-medium text-ink-700">sem {peakWeek + 1}</span>{" "}
            ({peakCount} {peakCount === 1 ? "obligación" : "obligaciones"})
          </p>
        </div>
        <span
          className={`text-[10px] font-medium uppercase tracking-wider ${
            trend === "down"
              ? "text-cehta-green"
              : trend === "up"
              ? "text-warning"
              : "text-ink-400"
          }`}
        >
          {trend === "down" ? "↓ baja" : trend === "up" ? "↑ sube" : "→ estable"}
        </span>
      </div>
      <div className="mt-2">
        <Sparkline
          data={buckets}
          trend={trend === "down" ? "down" : trend === "up" ? "up" : "flat"}
          height={48}
          showTooltip
          label="obligaciones"
        />
      </div>
    </div>
  );
}
