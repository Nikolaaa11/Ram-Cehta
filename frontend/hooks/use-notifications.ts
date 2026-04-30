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
 * Con SSE activo (V4 fase 2), el backend pushea `notification.created` y
 * `notification.read` que invalidan esta query inmediatamente. El polling
 * de fallback bajó de 60s a 5min — mantiene el contador fresco si el SSE
 * cae sin que el usuario lo note y nos protege contra eventos perdidos
 * durante reconexión.
 */
export function useUnreadCount() {
  const { session, loading } = useSession();
  return useQuery<UnreadCount, Error>({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => apiClient.get<UnreadCount>("/inbox/unread-count", session),
    enabled: !loading && !!session,
    refetchInterval: 5 * 60_000,
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
