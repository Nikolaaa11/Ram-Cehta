"use client";

/**
 * Hooks para version history de Legal Vault (V4 fase 3).
 *
 * - `useLegalVersions(documentoId)` → lista de versiones del documento (DESC).
 * - `useLegalVersion(documentoId, versionNumber)` → detalle de una versión.
 * - `useLegalVersionCompare(documentoId, versionNumber)` → side-by-side diff
 *   contra el estado actual (snapshot histórico vs current).
 * - `useRestoreLegalVersion()` → mutation; al éxito invalida el documento
 *   actual + el listado de versiones.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type {
  LegalDocumentRead,
  LegalDocumentVersionCompareResponse,
  LegalDocumentVersionRead,
} from "@/lib/api/schema";

export function useLegalVersions(documentoId: number, enabled = true) {
  const { session, loading } = useSession();
  return useQuery<LegalDocumentVersionRead[], Error>({
    queryKey: ["legal-versions", documentoId],
    queryFn: () =>
      apiClient.get<LegalDocumentVersionRead[]>(
        `/legal/${documentoId}/versions`,
        session,
      ),
    enabled: !loading && enabled,
  });
}

export function useLegalVersion(
  documentoId: number,
  versionNumber: number | null,
) {
  const { session, loading } = useSession();
  return useQuery<LegalDocumentVersionRead, Error>({
    queryKey: ["legal-version", documentoId, versionNumber],
    queryFn: () =>
      apiClient.get<LegalDocumentVersionRead>(
        `/legal/${documentoId}/versions/${versionNumber}`,
        session,
      ),
    enabled: !loading && versionNumber !== null,
  });
}

export function useLegalVersionCompare(
  documentoId: number,
  versionNumber: number | null,
) {
  const { session, loading } = useSession();
  return useQuery<LegalDocumentVersionCompareResponse, Error>({
    queryKey: ["legal-version-compare", documentoId, versionNumber],
    queryFn: () =>
      apiClient.get<LegalDocumentVersionCompareResponse>(
        `/legal/${documentoId}/versions/${versionNumber}/compare`,
        session,
      ),
    enabled: !loading && versionNumber !== null,
  });
}

export function useRestoreLegalVersion(documentoId: number) {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<LegalDocumentRead, Error, number>({
    mutationFn: (versionNumber) =>
      apiClient.post<LegalDocumentRead>(
        `/legal/${documentoId}/versions/${versionNumber}/restore`,
        {},
        session,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["legal-document", String(documentoId)] });
      qc.invalidateQueries({ queryKey: ["legal-versions", documentoId] });
      qc.invalidateQueries({ queryKey: ["legal-documents"] });
      qc.invalidateQueries({ queryKey: ["audit-history", "legal_document"] });
    },
  });
}
