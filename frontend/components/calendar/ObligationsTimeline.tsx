"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  FileText,
  Receipt,
  Scale,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import type {
  ObligationItem,
  ObligationSeverity,
  ObligationTipo,
} from "@/lib/api/schema";

const TIPO_LABEL: Record<ObligationTipo, string> = {
  f29: "F29",
  legal: "Legal",
  oc: "OC",
  suscripcion: "Suscripción",
  event: "Evento",
};

const TIPO_ICON: Record<ObligationTipo, typeof Receipt> = {
  f29: Receipt,
  legal: Scale,
  oc: FileText,
  suscripcion: TrendingUp,
  event: Sparkles,
};

// Color de pill por tipo (chip pequeño con badge del tipo).
const TIPO_PILL: Record<ObligationTipo, string> = {
  f29: "bg-cehta-green/10 text-cehta-green",
  legal: "bg-sf-purple/10 text-sf-purple",
  oc: "bg-sf-blue/10 text-sf-blue",
  suscripcion: "bg-warning/15 text-warning",
  event: "bg-ink-100 text-ink-700",
};

// Stripe lateral por severity (rayita izquierda visual).
const SEVERITY_STRIPE: Record<ObligationSeverity, string> = {
  critical: "bg-negative",
  warning: "bg-warning",
  info: "bg-sf-blue",
};

const SEVERITY_DOT: Record<ObligationSeverity, string> = {
  critical: "bg-negative",
  warning: "bg-warning",
  info: "bg-sf-blue",
};

const SEVERITY_BADGE: Record<ObligationSeverity, string> = {
  critical: "bg-negative/15 text-negative",
  warning: "bg-warning/15 text-warning",
  info: "bg-cehta-green/10 text-cehta-green",
};

type GroupKey = "this_week" | "next_week" | "soon" | "later";

const GROUP_LABEL: Record<GroupKey, string> = {
  this_week: "Esta semana",
  next_week: "Próxima semana",
  soon: "En 2-4 semanas",
  later: "Más lejos",
};

const GROUP_ORDER: GroupKey[] = ["this_week", "next_week", "soon", "later"];

function bucketFor(daysUntil: number): GroupKey {
  // Vencidos cuentan dentro de "esta semana" (lo más urgente arriba).
  if (daysUntil <= 7) return "this_week";
  if (daysUntil <= 14) return "next_week";
  if (daysUntil <= 28) return "soon";
  return "later";
}

function daysLabel(days: number): string {
  if (days < 0) {
    const abs = Math.abs(days);
    return abs === 1 ? "vencido 1 día" : `vencido ${abs} días`;
  }
  if (days === 0) return "vence hoy";
  if (days === 1) return "en 1 día";
  if (days <= 13) return `en ${days} días`;
  if (days <= 28) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? "en 1 sem" : `en ${weeks} sem`;
  }
  const months = Math.round(days / 30);
  return months === 1 ? "en 1 mes" : `en ${months} meses`;
}

function formatMoney(
  monto: string | number | null | undefined,
  moneda: string | null | undefined,
): string | null {
  if (monto === null || monto === undefined || monto === "") return null;
  const n = typeof monto === "string" ? Number(monto) : monto;
  if (!Number.isFinite(n)) return null;
  const formatted = new Intl.NumberFormat("es-CL", {
    maximumFractionDigits: 0,
  }).format(n as number);
  return moneda ? `${moneda} ${formatted}` : formatted;
}

interface Props {
  obligations: ObligationItem[];
}

export function ObligationsTimeline({ obligations }: Props) {
  const router = useRouter();

  const groups = useMemo(() => {
    const map: Record<GroupKey, ObligationItem[]> = {
      this_week: [],
      next_week: [],
      soon: [],
      later: [],
    };
    for (const item of obligations) {
      map[bucketFor(item.days_until)].push(item);
    }
    for (const k of GROUP_ORDER) {
      map[k].sort((a, b) => a.days_until - b.days_until);
    }
    return map;
  }, [obligations]);

  if (obligations.length === 0) {
    return (
      <Surface
        padding="default"
        className="flex flex-col items-center justify-center gap-3 py-16 text-center"
      >
        <CalendarClock
          className="h-10 w-10 text-ink-300"
          strokeWidth={1.25}
        />
        <p className="text-sm text-ink-500">
          No hay obligaciones pendientes en el rango seleccionado.
        </p>
      </Surface>
    );
  }

  return (
    <div className="space-y-6">
      {GROUP_ORDER.map((key) => {
        const items = groups[key];
        if (items.length === 0) return null;
        return (
          <section key={key} className="space-y-2">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-500">
                {GROUP_LABEL[key]}
              </h2>
              <span className="text-xs tabular-nums text-ink-300">
                {items.length}
              </span>
            </div>
            <ul className="space-y-2">
              {items.map((item) => (
                <ObligationRow
                  key={item.id}
                  item={item}
                  onClick={() => router.push(item.link as never)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ObligationRow({
  item,
  onClick,
}: {
  item: ObligationItem;
  onClick: () => void;
}) {
  const Icon = TIPO_ICON[item.tipo];
  const due = parseISO(item.due_date);
  // Recompute days_until against today client-side for resilience cuando
  // la query se cachea más de 1 día.
  const liveDays = differenceInCalendarDays(due, new Date());
  const days = Number.isFinite(liveDays) ? liveDays : item.days_until;
  const money = formatMoney(item.monto, item.moneda);

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group flex w-full items-stretch gap-0 overflow-hidden rounded-2xl bg-white/90 text-left ring-1 ring-hairline shadow-card transition-all duration-150 ease-apple",
          "hover:bg-white hover:ring-cehta-green/30 hover:shadow-glass",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
        )}
      >
        <span
          aria-hidden="true"
          className={cn("w-1 shrink-0", SEVERITY_STRIPE[item.severity])}
        />
        <div className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3">
          <span
            className={cn(
              "inline-flex h-2 w-2 shrink-0 rounded-full",
              SEVERITY_DOT[item.severity],
            )}
            aria-hidden="true"
          />
          <Icon
            className="h-4 w-4 shrink-0 text-ink-500"
            strokeWidth={1.5}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-ink-900">
                {item.title}
              </p>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                  TIPO_PILL[item.tipo],
                )}
              >
                {TIPO_LABEL[item.tipo]}
              </span>
              {item.empresa_codigo && (
                <span className="inline-flex shrink-0 items-center rounded-full bg-ink-100/60 px-2 py-0.5 text-[10px] font-medium text-ink-700">
                  {item.empresa_codigo}
                </span>
              )}
            </div>
            {item.subtitle && (
              <p className="mt-0.5 truncate text-xs text-ink-500">
                {item.subtitle}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-right">
            <span className="text-xs tabular-nums text-ink-500">
              {format(due, "dd MMM", { locale: es })}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                SEVERITY_BADGE[item.severity],
              )}
            >
              {days < 0 ? (
                <AlertTriangle
                  className="mr-1 h-3 w-3"
                  strokeWidth={2}
                />
              ) : null}
              {daysLabel(days)}
            </span>
            {money && (
              <span className="text-[11px] tabular-nums text-ink-500">
                {money}
              </span>
            )}
          </div>
          <ArrowRight
            className="h-4 w-4 shrink-0 text-ink-300 transition-colors duration-150 ease-apple group-hover:text-cehta-green"
            strokeWidth={1.5}
          />
        </div>
      </button>
    </li>
  );
}
