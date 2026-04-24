"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

/**
 * Factory hook for GET requests via TanStack Query.
 *
 * @param key   - Query key (string or array)
 * @param path  - Relative API path, e.g. "/proveedores?page=1&size=20"
 * @param enabled - Optional flag to disable the query (default: true)
 */
export function useApiQuery<T>(
  key: string | string[],
  path: string,
  enabled?: boolean
) {
  const { session, loading } = useSession();

  return useQuery<T, Error>({
    queryKey: Array.isArray(key) ? key : [key],
    queryFn: () => apiClient.get<T>(path, session),
    enabled: !loading && (enabled ?? true),
  });
}
