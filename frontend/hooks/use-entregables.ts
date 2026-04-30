"use client";

/**
 * Entregables Regulatorios FIP CEHTA ESG — V4 fase 6.
 *
 * Hooks TanStack Query para CRUD + reporte regulatorio. Las alertas y
 * `dias_restantes` vienen pre-calculadas server-side, así que el frontend
 * solo renderea.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

// ─── Tipos espejo de backend (mantener sincronizado con app/schemas/entregable.py) ────

export type EstadoEntregable =
  | "pendiente"
  | "en_proceso"
  | "entregado"
  | "no_entregado";

export type CategoriaEntregable =
  | "CMF"
  | "CORFO"
  | "UAF"
  | "SII"
  | "INTERNO"
  | "AUDITORIA"
  | "ASAMBLEA"
  | "OPERACIONAL";

export type FrecuenciaEntregable =
  | "mensual"
  | "trimestral"
  | "semestral"
  | "anual"
  | "bienal"
  | "unico"
  | "segun_evento";

export type PrioridadEntregable = "critica" | "alta" | "media" | "baja";

export type NivelAlerta =
  | "vencido"
  | "hoy"
  | "critico"
  | "urgente"
  | "proximo"
  | "en_rango"
  | "normal";

export interface EntregableRead {
  entregable_id: number;
  id_template: string;
  nombre: string;
  descripcion: string | null;
  categoria: CategoriaEntregable;
  subcategoria: string | null;
  referencia_normativa: string | null;
  fecha_limite: string; // ISO date
  frecuencia: FrecuenciaEntregable;
  prioridad: PrioridadEntregable;
  responsable: string;
  estado: EstadoEntregable;
  fecha_entrega_real: string | null;
  motivo_no_entrega: string | null;
  notas: string | null;
  adjunto_url: string | null;
  periodo: string;
  alerta_15: boolean;
  alerta_10: boolean;
  alerta_5: boolean;
  generado_automaticamente: boolean;
  es_publico: boolean;
  extra: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  nivel_alerta: NivelAlerta | null;
  dias_restantes: number | null;
}

export interface EntregableUpdate {
  estado?: EstadoEntregable;
  fecha_entrega_real?: string | null;
  motivo_no_entrega?: string | null;
  notas?: string | null;
  adjunto_url?: string | null;
  fecha_limite?: string;
  prioridad?: PrioridadEntregable;
  alerta_15?: boolean;
  alerta_10?: boolean;
  alerta_5?: boolean;
}

export interface EntregableCreate {
  id_template: string;
  nombre: string;
  descripcion?: string | null;
  categoria: CategoriaEntregable;
  subcategoria?: string | null;
  referencia_normativa?: string | null;
  fecha_limite: string;
  frecuencia: FrecuenciaEntregable;
  prioridad: PrioridadEntregable;
  responsable: string;
  periodo: string;
  alerta_15?: boolean;
  alerta_10?: boolean;
  alerta_5?: boolean;
  notas?: string | null;
  estado?: EstadoEntregable;
}

export interface EntregablesCounts {
  pendiente: number;
  en_proceso: number;
  entregado: number;
  no_entregado: number;
}

export interface ReporteRegulatorio {
  generado_at: string;
  estados: EntregablesCounts;
  proximos_30d: EntregableRead[];
  vencidos_sin_entregar: EntregableRead[];
  tasa_cumplimiento_ytd: number;
  total_ytd: number;
  entregados_ytd: number;
}

export interface EntregablesFilters {
  categoria?: CategoriaEntregable;
  estado?: EstadoEntregable;
  anio?: number;
  desde?: string;
  hasta?: string;
  only_alerta?: boolean;
}

function buildPath(filters: EntregablesFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.categoria) params.set("categoria", filters.categoria);
  if (filters.estado) params.set("estado", filters.estado);
  if (filters.anio) params.set("anio", String(filters.anio));
  if (filters.desde) params.set("desde", filters.desde);
  if (filters.hasta) params.set("hasta", filters.hasta);
  if (filters.only_alerta) params.set("only_alerta", "true");
  const qs = params.toString();
  return `/entregables${qs ? `?${qs}` : ""}`;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export function useEntregables(filters: EntregablesFilters = {}) {
  const { session, loading } = useSession();
  return useQuery<EntregableRead[], Error>({
    queryKey: ["entregables", filters],
    queryFn: () => apiClient.get<EntregableRead[]>(buildPath(filters), session),
    enabled: !loading && !!session,
    staleTime: 60_000,
  });
}

export function useEntregablesCounts() {
  const { session, loading } = useSession();
  return useQuery<EntregablesCounts, Error>({
    queryKey: ["entregables", "counts"],
    queryFn: () =>
      apiClient.get<EntregablesCounts>("/entregables/counts", session),
    enabled: !loading && !!session,
    staleTime: 60_000,
  });
}

export function useReporteRegulatorio() {
  const { session, loading } = useSession();
  return useQuery<ReporteRegulatorio, Error>({
    queryKey: ["entregables", "reporte"],
    queryFn: () =>
      apiClient.get<ReporteRegulatorio>("/entregables/reporte-regulatorio", session),
    enabled: !loading && !!session,
    staleTime: 60_000,
  });
}

export function useUpdateEntregable() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<
    EntregableRead,
    Error,
    { id: number; body: EntregableUpdate }
  >({
    mutationFn: ({ id, body }) =>
      apiClient.patch<EntregableRead>(`/entregables/${id}`, body, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entregables"] });
    },
  });
}

export function useCreateEntregable() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<EntregableRead, Error, EntregableCreate>({
    mutationFn: (body) =>
      apiClient.post<EntregableRead>("/entregables", body, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entregables"] });
    },
  });
}

export function useDeleteEntregable() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<unknown, Error, number>({
    mutationFn: (id) => apiClient.delete(`/entregables/${id}`, session),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entregables"] });
    },
  });
}
