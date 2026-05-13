"use client";

/**
 * Hooks de catálogos — única fuente de verdad para selects (Disciplina 1).
 *
 * Antes había arrays `EMPRESAS = ["TRONGKAI", ...]` hardcodeados en cada
 * página. Ahora todo viene de `core.empresas` (backend) vía `/catalogos/empresas`.
 *
 * staleTime largo: las empresas del portfolio cambian ~1/año. No tiene
 * sentido refetchear cada 2 min default. 30 min es el sweet spot: el
 * backend ya manda Cache-Control de 5 min, y este staleTime de 30 min
 * evita queries cruzadas entre pages que ya hicieron fetch.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { EmpresaCatalogo } from "@/lib/api/schema";

export type { EmpresaCatalogo };

const CATALOGO_STALE_TIME = 30 * 60_000; // 30 min

export const useCatalogoEmpresas = () => {
  const { session, loading } = useSession();
  return useQuery<EmpresaCatalogo[], Error>({
    queryKey: ["catalogo", "empresas"],
    queryFn: () => apiClient.get<EmpresaCatalogo[]>("/catalogos/empresas", session),
    enabled: !loading,
    staleTime: CATALOGO_STALE_TIME,
    gcTime: CATALOGO_STALE_TIME * 2,
  });
};
