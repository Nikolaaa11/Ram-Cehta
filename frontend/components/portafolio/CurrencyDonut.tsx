"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { PieChart as PieIcon } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { APPLE_PALETTE } from "@/lib/dashboard/chart-palette";
import { formatM } from "@/lib/dashboard/format-chart";
import { toCLP, toPct } from "@/lib/format";
import type { CurrencyBreakdownItem } from "@/lib/api/schema";

const COLOR_BY_CURRENCY: Record<string, string> = {
  CLP: APPLE_PALETTE[0], // cehta-green
  USD: APPLE_PALETTE[1], // sf-blue
  UF: APPLE_PALETTE[2], // sf-purple
};

function colorFor(currency: string): string {
  return COLOR_BY_CURRENCY[currency] ?? APPLE_PALETTE[9];
}

interface Slice {
  name: string;
  value: number;
  color: string;
  percent: number;
}

interface Props {
  breakdown: CurrencyBreakdownItem[];
}

export function CurrencyDonut({ breakdown }: Props) {
  const slices: Slice[] = breakdown
    .map((it) => ({
      name: it.currency,
      value: Number(it.total_clp),
      color: colorFor(it.currency),
      percent: Number(it.percent),
    }))
    .filter((s) => Number.isFinite(s.value) && s.value > 0);

  if (slices.length === 0) {
    return (
      <Surface aria-label="Composición por moneda — sin datos">
        <Surface.Header>
          <Surface.Title>Composición por moneda</Surface.Title>
          <Surface.Subtitle>Sin saldos disponibles</Surface.Subtitle>
        </Surface.Header>
        <Surface.Body className="flex h-[280px] flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/40">
            <PieIcon className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-ink-500">
            Cargá movimientos para ver la composición.
          </p>
        </Surface.Body>
      </Surface>
    );
  }

  const total = slices.reduce((acc, s) => acc + s.value, 0);

  return (
    <Surface aria-label="Composición del portafolio por moneda">
      <Surface.Header>
        <Surface.Title>Composición por moneda</Surface.Title>
        <Surface.Subtitle>
          Equivalente CLP de cada moneda nativa
        </Surface.Subtitle>
      </Surface.Header>
      <Surface.Body className="mt-4 h-[280px] flex flex-row items-center gap-4">
        <div className="relative h-full flex-shrink-0" style={{ width: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="name"
                innerRadius={64}
                outerRadius={100}
                paddingAngle={2}
                cornerRadius={4}
                stroke="#fff"
                strokeWidth={2}
                isAnimationActive
                animationDuration={400}
              >
                {slices.map((s) => (
                  <Cell key={s.name} fill={s.color} />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip />} cursor={false} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <p className="text-[10px] font-medium uppercase tracking-wide text-ink-500">
              Total
            </p>
            <p className="font-display text-lg font-semibold tabular-nums text-ink-900 mt-0.5">
              {formatM(total)}
            </p>
          </div>
        </div>

        <ul className="flex-1 min-w-0 space-y-2">
          {slices.map((s) => (
            <li
              key={s.name}
              className="flex items-center gap-2 text-sm"
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span className="flex-1 font-medium text-ink-900">{s.name}</span>
              <span className="tabular-nums text-ink-700 text-sm">
                {formatM(s.value)}
              </span>
              <span className="tabular-nums text-ink-500 w-12 text-right text-xs">
                {toPct(s.percent, { digits: 1 })}
              </span>
            </li>
          ))}
        </ul>
      </Surface.Body>
    </Surface>
  );
}

interface DonutTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: Slice }>;
}

function DonutTooltip({ active, payload }: DonutTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const slice = payload[0]?.payload;
  if (!slice) return null;
  return (
    <div className="rounded-lg bg-ink-900/95 px-3 py-2 text-white shadow-lg backdrop-blur-sm">
      <p className="text-xs font-medium">{slice.name}</p>
      <p className="text-sm tabular-nums">{toCLP(slice.value)}</p>
      <p className="text-xs text-white/70 tabular-nums">
        {toPct(slice.percent, { digits: 1 })}
      </p>
    </div>
  );
}
