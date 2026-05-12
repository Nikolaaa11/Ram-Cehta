"use client";

/**
 * SpotlightCard — surface premium con luz que sigue al cursor.
 *
 * Sets CSS vars `--mouse-x` / `--mouse-y` via onMouseMove. La capa visual
 * se renderiza en CSS puro (.spotlight class, ver globals.css).
 *
 * Lightweight: rAF-throttled, no setState, no re-renders. Ideal para grids
 * de cards donde cada tarjeta reacciona al hover individual.
 *
 * Uso:
 *   <SpotlightCard className="p-6">
 *     <h3>Premium content</h3>
 *   </SpotlightCard>
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SpotlightCardProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Color del spotlight (CSS color). Default verde Cehta. */
  spotlightColor?: string;
  /** Radio del haz (CSS length). Default 200px. */
  radius?: string;
  /** Si true, mantiene el spotlight aunque el cursor salga. Default false. */
  persistent?: boolean;
}

export function SpotlightCard({
  className,
  spotlightColor = "rgba(29, 111, 66, 0.12)",
  radius = "240px",
  persistent = false,
  children,
  style,
  ...props
}: SpotlightCardProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const rafRef = React.useRef<number | null>(null);

  const handleMouseMove = React.useCallback((e: React.MouseEvent) => {
    if (!ref.current) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const target = ref.current;
    const x = e.clientX;
    const y = e.clientY;
    rafRef.current = requestAnimationFrame(() => {
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--mouse-x", `${x - rect.left}px`);
      target.style.setProperty("--mouse-y", `${y - rect.top}px`);
    });
  }, []);

  const handleMouseLeave = React.useCallback(() => {
    if (!ref.current || persistent) return;
    ref.current.style.setProperty("--mouse-x", `-200px`);
    ref.current.style.setProperty("--mouse-y", `-200px`);
  }, [persistent]);

  React.useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "relative overflow-hidden rounded-2xl bg-white ring-1 ring-hairline shadow-card transition-all duration-300 ease-apple hover:shadow-card-hover dark:bg-ink-900 dark:ring-ink-800",
        className,
      )}
      style={
        {
          ...style,
          "--mouse-x": "-200px",
          "--mouse-y": "-200px",
          "--spotlight-color": spotlightColor,
          "--spotlight-radius": radius,
        } as React.CSSProperties
      }
      {...props}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `radial-gradient(${radius} circle at var(--mouse-x) var(--mouse-y), ${spotlightColor}, transparent 70%)`,
          opacity: 1,
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
