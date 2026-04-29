/**
 * Paleta de colores reutilizable para el dashboard rico por empresa.
 *
 * Mantiene consistencia entre donut, treemap y badges de la tabla de
 * Composición Completa CC. Los colores hex coinciden con los que el
 * backend serializa en `egresos-por-tipo` (server-decidido) y con la
 * paleta global del dashboard portafolio (`@/lib/dashboard/chart-palette`).
 */

import { APPLE_PALETTE } from "@/lib/dashboard/chart-palette";

export { APPLE_PALETTE };

/** Tipos contables que el backend etiqueta en `composicion[].tipo`. */
export type ComposicionTipo =
  | "Capital"
  | "Tesoreria"
  | "Ajuste"
  | "Operacional"
  | "Financiero"
  | "Otros";

interface TipoBadgeStyle {
  /** Clases Tailwind para el badge de la columna "Tipo". */
  badge: string;
  /** Clase Tailwind para el dot de color al lado del nombre de la categoría. */
  dot: string;
  /** Hex equivalente para charts/inline-styles cuando hace falta. */
  hex: string;
  /** Etiqueta legible en español. */
  label: string;
}

export const TIPO_STYLES: Record<ComposicionTipo, TipoBadgeStyle> = {
  Capital: {
    badge: "bg-cehta-green/10 text-cehta-green",
    dot: "bg-cehta-green",
    hex: "#1d6f42",
    label: "Capital",
  },
  Tesoreria: {
    badge: "bg-sf-blue/10 text-sf-blue",
    dot: "bg-sf-blue",
    hex: "#0a84ff",
    label: "Tesorería",
  },
  Ajuste: {
    badge: "bg-ink-100/60 text-ink-500",
    dot: "bg-ink-300",
    hex: "#a1a1a6",
    label: "Ajuste",
  },
  Financiero: {
    badge: "bg-sf-purple/10 text-sf-purple",
    dot: "bg-sf-purple",
    hex: "#5e5ce6",
    label: "Financiero",
  },
  Operacional: {
    badge: "bg-warning/10 text-warning",
    dot: "bg-warning",
    hex: "#ff9500",
    label: "Operacional",
  },
  Otros: {
    badge: "bg-ink-100/60 text-ink-700",
    dot: "bg-ink-300",
    hex: "#a1a1a6",
    label: "Otros",
  },
};

/** Devuelve el estilo del tipo, con fallback a "Otros". */
export function tipoStyle(tipo: string): TipoBadgeStyle {
  if (tipo in TIPO_STYLES) {
    return TIPO_STYLES[tipo as ComposicionTipo];
  }
  return TIPO_STYLES.Otros;
}

/** Color para el signo del neto: positivo, negativo o cero. */
export function netoTone(value: number): {
  className: string;
  prefix: string;
} {
  if (value > 0) return { className: "text-positive", prefix: "+" };
  if (value < 0) return { className: "text-negative", prefix: "" };
  return { className: "text-ink-500", prefix: "" };
}
