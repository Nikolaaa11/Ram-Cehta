"use client";

/**
 * R152DDDD · Hook ligero para el badge sidebar de cuotas pendientes.
 *
 * Endpoint GET /ordenes-compra/cuotas/resumen devuelve 5 contadores:
 *   total_pendientes, vencidas, proximas_7_dias, proximas_30_dias,
 *   monto_total_pendiente.
 *
 * staleTime 60s para no saturar — el badge no necesita realtime.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

export interface CuotasResumen {
  total_pendientes: number;
  vencidas: number;
  proximas_7_dias: number;
  proximas_30_dias: number;
  monto_total_pendiente: string;
}

export function useCuotasResumen() {
  const { session } = useSession();
  return useQuery<CuotasResumen>({
    queryKey: ["cuotas-resumen"],
    queryFn: () =>
      apiClient.get<CuotasResumen>(
        "/ordenes-compra/cuotas/resumen",
        session,
      ),
    enabled: !!session,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
