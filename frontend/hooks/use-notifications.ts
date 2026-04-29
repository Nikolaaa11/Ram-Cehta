"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";
import type {
  Notification,
  Page,
  UnreadCount,
} from "@/lib/api/schema";

/**
 * useUnreadCount — bell badge.
 *
 * Refetcha cada 60s para mantener el contador fresco. Si el usuario no
 * está autenticado todavía, queda en idle.
 */
export function useUnreadCount() {
  const { session, loading } = useSession();
  return useQuery<UnreadCount, Error>({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => apiClient.get<UnreadCount>("/inbox/unread-count", session),
    enabled: !loading && !!session,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * useNotificationsFeed — feed paginado.
 *
 * Para la fase 8 alcanza con paginación simple (page + size). Si en el
 * futuro queremos infinite scroll en /notificaciones, migramos a
 * `useInfiniteQuery`.
 */
export function useNotificationsFeed(
  unreadOnly: boolean = false,
  page: number = 1,
  size: number = 20,
) {
  const { session, loading } = useSession();
  const path = `/inbox?unread=${unreadOnly}&page=${page}&size=${size}`;
  return useQuery<Page<Notification>, Error>({
    queryKey: ["notifications", "feed", { unreadOnly, page, size }],
    queryFn: () => apiClient.get<Page<Notification>>(path, session),
    enabled: !loading && !!session,
    staleTime: 30_000,
  });
}

export function useMarkRead() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<Notification, Error, string>({
    mutationFn: (id: string) =>
      apiClient.post<Notification>(`/inbox/${id}/read`, {}, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllRead() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<{ updated: number }, Error, void>({
    mutationFn: () =>
      apiClient.post<{ updated: number }>("/inbox/mark-all-read", {}, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
