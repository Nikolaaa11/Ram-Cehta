"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { ObligationItem, ObligationTipo } from "@/lib/api/schema";

export interface ObligationFilters {
  empresa_codigo?: string | null;
  tipo?: ObligationTipo | null;
  from_date?: string | null;
  to_date?: string | null;
}

function buildPath(filters: ObligationFilters): string {
  const params = new URLSearchParams();
  if (filters.empresa_codigo)
    params.set("empresa_codigo", filters.empresa_codigo);
  if (filters.tipo) params.set("tipo", filters.tipo);
  if (filters.from_date) params.set("from_date", filters.from_date);
  if (filters.to_date) params.set("to_date", filters.to_date);
  const qs = params.toString();
  return `/calendar/obligations${qs ? `?${qs}` : ""}`;
}

/**
 * Hook para `/calendar/obligations` (V3 fase 9).
 *
 * Refetcha al volver al foco de la pestaña, staleTime 5min.
 */
export function useObligations(filters: ObligationFilters = {}) {
  const { session, loading } = useSession();
  const path = buildPath(filters);
  return useQuery<ObligationItem[], Error>({
    queryKey: ["calendar", "obligations", filters],
    queryFn: () => apiClient.get<ObligationItem[]>(path, session),
    enabled: !loading && !!session,
    staleTime: 5 * 60 * 1000, // 5 min
    refetchOnWindowFocus: true,
  });
}

/**
 * Conveniencia: count de obligaciones críticas (vencidas) — usado por el
 * badge del sidebar. Reusa el mismo cache de `useObligations`.
 */
export function useCriticalObligationsCount(): number {
  const { data } = useObligations();
  if (!data) return 0;
  return data.filter((o) => o.severity === "critical").length;
}
