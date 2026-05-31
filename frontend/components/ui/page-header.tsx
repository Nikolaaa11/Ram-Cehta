/**
 * PageHeader — header premium reutilizable para páginas.
 *
 * Server-safe. Componente "wrapper" que entrega el hero pattern visto en
 * dashboard, action-center, mis-pendientes, asistente, etc.
 *
 * Features:
 *   - Gradient mesh sutil
 *   - Decorative blob tonal
 *   - Optional badge "live" pulse arriba del título
 *   - Title con gradient text opcional
 *   - Trailing actions (botones a la derecha)
 *
 * Uso:
 *   <PageHeader
 *     eyebrow="Bandeja unificada"
 *     title="Action Center"
 *     description="Todo lo que requiere tu atención hoy"
 *     icon={Inbox}
 *     trailing={<Button>Imprimir</Button>}
 *   />
 *
 * Custom tone:
 *   <PageHeader title="..." tone="gold" />
 */
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** Texto pequeño verde arriba del título (uppercase). */
  eyebrow?: string;
  /** Icon opcional al lado del eyebrow. */
  icon?: LucideIcon;
  /** Si true, eyebrow se muestra dentro de un pill verde con pulse-ring. */
  pulse?: boolean;
  title: string;
  /** Si true, aplica text-gradient verde→azul al título. */
  gradient?: boolean;
  description?: React.ReactNode;
  /** Tono de la decoración. Default 'default' (verde). */
  tone?: "default" | "gold" | "blue" | "red";
  /** Actions a la derecha (botones, links). */
  trailing?: React.ReactNode;
  /** Compact reduce padding. */
  compact?: boolean;
  className?: string;
}

const toneStyles: Record<
  NonNullable<PageHeaderProps["tone"]>,
  { gradient: string; blob: string; pillBg: string; pillText: string; pillDot: string; pillPulse: string }
> = {
  default: {
    gradient:
      "from-white via-cehta-green/3 to-emerald-50/30",
    blob: "bg-cehta-green/15",
    pillBg: "bg-cehta-green/10 ring-cehta-green/20",
    pillText: "text-cehta-green",
    pillDot: "bg-cehta-green",
    pillPulse: "bg-cehta-green/50",
  },
  gold: {
    gradient:
      "from-white via-amber-50/30 to-yellow-50/40",
    blob: "bg-amber-300/20",
    pillBg: "bg-amber-100 ring-amber-300/40",
    pillText: "text-amber-700",
    pillDot: "bg-amber-500",
    pillPulse: "bg-amber-500/50",
  },
  blue: {
    gradient:
      "from-white via-sf-blue/3 to-blue-50/30",
    blob: "bg-sf-blue/15",
    pillBg: "bg-sf-blue/10 ring-sf-blue/20",
    pillText: "text-sf-blue",
    pillDot: "bg-sf-blue",
    pillPulse: "bg-sf-blue/50",
  },
  red: {
    gradient:
      "from-white via-red-50/30 to-orange-50/40",
    blob: "bg-negative/15",
    pillBg: "bg-negative/10 ring-negative/20",
    pillText: "text-negative",
    pillDot: "bg-negative",
    pillPulse: "bg-negative/50",
  },
};

export function PageHeader({
  eyebrow,
  icon: Icon,
  pulse = true,
  title,
  gradient = false,
  description,
  tone = "default",
  trailing,
  compact = false,
  className,
}: PageHeaderProps) {
  const styles = toneStyles[tone];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl bg-gradient-to-br ring-1",
        styles.gradient,
        tone === "default"
          ? "ring-cehta-green/15"
          : tone === "gold"
            ? "ring-amber-300/30"
            : tone === "blue"
              ? "ring-sf-blue/20"
              : "ring-negative/15",
        compact ? "p-5" : "p-6",
        className,
      )}
    >
      {/* Decorative blob */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full blur-3xl",
          styles.blob,
        )}
      />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3 py-1 ring-1",
                styles.pillBg,
              )}
            >
              {Icon && (
                <Icon
                  className={cn("size-3.5", styles.pillText)}
                  strokeWidth={2}
                />
              )}
              {!Icon && pulse && (
                <span className="relative inline-flex h-1.5 w-1.5">
                  <span
                    className={cn(
                      "absolute h-full w-full rounded-full animate-pulse-ring",
                      styles.pillPulse,
                    )}
                  />
                  <span
                    className={cn("relative h-1.5 w-1.5 rounded-full", styles.pillDot)}
                  />
                </span>
              )}
              <p
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-[0.18em]",
                  styles.pillText,
                )}
              >
                {eyebrow}
              </p>
            </div>
          )}
          <h1
            className={cn(
              "mt-2 font-display font-semibold tracking-tight",
              compact ? "text-2xl" : "text-3xl",
              gradient ? "text-gradient" : "text-ink-900",
            )}
          >
            {title}
          </h1>
          {description && (
            <p
              className={cn(
                "mt-1 text-sm text-ink-500 max-w-2xl",
                compact && "text-xs",
              )}
            >
              {description}
            </p>
          )}
        </div>
        {trailing && (
          <div className="flex shrink-0 items-center gap-2">{trailing}</div>
        )}
      </div>
    </div>
  );
}
