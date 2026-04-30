"use client";

/**
 * 2FA TOTP — V4 fase 2.
 *
 * Hooks TanStack Query para listar estado, enrollar (genera QR + backup
 * codes), verificar el primer código (activa 2FA), desactivar y
 * regenerar backup codes.
 *
 * Los endpoints viven bajo `/me/2fa` (mismo prefix `/me` que saved-views,
 * múltiples routers conviven en FastAPI sin conflicto).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";
import type {
  TwoFactorBackupCodesResponse,
  TwoFactorEnrollResponse,
  TwoFactorStatus,
  TwoFactorVerifyRequest,
} from "@/lib/api/schema";

const KEY = "2fa";

export function use2FAStatus() {
  const { session, loading } = useSession();
  return useQuery<TwoFactorStatus, Error>({
    queryKey: [KEY, "status"],
    queryFn: () => apiClient.get<TwoFactorStatus>("/me/2fa/status", session),
    enabled: !loading && !!session,
    staleTime: 30_000,
  });
}

export function useEnroll() {
  const { session } = useSession();
  return useMutation<TwoFactorEnrollResponse, Error, void>({
    mutationFn: () =>
      apiClient.post<TwoFactorEnrollResponse>("/me/2fa/enroll", {}, session),
  });
}

export function useVerify() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<TwoFactorStatus, Error, TwoFactorVerifyRequest>({
    mutationFn: (body) =>
      apiClient.post<TwoFactorStatus>("/me/2fa/verify", body, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY] });
    },
  });
}

export function useDisable() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<TwoFactorStatus, Error, TwoFactorVerifyRequest>({
    mutationFn: (body) =>
      apiClient.post<TwoFactorStatus>("/me/2fa/disable", body, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY] });
    },
  });
}

export function useRegenerateBackupCodes() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<TwoFactorBackupCodesResponse, Error, void>({
    mutationFn: () =>
      apiClient.post<TwoFactorBackupCodesResponse>(
        "/me/2fa/regenerate-backup-codes",
        {},
        session,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [KEY] });
    },
  });
}
