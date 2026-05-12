/**
 * GradientMesh — fondo decorativo con 3 radial-gradients sutiles.
 *
 * Server component. Sin "use client" para evitar payload JS innecesario.
 * Usa CSS puro (`.gradient-mesh` o `.gradient-mesh-animated`) definido en
 * globals.css.
 *
 * Casos de uso:
 *   - Hero del dashboard
 *   - Página de login (con `animated`)
 *   - Estados vacíos con CTA
 *
 * El componente NO impone tamaño — el caller decide via `className` (h-64,
 * absolute inset-0, etc.).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface GradientMeshProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Si true, anima el mesh con drift suave 18s. Default false. */
  animated?: boolean;
  /** Variante semantizada — cambia paleta. */
  tone?: "default" | "premium" | "subtle";
}

export function GradientMesh({
  animated = false,
  tone = "default",
  className,
  children,
  ...props
}: GradientMeshProps) {
  const base = animated ? "gradient-mesh-animated" : "gradient-mesh";
  const toneClass =
    tone === "premium"
      ? "gradient-mesh-premium"
      : tone === "subtle"
        ? "gradient-mesh-subtle"
        : "";

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 -z-10",
        base,
        toneClass,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
