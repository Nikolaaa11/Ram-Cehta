/**
 * StatusBadge — pill semantizado para estados de workflow.
 *
 * Server-safe (sin "use client"). Diferenciado de `Badge` shadcn por usar
 * gradientes sutiles + glow ring + LiveDot opcional para estados activos.
 *
 * Estados predefinidos:
 *   - DRAFT      (gris, sin dot)
 *   - PENDING    (ámbar, dot pulsando)
 *   - APPROVED   (verde, dot estático)
 *   - REJECTED   (rojo, sin dot)
 *   - PROCESSED  (azul, sin dot)
 *   - CANCELLED  (gris oscuro, sin dot)
 *
 * Custom: usar `<StatusBadge tone="..." label="..." pulse={true} />`.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "warning" | "positive" | "negative" | "info" | "muted";

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Estado predefinido. Si está, sobreescribe tone+label+pulse. */
  status?:
    | "DRAFT"
    | "PENDING"
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "REJECTED"
    | "PROCESSED"
    | "CANCELLED"
    | "EXPORTED";
  /** Tono manual (si no usás status). */
  tone?: Tone;
  /** Label custom. */
  label?: string;
  /** Si true, agrega dot animado. */
  pulse?: boolean;
  /** Tamaño compact vs default. */
  size?: "xs" | "sm" | "md";
}

const statusMap: Record<
  NonNullable<StatusBadgeProps["status"]>,
  { tone: Tone; label: string; pulse: boolean }
> = {
  DRAFT: { tone: "muted", label: "Borrador", pulse: false },
  PENDING: { tone: "warning", label: "Pendiente", pulse: true },
  PENDING_APPROVAL: {
    tone: "warning",
    label: "Esperando firma",
    pulse: true,
  },
  APPROVED: { tone: "positive", label: "Aprobado", pulse: false },
  REJECTED: { tone: "negative", label: "Rechazado", pulse: false },
  PROCESSED: { tone: "info", label: "Procesado", pulse: false },
  CANCELLED: { tone: "muted", label: "Cancelado", pulse: false },
  EXPORTED: { tone: "info", label: "Exportado", pulse: false },
};

const toneClasses: Record<
  Tone,
  { bg: string; text: string; ring: string; dotBg: string; pulseRing: string }
> = {
  neutral: {
    bg: "bg-gradient-to-br from-ink-100 to-ink-50 dark:from-ink-800 dark:to-ink-700",
    text: "text-ink-700 dark:text-ink-300",
    ring: "ring-ink-200 dark:ring-ink-700",
    dotBg: "bg-ink-500",
    pulseRing: "bg-ink-400/30",
  },
  warning: {
    bg: "bg-gradient-to-br from-amber-100 to-amber-50 dark:from-amber-900/40 dark:to-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
    ring: "ring-amber-300/40 dark:ring-amber-700/40",
    dotBg: "bg-warning",
    pulseRing: "bg-warning/40",
  },
  positive: {
    bg: "bg-gradient-to-br from-positive/10 to-emerald-50 dark:from-positive/20 dark:to-emerald-950/40",
    text: "text-green-700 dark:text-green-300",
    ring: "ring-positive/30 dark:ring-positive/40",
    dotBg: "bg-positive",
    pulseRing: "bg-positive/40",
  },
  negative: {
    bg: "bg-gradient-to-br from-red-100 to-red-50 dark:from-red-900/40 dark:to-red-950/40",
    text: "text-red-700 dark:text-red-300",
    ring: "ring-red-300/40 dark:ring-red-700/40",
    dotBg: "bg-negative",
    pulseRing: "bg-negative/40",
  },
  info: {
    bg: "bg-gradient-to-br from-sf-blue/10 to-blue-50 dark:from-sf-blue/20 dark:to-blue-950/40",
    text: "text-blue-700 dark:text-blue-300",
    ring: "ring-sf-blue/30 dark:ring-sf-blue/40",
    dotBg: "bg-sf-blue",
    pulseRing: "bg-sf-blue/40",
  },
  muted: {
    bg: "bg-ink-100/40 dark:bg-ink-800/60",
    text: "text-ink-500 dark:text-ink-400",
    ring: "ring-ink-200/40 dark:ring-ink-700/60",
    dotBg: "bg-ink-400",
    pulseRing: "",
  },
};

const sizeClasses: Record<NonNullable<StatusBadgeProps["size"]>, string> = {
  xs: "h-5 px-1.5 text-[10px] gap-1",
  sm: "h-6 px-2 text-xs gap-1.5",
  md: "h-7 px-2.5 text-xs gap-1.5",
};

export function StatusBadge({
  status,
  tone: toneProp,
  label: labelProp,
  pulse: pulseProp,
  size = "sm",
  className,
  ...props
}: StatusBadgeProps) {
  let tone: Tone = toneProp ?? "neutral";
  let label = labelProp ?? "";
  let pulse = pulseProp ?? false;

  if (status) {
    const config = statusMap[status];
    tone = config.tone;
    label = label || config.label;
    pulse = pulse || config.pulse;
  }

  const t = toneClasses[tone];
  const s = sizeClasses[size];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full ring-1 font-medium tracking-tight whitespace-nowrap",
        t.bg,
        t.text,
        t.ring,
        s,
        className,
      )}
      {...props}
    >
      {pulse && (
        <span className="relative inline-flex h-1.5 w-1.5 items-center justify-center">
          {t.pulseRing && (
            <span
              aria-hidden
              className={cn("absolute h-full w-full rounded-full animate-pulse-ring", t.pulseRing)}
            />
          )}
          <span className={cn("relative h-1.5 w-1.5 rounded-full", t.dotBg)} />
        </span>
      )}
      {label}
    </span>
  );
}
