/**
 * LiveDot — punto de status con pulse animado (Apple-style).
 *
 * Para indicar estados live/online/syncing en cualquier UI. Server-safe
 * (sin "use client") — usa CSS keyframes definidos en globals.css.
 *
 * Tonos:
 *   - live (verde, pulse infinito) — para "conectado" / online
 *   - syncing (azul, pulse rápido) — para "procesando" / loading
 *   - warning (ámbar) — para "atención" / degradado
 *   - critical (rojo, pulse intenso) — para "error" / vencido
 *   - inactive (gris, sin pulse) — para "offline" / desactivado
 *
 * Sin texto adjunto — para una etiqueta usar el wrapper `LiveBadge`.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface LiveDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: "live" | "syncing" | "warning" | "critical" | "inactive";
  size?: "sm" | "md" | "lg";
}

const toneClasses: Record<NonNullable<LiveDotProps["tone"]>, { bg: string; ring: string; pulse: string }> = {
  live: { bg: "bg-positive", ring: "bg-positive/30", pulse: "animate-pulse-ring" },
  syncing: { bg: "bg-sf-blue", ring: "bg-sf-blue/30", pulse: "animate-pulse-ring" },
  warning: { bg: "bg-warning", ring: "bg-warning/30", pulse: "animate-pulse-ring" },
  critical: { bg: "bg-negative", ring: "bg-negative/40", pulse: "animate-pulse-ring" },
  inactive: { bg: "bg-ink-300", ring: "", pulse: "" },
};

const sizeClasses: Record<NonNullable<LiveDotProps["size"]>, { container: string; dot: string }> = {
  sm: { container: "h-2 w-2", dot: "h-2 w-2" },
  md: { container: "h-2.5 w-2.5", dot: "h-2.5 w-2.5" },
  lg: { container: "h-3 w-3", dot: "h-3 w-3" },
};

export function LiveDot({
  tone = "live",
  size = "md",
  className,
  ...props
}: LiveDotProps) {
  const t = toneClasses[tone];
  const s = sizeClasses[size];
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex items-center justify-center",
        s.container,
        className,
      )}
      {...props}
    >
      {tone !== "inactive" && (
        <span
          className={cn(
            "absolute h-full w-full rounded-full",
            t.ring,
            t.pulse,
          )}
        />
      )}
      <span className={cn("relative rounded-full", s.dot, t.bg)} />
    </span>
  );
}

export interface LiveBadgeProps extends LiveDotProps {
  label: string;
  /** Si true, el label va antes del dot. Default false. */
  reverse?: boolean;
}

/**
 * LiveBadge — LiveDot + label en pill compacto.
 *   <LiveBadge tone="live" label="En vivo" />
 */
export function LiveBadge({
  label,
  reverse = false,
  tone = "live",
  size = "md",
  className,
  ...props
}: LiveBadgeProps) {
  const textColor =
    tone === "live"
      ? "text-positive"
      : tone === "syncing"
        ? "text-sf-blue"
        : tone === "warning"
          ? "text-warning"
          : tone === "critical"
            ? "text-negative"
            : "text-ink-500";

  const bgColor =
    tone === "live"
      ? "bg-positive/10"
      : tone === "syncing"
        ? "bg-sf-blue/10"
        : tone === "warning"
          ? "bg-warning/10"
          : tone === "critical"
            ? "bg-negative/10"
            : "bg-ink-100/60";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        bgColor,
        textColor,
        className,
      )}
      {...props}
    >
      {!reverse && <LiveDot tone={tone} size={size} />}
      <span className="font-medium tracking-tight">{label}</span>
      {reverse && <LiveDot tone={tone} size={size} />}
    </span>
  );
}
