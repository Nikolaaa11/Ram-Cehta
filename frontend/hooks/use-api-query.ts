"use client";

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

/**
 * Factory hook for GET requests via TanStack Query.
 *
 * R152ww — DEFAULT staleTime 30s + gcTime 5min.
 *
 * Antes: default TanStack era staleTime: 0 → refetch en CADA focus de
 * ventana y CADA mount. En una app con 245+ useQuery, eso era
 * dispendio neto de bandwidth y server load.
 *
 * Ahora: 30s default es "datos relativamente frescos pero no spammeamos
 * el backend cuando el user cambia de tab y vuelve". Pages que necesitan
 * data muy fresca (incidents live, p.ej.) pueden override con opts:
 *
 *   useApiQuery(key, path, true, { staleTime: 5_000 })  // 5s
 *
 * Pages que tienen data muy estable (catálogos, plan de cuentas) ya
 * usan hooks dedicados con staleTime largo (30min).
 *
 * @param key   - Query key (string or array)
 * @param path  - Relative API path, e.g. "/proveedores?page=1&size=20"
 * @param enabled - Optional flag to disable the query (default: true)
 * @param opts  - Optional extra react-query options. Common usage:
 *                { staleTime: number, gcTime: number, refetchOnWindowFocus: boolean }
 */
export function useApiQuery<T>(
  key: string | string[],
  path: string,
  enabled?: boolean,
  opts?: Omit<
    UseQueryOptions<T, Error>,
    "queryKey" | "queryFn" | "enabled"
  >,
) {
  const { session, loading } = useSession();

  return useQuery<T, Error>({
    queryKey: Array.isArray(key) ? key : [key],
    queryFn: () => apiClient.get<T>(path, session),
    enabled: !loading && (enabled ?? true),
    // R152ww — defaults sensibles. Override via opts si la page necesita
    // comportamiento distinto (ej. realtime widget con staleTime: 0).
    staleTime: 30 * 1000, // 30 segundos
    gcTime: 5 * 60 * 1000, // 5 minutos en cache antes de garbage-collect
    refetchOnWindowFocus: false, // no refetch al cambiar tab del browser
    ...opts,
  });
}
