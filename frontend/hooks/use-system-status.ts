"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

// Tipos definidos a mano para evitar circular regen del openapi types.
// Espejo de `app.schemas.status`.

export type CheckState = "ok" | "degraded" | "down" | "disabled" | "unknown";

export interface IntegrationCheck {
  name: string;
  state: CheckState;
  detail?: string | null;
  latency_ms?: number | null;
  last_checked_at: string;
}

export interface OperationalMetric {
  label: string;
  value: string;
  hint?: string | null;
}

export interface SystemStatus {
  generated_at: string;
  overall: CheckState;
  checks: IntegrationCheck[];
  metrics: OperationalMetric[];
}

/**
 * Hook que pega `GET /admin/status` con auto-refresh cada 30s.
 *
 * Diseñado para que el dashboard se mantenga "vivo" mientras el admin lo
 * mira: cada 30s revisa Postgres + métricas; los checks pasivos por
 * presence-of-secret no cambian, pero las métricas (notifs sin leer,
 * última ETL) sí.
 */
export function useSystemStatus() {
  const { session, loading: sessionLoading } = useSession();
  return useQuery<SystemStatus, Error>({
    queryKey: ["system-status"],
    queryFn: () => apiClient.get<SystemStatus>("/admin/status", session),
    enabled: !sessionLoading,
    refetchInterval: 30_000,
    staleTime: 25_000,
  });
}
