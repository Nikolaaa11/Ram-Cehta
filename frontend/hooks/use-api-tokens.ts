"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

export interface ApiTokenRead {
  id: string;
  name: string;
  description: string | null;
  token_hint: string;
  created_by: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ApiTokenWithSecret extends ApiTokenRead {
  token: string;
}

export interface ApiTokenCreate {
  name: string;
  description?: string | null;
  expires_at?: string | null;
}

export function useApiTokens() {
  const { session, loading } = useSession();
  return useQuery<ApiTokenRead[], Error>({
    queryKey: ["api-tokens"],
    queryFn: () => apiClient.get<ApiTokenRead[]>("/api-tokens", session),
    enabled: !loading,
  });
}

export function useCreateApiToken() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<ApiTokenWithSecret, Error, ApiTokenCreate>({
    mutationFn: (body) =>
      apiClient.post<ApiTokenWithSecret>("/api-tokens", body, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });
}

export function useRevokeApiToken() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<ApiTokenRead, Error, string>({
    mutationFn: (id) =>
      apiClient.post<ApiTokenRead>(`/api-tokens/${id}/revoke`, {}, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });
}

export function useDeleteApiToken() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (id) => apiClient.delete(`/api-tokens/${id}`, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
    },
  });
}
