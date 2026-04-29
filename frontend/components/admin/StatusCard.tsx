"use client";

import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CircleSlash,
  HelpCircle,
} from "lucide-react";
import type { IntegrationCheck, CheckState } from "@/hooks/use-system-status";

const STATE_CONFIG: Record<
  CheckState,
  {
    icon: React.ElementType;
    iconClass: string;
    bgClass: string;
    ringClass: string;
    label: string;
  }
> = {
  ok: {
    icon: CheckCircle2,
    iconClass: "text-positive",
    bgClass: "bg-positive/10",
    ringClass: "ring-positive/20",
    label: "OK",
  },
  degraded: {
    icon: AlertTriangle,
    iconClass: "text-warning",
    bgClass: "bg-warning/10",
    ringClass: "ring-warning/20",
    label: "Degradado",
  },
  down: {
    icon: XCircle,
    iconClass: "text-negative",
    bgClass: "bg-negative/10",
    ringClass: "ring-negative/20",
    label: "Caído",
  },
  disabled: {
    icon: CircleSlash,
    iconClass: "text-ink-400",
    bgClass: "bg-ink-100/40",
    ringClass: "ring-hairline",
    label: "Apagado",
  },
  unknown: {
    icon: HelpCircle,
    iconClass: "text-ink-400",
    bgClass: "bg-ink-100/40",
    ringClass: "ring-hairline",
    label: "Desconocido",
  },
};

/** Tarjeta para una integración. Muestra ícono semáforo + nombre + detalle. */
export function StatusCard({ check }: { check: IntegrationCheck }) {
  const cfg = STATE_CONFIG[check.state];
  const Icon = cfg.icon;
  const lastCheckedSecondsAgo = Math.floor(
    (Date.now() - new Date(check.last_checked_at).getTime()) / 1000,
  );

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border border-hairline ${cfg.bgClass} p-4 ring-1 ${cfg.ringClass} transition-colors duration-150 ease-apple`}
    >
      <div className="mt-0.5 shrink-0">
        <Icon className={`h-5 w-5 ${cfg.iconClass}`} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-ink-900">
            {check.name}
          </p>
          <span className={`shrink-0 text-[11px] font-medium ${cfg.iconClass}`}>
            {cfg.label}
          </span>
        </div>
        {check.detail && (
          <p className="mt-0.5 truncate text-xs text-ink-500" title={check.detail}>
            {check.detail}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-400">
          {check.latency_ms !== null && check.latency_ms !== undefined && (
            <>
              <span className="tabular-nums">{check.latency_ms}ms</span>
              <span>·</span>
            </>
          )}
          <span>checked hace {lastCheckedSecondsAgo}s</span>
        </div>
      </div>
    </div>
  );
}
