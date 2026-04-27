"use client";

import { useMemo, useState } from "react";
import {
  format,
  startOfMonth,
  startOfYear,
  subMonths,
  endOfMonth,
} from "date-fns";
import { Calendar, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDashboardFilters } from "@/lib/dashboard/use-dashboard-filters";
import { cn } from "@/lib/utils";

type PresetKey =
  | "este-mes"
  | "mes-pasado"
  | "ultimos-3"
  | "ultimos-12"
  | "ytd"
  | "custom";

const fmt = (d: Date) => format(d, "yyyy-MM");

interface Preset {
  key: PresetKey;
  label: string;
  range: () => { from: string; to: string };
}

const PRESETS: Preset[] = [
  {
    key: "este-mes",
    label: "Este mes",
    range: () => {
      const now = new Date();
      return { from: fmt(startOfMonth(now)), to: fmt(endOfMonth(now)) };
    },
  },
  {
    key: "mes-pasado",
    label: "Mes pasado",
    range: () => {
      const last = subMonths(new Date(), 1);
      return { from: fmt(startOfMonth(last)), to: fmt(endOfMonth(last)) };
    },
  },
  {
    key: "ultimos-3",
    label: "Últimos 3 meses",
    range: () => {
      const now = new Date();
      return { from: fmt(startOfMonth(subMonths(now, 2))), to: fmt(endOfMonth(now)) };
    },
  },
  {
    key: "ultimos-12",
    label: "Últimos 12 meses",
    range: () => {
      const now = new Date();
      return { from: fmt(startOfMonth(subMonths(now, 11))), to: fmt(endOfMonth(now)) };
    },
  },
  {
    key: "ytd",
    label: "YTD (año en curso)",
    range: () => {
      const now = new Date();
      return { from: fmt(startOfYear(now)), to: fmt(endOfMonth(now)) };
    },
  },
];

function detectActivePreset(from: string | null, to: string | null): PresetKey | null {
  if (!from || !to) return "ultimos-12"; // default visual
  for (const p of PRESETS) {
    const r = p.range();
    if (r.from === from && r.to === to) return p.key;
  }
  return "custom";
}

function presetLabel(active: PresetKey | null, from: string | null, to: string | null) {
  if (active === "custom" && from && to) {
    return `${from} → ${to}`;
  }
  const found = PRESETS.find((p) => p.key === active);
  if (found) return found.label;
  if (!from && !to) return "Últimos 12 meses";
  return "Período";
}

export function PeriodoFilter() {
  const { filters, setPeriodo } = useDashboardFilters();
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(filters.from ?? "");
  const [customTo, setCustomTo] = useState(filters.to ?? "");
  const active = useMemo(
    () => detectActivePreset(filters.from, filters.to),
    [filters.from, filters.to],
  );
  const label = presetLabel(active, filters.from, filters.to);
  const showingCustom = active === "custom";

  const applyPreset = (preset: Preset) => {
    const r = preset.range();
    setPeriodo(r.from, r.to);
    setOpen(false);
  };

  const applyCustom = () => {
    if (customFrom && customTo) {
      setPeriodo(customFrom, customTo);
      setOpen(false);
    }
  };

  const clearAll = () => {
    setPeriodo(null, null);
    setCustomFrom("");
    setCustomTo("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline shadow-glass",
            "transition-colors duration-150 ease-apple hover:bg-surface-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
          )}
        >
          <Calendar className="h-4 w-4 text-ink-500" strokeWidth={1.5} />
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 text-ink-500" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3">
        <div className="flex flex-col gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p)}
              className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                "transition-colors duration-150 ease-apple hover:bg-surface-muted",
                active === p.key && "bg-cehta-green-50 text-cehta-green-700 font-medium",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-3 border-t border-hairline pt-3">
          <p className="px-1 text-xs font-medium uppercase tracking-wide text-ink-500">
            Personalizado
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-ink-500">
              Desde
              <input
                type="month"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-lg bg-white px-2 py-1.5 text-sm text-ink-900 ring-1 ring-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-500">
              Hasta
              <input
                type="month"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-lg bg-white px-2 py-1.5 text-sm text-ink-900 ring-1 ring-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={clearAll}
              className="text-xs text-ink-500 hover:text-ink-700 transition-colors"
            >
              Limpiar
            </button>
            <button
              type="button"
              onClick={applyCustom}
              disabled={!customFrom || !customTo}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium",
                "bg-cehta-green text-white shadow-card",
                "transition-all duration-150 ease-apple hover:bg-cehta-green-600",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
              )}
            >
              Aplicar
            </button>
          </div>
          {showingCustom && (
            <p className="mt-2 px-1 text-[10px] text-ink-500">
              Período personalizado activo.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
