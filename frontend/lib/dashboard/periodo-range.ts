/**
 * R152kk — Ventana de período del dashboard (`?from=YYYY-MM&to=YYYY-MM`).
 *
 * El `PeriodoFilter` escribía from/to en la URL desde siempre pero ningún
 * endpoint los consumía: el control cambiaba la URL y ni una cifra
 * (audit `docs/audits/AUDIT_dashboard_2026-07-06.md` · F1 · P1).
 *
 * Ahora el backend los acepta. Estos helpers son la otra mitad: derivan de
 * los filtros cuántos meses cubre la ventana para que las etiquetas de la UI
 * digan la verdad ("del mes" vs "de los últimos 12 meses") en vez de hablar
 * siempre del mes en curso.
 */
import type { DashboardFilters } from "./use-dashboard-filters";

const YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Tope duro: coincide con MAX_MESES_RANGO del backend. */
export const MAX_MESES_RANGO = 36;

function ymToIndex(ym: string | null): number | null {
  if (!ym) return null;
  const m = YM_RE.exec(ym.trim());
  if (!m) return null;
  return Number(m[1]) * 12 + Number(m[2]) - 1;
}

/**
 * Cantidad de meses que cubre el rango, o `null` si no hay rango usable
 * (sin from/to, o mal formados → el backend cae a su default).
 */
export function mesesEnRango(
  from: string | null,
  to: string | null,
): number | null {
  const ini = ymToIndex(from);
  const fin = ymToIndex(to);
  if (ini === null || fin === null) return null;
  const largo = Math.abs(fin - ini) + 1;
  return Math.min(largo, MAX_MESES_RANGO);
}

/** `true` si el usuario eligió una ventana explícita en el PeriodoFilter. */
export function tieneRango(filters: DashboardFilters): boolean {
  return mesesEnRango(filters.from, filters.to) !== null;
}

/**
 * Sufijo para etiquetas de KPI mensuales: "del mes" / "del período".
 * Un rango de 1 mes sigue siendo un mes, sólo que no necesariamente el actual.
 */
export function sufijoVentana(filters: DashboardFilters): string {
  const meses = mesesEnRango(filters.from, filters.to);
  if (meses === null) return "del mes";
  if (meses === 1) return "del período";
  return `de ${meses} meses`;
}

/** Etiqueta comparativa: "vs. mes anterior" / "vs. período anterior". */
export function sufijoComparacion(filters: DashboardFilters): string {
  const meses = mesesEnRango(filters.from, filters.to);
  if (meses === null || meses === 1) return "vs. mes anterior";
  return `vs. ${meses} meses previos`;
}

/**
 * Descripción de la ventana para los subtítulos de los charts.
 * Sin rango: el default histórico de cada serie ("Últimos 12 meses").
 */
export function etiquetaVentana(
  filters: DashboardFilters,
  fallback = "Últimos 12 meses",
): string {
  const meses = mesesEnRango(filters.from, filters.to);
  if (meses === null) return fallback;
  if (filters.from && filters.to && filters.from !== filters.to) {
    return `${filters.from} → ${filters.to}`;
  }
  return filters.to ?? filters.from ?? fallback;
}

/**
 * Querystring de filtros + `meses` sólo cuando NO hay rango explícito
 * (con rango, `meses` es redundante y el backend lo recalcula).
 */
export function chartQueryString(
  filters: DashboardFilters,
  extra?: Record<string, string | number | undefined>,
): string {
  const parts: string[] = [];
  if (filters.empresa)
    parts.push(`empresa_codigo=${encodeURIComponent(filters.empresa)}`);
  const conRango = tieneRango(filters);
  if (conRango) {
    if (filters.from) parts.push(`from=${encodeURIComponent(filters.from)}`);
    if (filters.to) parts.push(`to=${encodeURIComponent(filters.to)}`);
  }
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v === undefined) continue;
    if (k === "meses" && conRango) continue;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}
