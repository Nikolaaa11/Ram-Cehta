"use client";

/**
 * Saved Views — V3 fase 11.
 *
 * Hooks TanStack Query para listar, crear, actualizar, borrar y togglear
 * pin de vistas guardadas. Cada vista vive bajo `/me/views` (namespace
 * user-scoped) y solo el usuario dueño puede verlas / mutarlas.
 *
 * Las mutaciones invalidan `["saved-views", page]` para refrescar el
 * dropdown automáticamente.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";
import type {
  SavedViewCreate,
  SavedViewPage,
  SavedViewRead,
  SavedViewUpdate,
} from "@/lib/api/schema";

const KEY = "saved-views";

export function useSavedViews(page: SavedViewPage) {
  const { session, loading } = useSession();
  return useQuery<SavedViewRead[], Error>({
    queryKey: [KEY, page],
    queryFn: () =>
      apiClient.get<SavedViewRead[]>(
        `/me/views?page=${encodeURIComponent(page)}`,
        session,
      ),
    enabled: !loading && !!session,
    staleTime: 30_000,
  });
}

export function useSaveView(page: SavedViewPage) {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<
    SavedViewRead,
    Error,
    { name: string; filters: Record<string, unknown> }
  >({
    mutationFn: ({ name, filters }) => {
      const body: SavedViewCreate = { page, name, filters };
      return apiClient.post<SavedViewRead>("/me/views", body, session);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, page] });
    },
  });
}

export function useUpdateView(page: SavedViewPage) {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<
    SavedViewRead,
    Error,
    { id: string; payload: SavedViewUpdate }
  >({
    mutationFn: ({ id, payload }) =>
      apiClient.patch<SavedViewRead>(`/me/views/${id}`, payload, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, page] });
    },
  });
}

export function useDeleteView(page: SavedViewPage) {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id: string) =>
      apiClient.delete<void>(`/me/views/${id}`, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, page] });
    },
  });
}

export function useTogglePin(page: SavedViewPage) {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<
    SavedViewRead,
    Error,
    { id: string; is_pinned: boolean }
  >({
    mutationFn: ({ id, is_pinned }) =>
      apiClient.patch<SavedViewRead>(
        `/me/views/${id}`,
        { is_pinned } satisfies SavedViewUpdate,
        session,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY, page] });
    },
  });
}
