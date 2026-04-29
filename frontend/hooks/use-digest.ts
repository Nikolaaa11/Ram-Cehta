"use client";

/**
 * Hooks para CEO Weekly Digest (V3 fase 10).
 *
 *   useDigestPreview() — TQ query de `/digest/ceo-weekly/preview`
 *   useSendDigest()    — mutation a `/digest/ceo-weekly/send-now`
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";

export interface EmpresaDigestRow {
  codigo: string;
  razon_social: string;
  health_score: number;
  saldo_actual: number;
  flujo_7d: number;
  oc_pendientes: number;
  f29_vencidas: number;
  delta_health: number;
}

export interface DigestAlert {
  tipo: string;
  severity: "critical" | "warning" | "info";
  title: string;
  body: string;
  link?: string | null;
}

export interface MovimientoDigestRow {
  fecha: string;
  empresa_codigo: string;
  descripcion: string;
  monto: number;
  tipo: "abono" | "egreso";
}

export interface CEODigestPayload {
  generated_at: string;
  period_from: string;
  period_to: string;
  top_kpis: Record<string, number | string>;
  empresas: EmpresaDigestRow[];
  alerts: DigestAlert[];
  movimientos_significativos: MovimientoDigestRow[];
  vs_prev_week: Record<string, number | string>;
}

export interface DigestSendRequest {
  recipients?: string[];
}

export interface DigestSendResult {
  sent: number;
  failed: string[];
  preview_url?: string | null;
}

export function useDigestPreview() {
  const { session, loading } = useSession();
  return useQuery<CEODigestPayload, Error>({
    queryKey: ["digest", "preview"],
    queryFn: () =>
      apiClient.get<CEODigestPayload>("/digest/ceo-weekly/preview", session),
    enabled: !loading && !!session,
    staleTime: 60_000,
  });
}

export function useSendDigest() {
  const { session } = useSession();
  return useMutation<DigestSendResult, Error, DigestSendRequest>({
    mutationFn: (body) =>
      apiClient.post<DigestSendResult>(
        "/digest/ceo-weekly/send-now",
        body,
        session,
      ),
  });
}
