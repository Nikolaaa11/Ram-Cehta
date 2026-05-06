"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";

/**
 * useF22Prefetch — prefetch hover en sidebar para acelerar primer click.
 * Trae las primeras 50 declaraciones (sin filtros) para que la página
 * F22 abra instantánea con datos en cache.
 */
export function useF22Prefetch() {
  const { session } = useSession();
  const qc = useQueryClient();
  return () => {
    qc.prefetchQuery({
      queryKey: ["f22", "", "", 1],
      queryFn: () =>
        apiClient.get(`/f22?size=50&page=1`, session),
      staleTime: 30_000,
    });
  };
}
