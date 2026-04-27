/**
 * Admin queries — tipos y helpers para los endpoints `/audit/*` y `/admin/users`.
 *
 * Los tipos viven aquí (no en `lib/api/schema.ts`) porque el backend aún está
 * en construcción y no quiero contaminar el OpenAPI auto-generado. Cuando los
 * endpoints se estabilicen, mover a `schema.ts` con `components["schemas"]`.
 *
 * Disciplina 3 — el backend valida todo con `require_scope`, este módulo solo
 * tipa la respuesta y centraliza paths para evitar typos.
 */

// ─── ETL Runs ─────────────────────────────────────────────────────────────────

export type EtlRunStatus = "success" | "failed" | "running" | "partial";

export interface EtlRunRead {
  run_id: string;
  status: EtlRunStatus | string;
  source_file: string | null;
  started_at: string;
  finished_at: string | null;
  rows_extracted: number | null;
  rows_loaded: number | null;
  rows_rejected: number | null;
  triggered_by: string | null;
  error_message?: string | null;
}

export interface RejectedRowRead {
  rejected_row_id: string;
  run_id: string;
  source_sheet: string | null;
  source_row_num: number | null;
  reason: string;
  raw_data: Record<string, unknown> | null;
}

// ─── Data Quality ─────────────────────────────────────────────────────────────

export type IssueSeverity = "high" | "medium" | "low";

export interface DataQualityIssue {
  severity: IssueSeverity | string;
  category: string;
  count: number;
  description: string;
  link?: string | null;
}

export interface DataQualityReport {
  generated_at?: string;
  issues: DataQualityIssue[];
}

// ─── Users / Roles ────────────────────────────────────────────────────────────

export interface UserRoleRead {
  user_id: string;
  email: string | null;
  full_name?: string | null;
  app_role: string;
  assigned_at: string | null;
  assigned_by_email?: string | null;
}

export interface CreateUserRoleRequest {
  email: string;
  app_role: string;
}

export interface UpdateUserRoleRequest {
  app_role: string;
}

// ─── Endpoints (single source of truth) ───────────────────────────────────────

export const ADMIN_ENDPOINTS = {
  etlRuns: (params?: {
    status?: string;
    page?: number;
    size?: number;
  }): string => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set("status", params.status);
    if (params?.page) sp.set("page", String(params.page));
    if (params?.size) sp.set("size", String(params.size));
    const qs = sp.toString();
    return qs ? `/audit/etl-runs?${qs}` : "/audit/etl-runs";
  },
  etlRun: (runId: string): string => `/audit/etl-runs/${runId}`,
  etlRunRejectedRows: (
    runId: string,
    params?: { page?: number; size?: number },
  ): string => {
    const sp = new URLSearchParams();
    if (params?.page) sp.set("page", String(params.page));
    if (params?.size) sp.set("size", String(params.size));
    const qs = sp.toString();
    return qs
      ? `/audit/etl-runs/${runId}/rejected-rows?${qs}`
      : `/audit/etl-runs/${runId}/rejected-rows`;
  },
  dataQuality: (): string => "/audit/data-quality",
  users: (): string => "/admin/users",
  userRole: (userId: string): string => `/admin/users/${userId}/role`,
  user: (userId: string): string => `/admin/users/${userId}`,
};

// ─── Helpers presentacionales ─────────────────────────────────────────────────

/** Calcula duración entre `started_at` y `finished_at` y la formatea (ej "2m 34s"). */
export function formatDuration(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): string {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return "—";
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (Number.isNaN(end) || end < start) return "—";
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
}

/** Mapea status ETL a variant de Badge. */
export function etlStatusVariant(
  status: string,
): "success" | "danger" | "info" | "warning" | "neutral" {
  switch (status) {
    case "success":
      return "success";
    case "failed":
      return "danger";
    case "running":
      return "info";
    case "partial":
      return "warning";
    default:
      return "neutral";
  }
}

/** Mapea severity a variant de Badge / color de dot. */
export function severityVariant(
  severity: string,
): "danger" | "warning" | "info" | "neutral" {
  switch (severity) {
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
      return "info";
    default:
      return "neutral";
  }
}

/** Roles válidos del sistema (deben coincidir con `ROLE_SCOPES` del backend). */
export const APP_ROLES = ["admin", "finance", "viewer"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export function roleVariant(
  role: string,
): "success" | "info" | "neutral" {
  switch (role) {
    case "admin":
      return "success";
    case "finance":
      return "info";
    default:
      return "neutral";
  }
}

export function roleLabel(role: string): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "finance":
      return "Finance";
    case "viewer":
      return "Viewer";
    default:
      return role;
  }
}
