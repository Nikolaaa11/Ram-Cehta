"use client";

/**
 * use-oc-kanban — hooks for the Kanban view of Órdenes de Compra.
 *
 * - `useOcKanban(empresa)` — fetches up to 100 OCs (the kanban shows the
 *   real flow: emitida, en_firma, firmada, enviada_proveedor, pagada, anulada). The list endpoint
 *   already returns `allowed_actions` per row so we render 🔒 client-side.
 * - `useUpdateOcEstado()` — wraps PATCH /ordenes-compra/{id}/estado and
 *   invalidates kanban + list queries on success. The backend enforces the
 *   per-OC RBAC (the same logic used by the list/detail pages).
 *
 * Design: optimistic updates (move card immediately) live in the page
 * component — this hook just exposes the mutation primitive. That keeps the
 * hook reusable from other surfaces (e.g., a future drag-from-detail view).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "./use-api-query";
import { useSession } from "./use-session";
import { apiClient } from "@/lib/api/client";
import type { Page, OcListItem } from "@/lib/api/schema";

// Las columnas del flujo REAL. La version anterior tenia una columna
// fantasma "aprobada" (el backend ni acepta esa transicion: 422 by design)
// y NO tenia en_firma/firmada/enviada_proveedor — una OC en firma se
// fetcheaba y se DESCARTABA en silencio: no aparecia en ninguna columna,
// que es exactamente lo que reporto Nicolas. borrador y parcial siguen
// fuera a proposito (casos excepcionales, viven en la lista clasica).
export type KanbanEstado =
  | "emitida"
  | "en_firma"
  | "firmada"
  | "enviada_proveedor"
  | "pagada"
  | "anulada";

export const KANBAN_ESTADOS: KanbanEstado[] = [
  "emitida",
  "en_firma",
  "firmada",
  "enviada_proveedor",
  "pagada",
  "anulada",
];

const KANBAN_PAGE_SIZE = 100;

export function useOcKanban(empresa: string) {
  const params = new URLSearchParams({
    page: "1",
    size: String(KANBAN_PAGE_SIZE),
  });
  if (empresa) params.set("empresa_codigo", empresa);

  return useApiQuery<Page<OcListItem>>(
    ["oc-kanban", empresa],
    `/ordenes-compra?${params.toString()}`,
  );
}

export interface UpdateEstadoArgs {
  ocId: number;
  estado: KanbanEstado;
}

export function useUpdateOcEstado() {
  const { session } = useSession();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ocId, estado }: UpdateEstadoArgs) =>
      apiClient.patch<unknown>(
        `/ordenes-compra/${ocId}/estado`,
        { estado },
        session,
      ),
    onSettled: async () => {
      // Invalida tanto el kanban como la lista clásica para que ambos
      // estén consistentes apenas vuelve la respuesta.
      await queryClient.invalidateQueries({ queryKey: ["oc-kanban"] });
      await queryClient.invalidateQueries({ queryKey: ["ordenes-compra"] });
    },
  });
}
