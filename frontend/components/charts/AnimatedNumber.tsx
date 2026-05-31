"use client";

/**
 * AnimatedNumber — número que cuenta desde 0 hasta el target (R152bb).
 *
 * Usa requestAnimationFrame con easing apple-cubic-bezier para una
 * sensación premium. Soporta CLP, USD, UF, %, plain.
 *
 * Reemplaza directamente cualquier <span>{value}</span> en KPIs.
 */
import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  /** "clp" | "usd" | "uf" | "pct" | "int" | "decimal" */
  format?: "clp" | "usd" | "uf" | "pct" | "int" | "decimal";
  /** Duración en ms (default 1100) */
  duration?: number;
  /** Decimals para format=decimal */
  decimals?: number;
  /** Sufijo opcional (ej "%", "MM", "días") */
  suffix?: string;
  /** Prefijo opcional (ej "$") */
  prefix?: string;
  className?: string;
}

// Easing apple cubic-bezier(0.16, 1, 0.3, 1) — entra rápido, frena suave
function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function format(n: number, fmt: Props["format"], decimals: number): string {
  if (fmt === "clp") return `$${Math.round(n).toLocaleString("es-CL")}`;
  if (fmt === "usd")
    return `US$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (fmt === "uf")
    return `UF ${n.toLocaleString("es-CL", { maximumFractionDigits: 2 })}`;
  if (fmt === "pct") return `${n.toFixed(decimals)}%`;
  if (fmt === "decimal")
    return n.toLocaleString("es-CL", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  return Math.round(n).toLocaleString("es-CL");
}

export function AnimatedNumber({
  value,
  format: fmt = "int",
  duration = 1100,
  decimals = 1,
  suffix = "",
  prefix = "",
  className,
}: Props) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);
  const toRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = display;
    toRef.current = value;
    startRef.current = null;

    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeOutExpo(t);
      const current = fromRef.current + (toRef.current - fromRef.current) * eased;
      setDisplay(current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(toRef.current);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return (
    <span className={className}>
      {prefix}
      {format(display, fmt, decimals)}
      {suffix}
    </span>
  );
}
