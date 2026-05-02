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
  mes?: number;
  desde?: string;
  hasta?: string;
  /** Match parcial case-insensitive contra columna `responsable`. */
  responsable?: string;
  /** Match parcial contra `subcategoria` o `extra.empresa_codigo`. */
  empresa?: string;
  /** Búsqueda full-text en nombre/descripcion/notas/id_template. */
  q?: string;
  only_alerta?: boolean;
}

function buildPath(filters: EntregablesFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.categoria) params.set("categoria", filters.categoria);
  if (filters.estado) params.set("estado", filters.estado);
  if (filters.anio) params.set("anio", String(filters.anio));
  if (filters.mes) params.set("mes", String(filters.mes));
  if (filters.desde) params.set("desde", filters.desde);
  if (filters.hasta) params.set("hasta", filters.hasta);
  if (filters.responsable) params.set("responsable", filters.responsable);
  if (filters.empresa) params.set("empresa", filters.empresa);
  if (filters.q) params.set("q", filters.q);
  if (filters.only_alerta) params.set("only_alerta", "true");
  const qs = params.toString();
  return `/entregables${qs ? `?${qs}` : ""}`;
}

export interface EntregablesFacets {
  responsables: string[];
  empresas: string[];
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

export function useEntregablesFacets() {
  const { session, loading } = useSession();
  return useQuery<EntregablesFacets, Error>({
    queryKey: ["entregables", "facets"],
    queryFn: () =>
      apiClient.get<EntregablesFacets>("/entregables/facets", session),
    enabled: !loading && !!session,
    // Facets cambian poco — cache 5 min para evitar refetches al
    // alternar entre vistas.
    staleTime: 5 * 60_000,
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

/**
 * V4 fase 6 — Conteo ligero de entregables críticos para el badge sidebar.
 *
 * Backed por `GET /entregables/critical-count` (un solo SELECT agregado).
 * Antes lo calculábamos en cliente bajando todos los entregables — para
 * ~230 ítems era trivial pero generaba payloads de 30–60 KB en cada
 * navegación. Con el endpoint dedicado el badge cuesta bytes.
 *
 * `staleTime` 30s para no refetchear obsesivamente, refetch on focus
 * para que después de marcar uno entregado el badge baje al volver.
 */
export interface CriticalCountResponse {
  critical: number;
  vencidos: number;
  hoy: number;
  proximos_5d: number;
}

export function useCriticalCount() {
  const { session, loading } = useSession();
  return useQuery<CriticalCountResponse, Error>({
    queryKey: ["entregables", "critical-count"],
    queryFn: () =>
      apiClient.get<CriticalCountResponse>(
        "/entregables/critical-count",
        session,
      ),
    enabled: !loading && !!session,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** Backwards-compatible: devuelve solo el número total para el badge. */
export function useCriticalEntregablesCount(): number {
  const { data } = useCriticalCount();
  return data?.critical ?? 0;
}

export interface ComplianceGradeEmpresa {
  empresa_codigo: string;
  total: number;
  entregados_a_tiempo: number;
  entregados_atrasados: number;
  no_entregados: number;
  pendientes: number;
  tasa_cumplimiento: number;
  tasa_a_tiempo: number;
  grade: "A" | "B" | "C" | "D" | "F";
}

export function useComplianceGradeEmpresa(empresaCodigo: string) {
  const { session, loading } = useSession();
  return useQuery<ComplianceGradeEmpresa, Error>({
    queryKey: ["entregables", "compliance-grade", empresaCodigo],
    queryFn: () =>
      apiClient.get<ComplianceGradeEmpresa>(
        `/entregables/compliance-grade/${empresaCodigo}`,
        session,
      ),
    enabled: !loading && !!session && !!empresaCodigo,
    staleTime: 60_000,
  });
}

export interface ComplianceGradeReport {
  generado_at: string;
  empresas: ComplianceGradeEmpresa[];
  promedio_cumplimiento: number;
}

export function useComplianceGradeReport() {
  const { session, loading } = useSession();
  return useQuery<ComplianceGradeReport, Error>({
    queryKey: ["entregables", "compliance-grade-report"],
    queryFn: () =>
      apiClient.get<ComplianceGradeReport>(
        "/entregables/compliance-grade",
        session,
      ),
    enabled: !loading && !!session,
    staleTime: 5 * 60_000,
  });
}

/**
 * Prefetch on hover — V4 fase 7.5.
 *
 * Devuelve una función para llamar en `onMouseEnter` de los links del
 * sidebar/cmd-palette. Calienta el cache de TanStack Query con la lista
 * de entregables del año actual antes de que el usuario haga click.
 *
 * Si la query ya está en cache fresca (≤ staleTime), no hace nada.
 */
export function useEntregablesPrefetch() {
  const { session } = useSession();
  const qc = useQueryClient();
  return () => {
    qc.prefetchQuery({
      queryKey: ["entregables", { only_alerta: false }],
      queryFn: () => apiClient.get<EntregableRead[]>("/entregables", session),
      staleTime: 60_000,
    });
    qc.prefetchQuery({
      queryKey: ["entregables", "counts"],
      queryFn: () =>
        apiClient.get<EntregablesCounts>("/entregables/counts", session),
      staleTime: 60_000,
    });
  };
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

export interface BulkUpdatePayload {
  ids: number[];
  estado: EstadoEntregable;
  fecha_entrega_real?: string | null;
  motivo_no_entrega?: string | null;
  notas?: string | null;
  adjunto_url?: string | null;
}

export interface BulkUpdateResult {
  requested: number;
  updated_ids: number[];
  already_target: number[];
  not_found: number[];
  auto_generated_next_periods: number;
}

export function useBulkUpdateEntregables() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<BulkUpdateResult, Error, BulkUpdatePayload>({
    mutationFn: (body) =>
      apiClient.post<BulkUpdateResult>(
        "/entregables/bulk-update",
        body,
        session,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entregables"] });
    },
  });
}

export interface BulkReassignPayload {
  ids: number[];
  responsable: string;
}

export interface BulkReassignResult {
  requested: number;
  updated_ids: number[];
  not_found: number[];
}

export function useBulkReassignEntregables() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<BulkReassignResult, Error, BulkReassignPayload>({
    mutationFn: (body) =>
      apiClient.post<BulkReassignResult>(
        "/entregables/bulk-reassign",
        body,
        session,
      ),
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
