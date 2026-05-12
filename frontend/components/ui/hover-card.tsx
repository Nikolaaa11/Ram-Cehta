"use client";

/**
 * HoverCard — preview popover al pasar el mouse sobre un trigger.
 *
 * Built on top de Radix Popover pero con hover-trigger en lugar de click.
 * Open delay 200ms (evita popups innecesarios), close delay 100ms.
 *
 * Para previews de empresa, voucher, LP, etc. — ver ficha sin click.
 *
 * Uso:
 *   <HoverCard
 *     trigger={<Link href="/empresa/EVQ">EVOQUE</Link>}
 *     content={<EmpresaPreview codigo="EVQ" />}
 *   />
 *
 * Lightweight implementation con vanilla mouseenter/leave + timers, no
 * agrego más deps de Radix.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface HoverCardProps {
  trigger: React.ReactNode;
  content: React.ReactNode;
  /** Delay para abrir (ms). Default 250. */
  openDelay?: number;
  /** Delay para cerrar (ms). Default 150. */
  closeDelay?: number;
  /** Width del popover. Default 320px. */
  width?: number;
  /** Posición del popover relativa al trigger. Default 'bottom'. */
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export function HoverCard({
  trigger,
  content,
  openDelay = 250,
  closeDelay = 150,
  width = 320,
  side = "bottom",
  className,
}: HoverCardProps) {
  const [open, setOpen] = React.useState(false);
  const openTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (open) return;
    openTimerRef.current = setTimeout(() => {
      setOpen(true);
    }, openDelay);
  };

  const handleLeave = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (!open) return;
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, closeDelay);
  };

  React.useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const sidePositioning: Record<NonNullable<HoverCardProps["side"]>, string> = {
    top: "bottom-full mb-2 left-1/2 -translate-x-1/2",
    bottom: "top-full mt-2 left-1/2 -translate-x-1/2",
    left: "right-full mr-2 top-1/2 -translate-y-1/2",
    right: "left-full ml-2 top-1/2 -translate-y-1/2",
  };

  return (
    <span
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      className={cn("relative inline-flex", className)}
    >
      {trigger}
      {open && (
        <span
          role="tooltip"
          style={{ width }}
          className={cn(
            "absolute z-50 animate-slide-down-fade",
            sidePositioning[side],
          )}
        >
          <span className="block rounded-2xl bg-white/95 backdrop-blur-xl ring-1 ring-hairline shadow-elevated-lg p-4 dark:bg-ink-900/95 dark:ring-ink-700">
            {content}
          </span>
        </span>
      )}
    </span>
  );
}
