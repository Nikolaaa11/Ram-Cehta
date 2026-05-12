"use client";

/**
 * AnimatedCounter — número que crece desde 0 hasta el valor final.
 *
 * Apple-style ease (easeOutExpo). Sólo se anima la primera vez que entra
 * al viewport — IntersectionObserver. Respeta `prefers-reduced-motion`.
 *
 * Uso típico:
 *   <AnimatedCounter value={1234567} format={toCLPCompact} />
 *   <AnimatedCounter value={45.6} format={(n) => `${n.toFixed(1)}%`} />
 *
 * Si `value` cambia después del primer mount, anima el delta (de oldValue → newValue).
 */
import * as React from "react";

export interface AnimatedCounterProps {
  /** Valor objetivo. */
  value: number;
  /** Formateador. Debe aceptar number y devolver string. */
  format?: (n: number) => string;
  /** Duración en ms. Default 1100. */
  duration?: number;
  /** Si true, dispara la animación cuando entra al viewport. Default true. */
  triggerOnView?: boolean;
  className?: string;
  /** Forzar render server-safe (sin animar) cuando se quiera. */
  staticOnly?: boolean;
}

// easeOutExpo — Apple eases, salta rápido al inicio y desacelera al final
function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function AnimatedCounter({
  value,
  format = (n) => n.toLocaleString("es-CL"),
  duration = 1100,
  triggerOnView = true,
  className,
  staticOnly = false,
}: AnimatedCounterProps) {
  const [display, setDisplay] = React.useState(value);
  const [hasAnimated, setHasAnimated] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);
  const fromRef = React.useRef(0);

  // Detectar reduced-motion
  const prefersReducedMotion = React.useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  React.useEffect(() => {
    if (staticOnly || prefersReducedMotion) {
      setDisplay(value);
      return;
    }

    const animate = (from: number, to: number) => {
      const start = performance.now();
      let rafId: number;
      const tick = (now: number) => {
        const elapsed = now - start;
        const t = Math.min(elapsed / duration, 1);
        const eased = easeOutExpo(t);
        setDisplay(from + (to - from) * eased);
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          setDisplay(to);
        }
      };
      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    };

    if (!triggerOnView) {
      const cleanup = animate(fromRef.current, value);
      fromRef.current = value;
      setHasAnimated(true);
      return cleanup;
    }

    // Si ya animó una vez y value cambió → animar delta
    if (hasAnimated) {
      const cleanup = animate(fromRef.current, value);
      fromRef.current = value;
      return cleanup;
    }

    // Primera animación — esperar a estar en viewport
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          const cleanup = animate(0, value);
          fromRef.current = value;
          setHasAnimated(true);
          observer.disconnect();
          return cleanup;
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, prefersReducedMotion, staticOnly, triggerOnView]);

  return (
    <span ref={ref} className={className}>
      {format(display)}
    </span>
  );
}
