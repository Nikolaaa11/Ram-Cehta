"use client";

/**
 * SeverityDonuts — 3 donuts por severidad: críticas / warnings / info (R152jj).
 *
 * Calcula porcentaje de cada severity sobre total.
 */
// R152uu — Lazy DonutKPI (recharts ~80kB).
import { LazyDonutKPI as DonutKPI } from "@/components/charts/lazy";

interface Props {
  critical: number;
  warning: number;
  info: number;
}

export function SeverityDonuts({ critical, warning, info }: Props) {
  const total = critical + warning + info;
  const pctCritical = total > 0 ? Math.round((critical / total) * 100) : 0;
  const pctWarning = total > 0 ? Math.round((warning / total) * 100) : 0;
  const pctInfo = total > 0 ? Math.round((info / total) * 100) : 0;

  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="flex flex-col items-center rounded-2xl border border-hairline bg-white px-3 py-4 shadow-card">
        <DonutKPI
          value={pctCritical}
          total={100}
          label="Críticas"
          color="#DC2626"
          size={120}
          format="pct"
        />
        <p className="mt-2 text-[11px] text-ink-500">
          {critical} de {total || 0}
        </p>
      </div>
      <div className="flex flex-col items-center rounded-2xl border border-hairline bg-white px-3 py-4 shadow-card">
        <DonutKPI
          value={pctWarning}
          total={100}
          label="Warnings"
          color="#D97706"
          size={120}
          format="pct"
        />
        <p className="mt-2 text-[11px] text-ink-500">
          {warning} de {total || 0}
        </p>
      </div>
      <div className="flex flex-col items-center rounded-2xl border border-hairline bg-white px-3 py-4 shadow-card">
        <DonutKPI
          value={pctInfo}
          total={100}
          label="Info"
          color="#236C4F"
          size={120}
          format="pct"
        />
        <p className="mt-2 text-[11px] text-ink-500">
          {info} de {total || 0}
        </p>
      </div>
    </div>
  );
}
