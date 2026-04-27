/**
 * Query keys factory para dashboard. Todas las claves descienden de
 * `dashboardKeys.all` para invalidación masiva con un solo `invalidateQueries`.
 */
import type { DashboardFilters } from "./use-dashboard-filters";

export const dashboardKeys = {
  all: ["dashboard"] as const,
  kpis: (filters: DashboardFilters) =>
    [...dashboardKeys.all, "kpis", filters] as const,
  cashflow: (filters: DashboardFilters) =>
    [...dashboardKeys.all, "cashflow", filters] as const,
  egresoConceptos: (filters: DashboardFilters) =>
    [...dashboardKeys.all, "egreso-conceptos", filters] as const,
  egresosPorConcepto: (filters: DashboardFilters) =>
    [...dashboardKeys.all, "egreso-conceptos", filters] as const,
  saldosPorEmpresa: (filters: DashboardFilters) =>
    [...dashboardKeys.all, "saldos", filters] as const,
  iva: (filters: DashboardFilters) =>
    [...dashboardKeys.all, "iva", filters] as const,
  ivaTrend: (filters: DashboardFilters) =>
    [...dashboardKeys.all, "iva", filters] as const,
  proyectos: (filters: DashboardFilters) =>
    [...dashboardKeys.all, "proyectos", filters] as const,
  movimientos: (filters: DashboardFilters) =>
    [...dashboardKeys.all, "movimientos", filters] as const,
  projectsRanking: (filters?: DashboardFilters) =>
    [...dashboardKeys.all, "proyectos-ranking", filters ?? {}] as const,
  recentActivity: () =>
    [...dashboardKeys.all, "movimientos-recientes"] as const,
};

/**
 * Construye un querystring a partir de los filtros, omitiendo nulos/vacíos.
 * Para uso en endpoints `?empresa_codigo=X&from=YYYY-MM&to=YYYY-MM`.
 */
export function filtersToQueryString(filters: DashboardFilters): string {
  const parts: string[] = [];
  if (filters.empresa) parts.push(`empresa_codigo=${encodeURIComponent(filters.empresa)}`);
  if (filters.from) parts.push(`from=${encodeURIComponent(filters.from)}`);
  if (filters.to) parts.push(`to=${encodeURIComponent(filters.to)}`);
  return parts.length ? `?${parts.join("&")}` : "";
}
