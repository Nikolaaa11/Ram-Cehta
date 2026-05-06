"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";

interface MailboxStatus {
  imap_configured: boolean;
  imap_user: string | null;
  anthropic_enabled: boolean;
  resend_enabled: boolean;
  dropbox_enabled: boolean;
  last_received_at: string | null;
  counts_by_status: Record<string, number>;
  counts_by_category: Record<string, number>;
}

/**
 * useMailboxPendingCount — badge sidebar.
 *
 * Cuenta emails con status='received' o 'classified' (los que necesitan
 * revisión humana). Polling de 60s — el cron de inbox corre cada 15min,
 * así que 60s es más que suficiente para no demorar la UX.
 *
 * Soft-fail: si el endpoint devuelve error (backend down, IMAP no
 * configurado), el badge muestra 0 sin romper la sidebar.
 */
export function useMailboxPendingCount() {
  const { session, loading } = useSession();
  const query = useQuery<MailboxStatus, Error>({
    queryKey: ["mailbox", "status"],
    queryFn: () =>
      apiClient.get<MailboxStatus>("/admin/mailbox/status", session),
    enabled: !loading && !!session,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 0, // no spam logs si IMAP no está configurado
  });

  const data = query.data;
  const pending =
    (data?.counts_by_status?.received ?? 0) +
    (data?.counts_by_status?.classified ?? 0);

  return {
    pending,
    imapConfigured: data?.imap_configured ?? false,
    isLoading: query.isLoading,
  };
}

/**
 * useMailboxPrefetch — calienta cache TanStack al hacer hover/focus en
 * el link del sidebar. Cuando el user clickea, la lista ya está lista.
 *
 * Idempotente: si ya hay datos frescos en cache, no hace nada.
 */
export function useMailboxPrefetch() {
  const { session } = useSession();
  const qc = useQueryClient();
  return () => {
    qc.prefetchQuery({
      queryKey: ["mailbox", "", ""],
      queryFn: () => apiClient.get("/admin/mailbox", session),
      staleTime: 30_000,
    });
    qc.prefetchQuery({
      queryKey: ["mailbox", "status"],
      queryFn: () => apiClient.get("/admin/mailbox/status", session),
      staleTime: 30_000,
    });
  };
}
