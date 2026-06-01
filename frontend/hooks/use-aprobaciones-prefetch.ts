"use client";

/**
 * useAprobacionesPrefetch — calienta el cache de /vouchers/mis-pendientes
 * al hacer hover/focus sobre el item "Aprobaciones" del sidebar (R152iii).
 *
 * La query de /aprobaciones es ~100ms en buen escenario, pero en horarios
 * pico (cierre mensual) puede tomar más. Prefetch en hover hace que cuando
 * el usuario haga click, la lista aparezca instantáneo.
 */
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

export function useAprobacionesPrefetch() {
  const qc = useQueryClient();
  const { session } = useSession();

  return () => {
    if (!session) return;
    qc.prefetchQuery({
      queryKey: ["vouchers", "mis-pendientes"],
      queryFn: () => apiClient.get("/vouchers/mis-pendientes", session),
      staleTime: 30_000,
    });
  };
}
