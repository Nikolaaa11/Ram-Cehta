"use client";

/**
 * Hook reusable para obtener el feed de Upcoming Tasks.
 *
 * Endpoint: GET /avance/portfolio/upcoming-tasks?empresa=&encargado=
 *
 * Cache: 5 minutos (los buckets cambian seguido pero no tan rápido).
 * Reusado por: SecretariaPanel, UpcomingTasksKanban, CalendarHitos.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { UpcomingTasksResponse } from "@/lib/api/schema";

export interface UpcomingTasksFilters {
  empresa?: string;
  encargado?: string;
}

export function useUpcomingTasks(filters?: UpcomingTasksFilters) {
  const { session, loading } = useSession();

  // Construir query string solo con valores definidos
  const qs = new URLSearchParams();
  if (filters?.empresa) qs.set("empresa", filters.empresa);
  if (filters?.encargado) qs.set("encargado", filters.encargado);
  const queryString = qs.toString();

  return useQuery<UpcomingTasksResponse, Error>({
    queryKey: ["avance", "upcoming-tasks", filters?.empresa ?? null, filters?.encargado ?? null],
    queryFn: () =>
      apiClient.get<UpcomingTasksResponse>(
        `/avance/portfolio/upcoming-tasks${queryString ? "?" + queryString : ""}`,
        session,
      ),
    enabled: !loading,
    staleTime: 5 * 60 * 1000,
  });
}
