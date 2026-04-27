"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";

/**
 * Hook compartido para fetching de endpoints del dashboard.
 *
 * - Espera a que la sesión termine de cargar (`!sessionLoading`).
 * - Solo dispara la query si hay sesión y `enabled !== false`.
 * - `staleTime` por defecto: 60s — los charts no requieren freshness sub-minuto.
 * - Acepta `initialData` para SSR-hidratación; sin él, la query parte en
 *   `loading` hasta que la sesión esté lista.
 */
export function useDashboardQuery<T>(
  queryKey: readonly unknown[],
  path: string,
  options?: { enabled?: boolean; staleTime?: number; initialData?: T },
) {
  const { session, loading: sessionLoading } = useSession();
  return useQuery<T, Error>({
    queryKey: queryKey as unknown[],
    queryFn: () => apiClient.get<T>(path, session),
    enabled: !sessionLoading && (options?.enabled ?? true) && !!session,
    staleTime: options?.staleTime ?? 60_000,
    initialData: options?.initialData,
  });
}
