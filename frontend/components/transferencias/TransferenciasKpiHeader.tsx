"use client";

/**
 * TransferenciasKpiHeader — R152ii
 *
 * 4 KPI cards animadas arriba de la lista de pagos pendientes:
 *   - Listas para pagar (count)
 *   - Monto total CLP
 *   - Promedio por voucher
 *   - Más antigua (días)
 *
 * Usa <AnimatedNumber> para que los números cuenten desde 0.
 */
import { CalendarClock, Coins, ListChecks, Sigma } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { AnimatedNumber } from "@/components/charts/AnimatedNumber";

interface Item {
  voucher_id: number;
  monto: string;
  fecha_documento: string | null;
}

interface Props {
  items: Item[];
  totalClp: number;
}

function diffDays(fromIso: string | null): number {
  if (!fromIso) return 0;
  const then = new Date(fromIso).getTime();
  if (Number.isNaN(then)) return 0;
  const now = Date.now();
  const ms = now - then;
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

export function TransferenciasKpiHeader({ items, totalClp }: Props) {
  const count = items.length;
  const avg = count > 0 ? totalClp / count : 0;
  const oldestDays = items.reduce((max, it) => {
    const d = diffDays(it.fecha_documento);
    return d > max ? d : max;
  }, 0);

  const cards: Array<{
    label: string;
    value: number;
    format: "int" | "clp";
    icon: typeof Coins;
    iconClass: string;
    tone: string;
    suffix?: string;
    hint: string;
  }> = [
    {
      label: "Listas para pagar",
      value: count,
      format: "int",
      icon: ListChecks,
      iconClass: "text-cehta-green",
      tone: "from-cehta-green/15 to-cehta-green/0",
      hint: "Vouchers APPROVED en cola",
    },
    {
      label: "Monto total",
      value: totalClp,
      format: "clp",
      icon: Coins,
      iconClass: "text-blue-600",
      tone: "from-blue-500/15 to-blue-500/0",
      hint: "Suma a transferir hoy",
    },
    {
      label: "Promedio por voucher",
      value: avg,
      format: "clp",
      icon: Sigma,
      iconClass: "text-violet-600",
      tone: "from-violet-500/15 to-violet-500/0",
      hint: "Ticket promedio del lote",
    },
    {
      label: "Más antigua",
      value: oldestDays,
      format: "int",
      icon: CalendarClock,
      iconClass: oldestDays > 15 ? "text-amber-600" : "text-ink-500",
      tone:
        oldestDays > 15
          ? "from-amber-500/15 to-amber-500/0"
          : "from-ink-200/30 to-ink-200/0",
      suffix: oldestDays === 1 ? " día" : " días",
      hint: oldestDays > 15 ? "Atrasada · priorizar" : "Antigüedad del lote",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Surface key={c.label} padding="none" className="relative overflow-hidden">
            <div
              aria-hidden
              className={`absolute inset-0 bg-gradient-to-br ${c.tone} opacity-80`}
            />
            <div className="relative p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`inline-flex size-7 items-center justify-center rounded-lg bg-white/70 ring-1 ring-hairline ${c.iconClass}`}>
                  <Icon className="size-4" strokeWidth={2} />
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">
                  {c.label}
                </span>
              </div>
              <div className="font-display text-2xl sm:text-3xl font-semibold text-ink-900 tabular-nums">
                <AnimatedNumber
                  value={c.value}
                  format={c.format}
                  suffix={c.suffix}
                />
              </div>
              <div className="text-[11px] text-ink-500 mt-1">{c.hint}</div>
            </div>
          </Surface>
        );
      })}
    </div>
  );
}
