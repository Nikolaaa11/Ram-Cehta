"use client";

/**
 * CountUp — anima un número de 0 (o un valor inicial) hasta `end` con
 * easing cubic. Sin dependencias externas (Framer Motion sería overkill
 * para esto).
 *
 * Usado en el hero del informe LP para que el número grande "se construya"
 * cuando el LP entra a la página.
 */
import { useEffect, useRef, useState } from "react";

interface Props {
  end: number;
  start?: number;
  duration?: number; // ms
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function formatNumber(n: number, decimals: number): string {
  if (decimals === 0) {
    return Math.round(n).toLocaleString("es-CL");
  }
  return n.toLocaleString("es-CL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function CountUp({
  end,
  start = 0,
  duration = 1500,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
}: Props) {
  const [value, setValue] = useState(start);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    startTimeRef.current = null;

    const tick = (now: number) => {
      if (startTimeRef.current === null) startTimeRef.current = now;
      const elapsed = now - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      const current = start + (end - start) * eased;
      setValue(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [end, start, duration]);

  return (
    <span className={className}>
      {prefix}
      {formatNumber(value, decimals)}
      {suffix}
    </span>
  );
}
