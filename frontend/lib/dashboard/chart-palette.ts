/**
 * Paleta unificada para charts del dashboard. Inspirada en SF Symbols /
 * Apple Health: cehta-green primero, luego sf-blue/purple/orange/etc.
 */
export const APPLE_PALETTE = [
  "#1d6f42", // cehta-green
  "#0a84ff", // sf-blue
  "#5e5ce6", // sf-purple
  "#ff9500", // warning / orange
  "#34c759", // positive / green
  "#ff3b30", // negative / red
  "#64d2ff", // sf-teal
  "#bf5af2", // pink-purple
  "#ff453a", // bright red
  "#a1a1a6", // ink-300 (fallback gris)
] as const;

export type AppleColor = (typeof APPLE_PALETTE)[number];

export function colorAt(index: number): AppleColor {
  // index % length siempre cae dentro del arreglo; el `!` es seguro.
  return APPLE_PALETTE[index % APPLE_PALETTE.length]!;
}
