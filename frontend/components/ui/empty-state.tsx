/**
 * EmptyState — componente genérico premium para estados vacíos.
 *
 * Server-safe (no "use client"). Reemplaza los empty states plain
 * (icon + text + button) por uno con:
 *   - Gradient mesh sutil de fondo
 *   - Icon con halo glow tonal
 *   - Floating sparkles decorativos
 *   - CTA magnetic con shimmer
 *
 * Uso:
 *   <EmptyState
 *     icon={Inbox}
 *     title="Sin vouchers aún"
 *     description="Crea tu primer voucher para empezar a llevar contabilidad."
 *     action={{ label: "Nuevo voucher", href: "/vouchers/nuevo" }}
 *     tone="default"
 *   />
 */
import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import type { LucideIcon } from "lucide-react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    href: Route;
  };
  secondaryAction?: {
    label: string;
    href: Route;
  };
  /** Tono semántico — afecta colores del icon halo y CTA. */
  tone?: "default" | "positive" | "warning" | "premium";
  /** Si false, oculta el gradient mesh background. Default true. */
  showMesh?: boolean;
  /** Si false, oculta los sparkles. Default true. */
  showSparkles?: boolean;
  /** Compact si está dentro de un panel pequeño. */
  compact?: boolean;
  className?: string;
}

const toneStyles: Record<
  NonNullable<EmptyStateProps["tone"]>,
  { halo: string; iconBg: string; iconColor: string; ctaBg: string; ctaGlow: string }
> = {
  default: {
    halo: "bg-cehta-green/15",
    iconBg: "bg-gradient-to-br from-cehta-green/10 via-emerald-50 to-teal-50 ring-cehta-green/20",
    iconColor: "text-cehta-green",
    ctaBg: "bg-cehta-green hover:bg-cehta-green-600",
    ctaGlow: "shadow-glow-green",
  },
  positive: {
    halo: "bg-positive/15",
    iconBg: "bg-gradient-to-br from-positive/10 via-emerald-50 to-green-50 ring-positive/25",
    iconColor: "text-positive",
    ctaBg: "bg-positive hover:bg-green-600",
    ctaGlow: "shadow-glow-green",
  },
  warning: {
    halo: "bg-warning/20",
    iconBg: "bg-gradient-to-br from-warning/10 via-amber-50 to-orange-50 ring-warning/25",
    iconColor: "text-warning",
    ctaBg: "bg-warning hover:bg-amber-600",
    ctaGlow: "shadow-glow-gold",
  },
  premium: {
    halo: "bg-amber-300/25",
    iconBg: "bg-gradient-to-br from-amber-100 via-yellow-50 to-amber-50 ring-amber-300/40",
    iconColor: "text-amber-600",
    ctaBg: "bg-gradient-to-br from-amber-500 via-amber-600 to-amber-700 hover:from-amber-600 hover:to-amber-800",
    ctaGlow: "shadow-glow-gold",
  },
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  tone = "default",
  showMesh = true,
  showSparkles = true,
  compact = false,
  className,
}: EmptyStateProps) {
  const styles = toneStyles[tone];

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden px-6 text-center",
        compact ? "py-12" : "min-h-[400px] py-16",
        className,
      )}
    >
      {/* Gradient mesh background */}
      {showMesh && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 gradient-mesh-animated opacity-50"
        />
      )}

      {/* Sparkles decoration */}
      {showSparkles && (
        <>
          <Sparkles
            aria-hidden
            className="absolute left-[20%] top-[25%] h-3 w-3 text-cehta-green/30 sparkle"
          />
          <Sparkles
            aria-hidden
            className="absolute right-[25%] top-[35%] h-4 w-4 text-amber-400/40 sparkle"
            style={{ animationDelay: "0.6s" }}
          />
          <Sparkles
            aria-hidden
            className="absolute left-[60%] bottom-[25%] h-3 w-3 text-sf-blue/30 sparkle"
            style={{ animationDelay: "1.2s" }}
          />
        </>
      )}

      <div className="relative slide-up-fade">
        {/* Icon with halo glow */}
        <div className="relative inline-flex items-center justify-center">
          <span
            aria-hidden
            className={cn(
              "absolute inset-0 -m-2 rounded-3xl blur-xl",
              styles.halo,
            )}
          />
          <div
            className={cn(
              "relative inline-flex h-20 w-20 items-center justify-center rounded-3xl ring-1 float-slow",
              styles.iconBg,
            )}
          >
            <Icon
              className={cn("h-9 w-9", styles.iconColor)}
              strokeWidth={1.5}
            />
          </div>
        </div>

        <h3
          className={cn(
            "mt-6 font-display font-semibold tracking-tight text-ink-900",
            compact ? "text-lg" : "text-2xl",
          )}
        >
          {title}
        </h3>
        {description && (
          <p
            className={cn(
              "mt-2 max-w-md text-sm text-ink-500",
              compact ? "text-xs" : "text-sm",
            )}
          >
            {description}
          </p>
        )}

        {(action || secondaryAction) && (
          <div className="mt-6 flex items-center justify-center gap-3">
            {action && (
              <Link
                href={action.href}
                className={cn(
                  "group inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 ease-apple",
                  "hover:-translate-y-0.5 active:scale-[0.97]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2",
                  styles.ctaBg,
                  styles.ctaGlow,
                  "hover:shadow-elevated-lg",
                )}
              >
                {action.label}
                <span className="transition-transform duration-200 group-hover:translate-x-1">
                  →
                </span>
              </Link>
            )}
            {secondaryAction && (
              <Link
                href={secondaryAction.href}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl bg-white/80 px-5 py-2.5 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-all duration-200 ease-apple",
                  "hover:bg-white hover:ring-cehta-green/30 hover:text-cehta-green hover:-translate-y-0.5",
                  "",
                )}
              >
                {secondaryAction.label}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
