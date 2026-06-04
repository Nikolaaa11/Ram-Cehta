"use client";

/**
 * R152FFFFF · Hook genérico que reemplaza el patrón duplicado en 17+
 * hooks personalizados (use-mailbox, use-f22, use-aprobaciones, etc).
 *
 * Antes:
 *   export function useMailbox() {
 *     const { session } = useSession();
 *     return useQuery({
 *       queryKey: ["mailbox"],
 *       queryFn: () => apiClient.get<MailboxItem[]>("/admin/mailbox", session),
 *       enabled: !!session,
 *       staleTime: 30_000,
 *     });
 *   }
 *
 * Ahora:
 *   export function useMailbox() {
 *     return useApiResource<MailboxItem[]>("/admin/mailbox", {
 *       queryKey: ["mailbox"],
 *       staleTime: 30_000,
 *     });
 *   }
 *
 * No rompe nada — los hooks existentes pueden seguir o migrarse de a poco.
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

type ApiResourceOptions<T> = Omit<
  UseQueryOptions<T, Error, T, readonly unknown[]>,
  "queryFn" | "queryKey"
> & {
  queryKey: readonly unknown[];
  /**
   * Si se setea, se usa en lugar del path. Útil para queries con params
   * dinámicos donde la URL se calcula afuera (e.g. paginación).
   */
  url?: string;
};

/**
 * Query GET con auth + queryKey + staleTime. Cubre el 95% de las llamadas
 * read-only del frontend.
 *
 * @param path  La URL relativa (e.g. "/admin/mailbox"). Se prefija
 *              automáticamente con NEXT_PUBLIC_API_URL en el apiClient.
 * @param options  Opciones de @tanstack/react-query, MENOS queryFn (que
 *                 viene auto-generada). queryKey es obligatorio para que
 *                 react-query pueda cachear/invalidar.
 *
 * @example
 *   const { data, isLoading } = useApiResource<MailboxItem[]>(
 *     "/admin/mailbox?category=oc",
 *     { queryKey: ["mailbox", "oc"], staleTime: 15_000 }
 *   );
 */
export function useApiResource<T>(
  path: string,
  options: ApiResourceOptions<T>,
) {
  const { session } = useSession();
  const { url, ...queryOptions } = options;
  const targetPath = url ?? path;

  return useQuery<T, Error, T, readonly unknown[]>({
    ...queryOptions,
    queryFn: () => apiClient.get<T>(targetPath, session),
    enabled:
      (queryOptions.enabled ?? true) && !!session,
  });
}
