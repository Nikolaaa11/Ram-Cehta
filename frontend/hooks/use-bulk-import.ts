"use client";

/**
 * Hooks para Bulk CSV Import (V3 fase 11).
 *
 *   useDryRun(entityType)   — POST multipart /bulk-import/{entity}/dry-run
 *   useExecute(entityType)  — POST json     /bulk-import/{entity}/execute
 *
 * El hook NO toca el backend hasta que el caller invoca `mutate(file)` o
 * `mutate({ rows })`. Errores se propagan al caller para que muestre toast.
 */
import { useMutation } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";
import type {
  BulkImportEntityType,
  ImportResult,
  ValidationReport,
} from "@/lib/api/schema";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export function useDryRun(entityType: BulkImportEntityType) {
  const { session } = useSession();
  return useMutation<ValidationReport, Error, File>({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
      const resp = await fetch(
        `${API_BASE}/bulk-import/${entityType}/dry-run`,
        {
          method: "POST",
          headers,
          body: formData,
        },
      );
      if (!resp.ok) {
        let detail = `HTTP ${resp.status}`;
        try {
          const body = await resp.json();
          detail = body?.detail ?? detail;
        } catch {
          // non-JSON response
        }
        throw new Error(detail);
      }
      return (await resp.json()) as ValidationReport;
    },
  });
}

export interface ExecuteImportPayload {
  rows: Array<Record<string, unknown>>;
}

export function useExecute(entityType: BulkImportEntityType) {
  const { session } = useSession();
  return useMutation<ImportResult, Error, ExecuteImportPayload>({
    mutationFn: (payload) =>
      apiClient.post<ImportResult>(
        `/bulk-import/${entityType}/execute`,
        payload,
        session,
      ),
  });
}
