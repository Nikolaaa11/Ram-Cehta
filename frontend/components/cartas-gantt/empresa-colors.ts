/**
 * Paleta consistente por empresa — usada en TaskCards, calendar chips, timeline bars.
 *
 * 9 colores distinguibles entre sí, balanceados en luminosidad para que
 * todos sean legibles con texto blanco encima.
 */
export const EMPRESA_COLOR: Record<string, string> = {
  RHO: "#06b6d4", // cyan
  TRONGKAI: "#8b5cf6", // purple
  EVOQUE: "#10b981", // emerald
  DTE: "#6366f1", // indigo
  REVTECH: "#f59e0b", // amber
  AFIS: "#ec4899", // pink
  CENERGY: "#84cc16", // lime
  CSL: "#0ea5e9", // sky
  FIP_CEHTA: "#64748b", // slate
};

export function colorFor(empresaCodigo: string): string {
  return EMPRESA_COLOR[empresaCodigo.toUpperCase()] ?? "#94a3b8";
}
