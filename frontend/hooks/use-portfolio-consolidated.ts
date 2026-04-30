"use client";

/**
 * Portfolio Consolidado USD — V4 fase 4.
 *
 * TanStack Query hook para `/portfolio/consolidated`. Devuelve los saldos
 * cross-empresa convertidos a CLP/USD/UF + breakdown por moneda + trend
 * 12 meses + warnings cuando alguna conversión no está disponible.
 *
 * staleTime 5 min: los saldos no cambian intra-día (los movimientos se
 * cargan via ETL nocturno) y la conversión a USD usa la tasa cacheada
 * del día. Refetch each 5 min es más que suficiente.
 */

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";
import type { PortfolioConsolidated } from "@/lib/api/schema";

const KEY = "portfolio-consolidated";

export function usePortfolioConsolidated() {
  const { session, loading } = useSession();
  return useQuery<PortfolioConsolidated, Error>({
    queryKey: [KEY],
    queryFn: () =>
      apiClient.get<PortfolioConsolidated>(
        "/portfolio/consolidated",
        session,
      ),
    enabled: !loading && !!session,
    staleTime: 5 * 60 * 1000, // 5 min
    gcTime: 30 * 60 * 1000, // 30 min
  });
}
