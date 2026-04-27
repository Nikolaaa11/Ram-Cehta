import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

export interface KpiCardSmallProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  /** Color del dot junto al valor (ya semantizado por backend). */
  dot?: "positive" | "negative" | "warning" | "neutral";
  /** Color del icono container. */
  tone?: "default" | "positive" | "negative" | "warning";
  className?: string;
}

const toneIconBg: Record<NonNullable<KpiCardSmallProps["tone"]>, string> = {
  default: "bg-ink-100/60 text-ink-700",
  positive: "bg-positive/10 text-positive",
  negative: "bg-negative/10 text-negative",
  warning: "bg-warning/10 text-warning",
};

const dotColor: Record<NonNullable<KpiCardSmallProps["dot"]>, string> = {
  positive: "bg-positive",
  negative: "bg-negative",
  warning: "bg-warning",
  neutral: "bg-ink-300",
};

export function KpiCardSmall({
  label,
  value,
  icon: Icon,
  dot,
  tone = "default",
  className,
}: KpiCardSmallProps) {
  return (
    <Surface
      padding="compact"
      className={cn(
        "flex h-[88px] items-center gap-3",
        className,
      )}
    >
      {Icon && (
        <span
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            toneIconBg[tone],
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-ink-500">
          {label}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          {dot && (
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full shrink-0",
                dotColor[dot],
              )}
            />
          )}
          <p className="truncate font-display text-kpi-sm tabular-nums text-ink-900">
            {value}
          </p>
        </div>
      </div>
    </Surface>
  );
}
