"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";

interface SidebarStateResponse {
  unread_notifications: number;
  critical_obligations: number;
  critical_entregables: number;
  mailbox_pending: number;
  // V5++ ola AT — vouchers pending por user
  voucher_drafts_mine?: number;
  voucher_pending_approvals?: number;
}

/**
 * useSidebarState — endpoint composite que reemplaza las 4 queries
 * individuales que el sidebar hacía antes (notifications, obligations,
 * entregables, mailbox).
 *
 * Backend hace asyncio.gather de las 4 counts en una sola request.
 * Latencia: ~250ms total vs ~1.8s de las 4 paralelas con TLS handshake
 * separado.
 *
 * Polling: 60s. SSE invalida queries específicas cuando cambia algo.
 */
export function useSidebarState() {
  const { session, loading } = useSession();

  return useQuery<SidebarStateResponse, Error>({
    queryKey: ["me", "sidebar-state"],
    queryFn: () =>
      apiClient.get<SidebarStateResponse>("/me/sidebar-state", session),
    enabled: !loading && !!session,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 0,
    placeholderData: () => ({
      unread_notifications: 0,
      critical_obligations: 0,
      critical_entregables: 0,
      mailbox_pending: 0,
      voucher_drafts_mine: 0,
      voucher_pending_approvals: 0,
    }),
  });
}
