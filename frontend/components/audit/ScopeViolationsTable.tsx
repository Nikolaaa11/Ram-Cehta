"use client";

/**
 * ScopeViolationsTable — V5++ ola CB.
 *
 * Muestra tentativas cross-tenant detectadas por el backend.
 * Cada vez que un user no-admin intenta acceder a una empresa fuera
 * de su `user_company_roles`, el backend escribe un row en
 * `audit.scope_violations` (además del 403 HTTP).
 *
 * Útil para:
 *   - Detectar configuración incorrecta (rol mal asignado)
 *   - Detectar tentativas maliciosas
 *   - Auditoría CMF (evidencia que el scope funciona)
 *
 * Solo admin (`audit:read`) puede ver esto.
 */
import { useState } from "react";
import { ShieldAlert, User, AlertTriangle, Inbox } from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface ScopeViolation {
  id: number;
  occurred_at: string;
  user_id: string;
  user_email: string | null;
  user_role: string | null;
  attempted_empresa: string;
  allowed_empresas: string[];
  via: string | null;
  endpoint_path: string | null;
}

interface TopUserStat {
  user_email: string | null;
  user_role: string | null;
  attempt_count: number;
  empresas_distintas: number;
}

interface ScopeViolationsResponse {
  window_days: number;
  total: number;
  page: number;
  size: number;
  items: ScopeViolation[];
  top_users: TopUserStat[];
}

const WINDOW_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: "7 días" },
  { value: 30, label: "30 días" },
  { value: 90, label: "90 días" },
  { value: 365, label: "Año" },
];

export function ScopeViolationsTable() {
  const [windowDays, setWindowDays] = useState(30);
  const [page, setPage] = useState(1);
  const size = 50;

  const params = new URLSearchParams({
    since_days: String(windowDays),
    page: String(page),
    size: String(size),
  });

  const { data, isLoading, error } = useApiQuery<ScopeViolationsResponse>(
    ["audit", "scope-violations", String(windowDays), String(page)],
    `/audit/scope-violations?${params.toString()}`,
  );

  return (
    <div className="space-y-6">
      {/* Header + filtros */}
      <Surface variant="glass">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-negative/10 text-negative ring-1 ring-negative/20">
              <ShieldAlert className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <h3 className="font-display text-base font-semibold tracking-tight text-ink-900">
                Tentativas cross-tenant detectadas
              </h3>
              <p className="mt-0.5 text-sm text-ink-500 max-w-xl">
                Cada vez que un usuario sin acceso intenta ver datos de
                otra empresa, queda registrado acá. Si ves muchas
                tentativas del mismo user en poco tiempo, podría ser
                config incorrecta o malicia.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-ink-100/40 p-1 ring-1 ring-hairline">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setWindowDays(opt.value);
                  setPage(1);
                }}
                className={
                  windowDays === opt.value
                    ? "rounded-lg bg-white px-3 py-1 text-xs font-medium text-ink-900 shadow-sm"
                    : "rounded-lg px-3 py-1 text-xs font-medium text-ink-500 hover:text-ink-900"
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </Surface>

      {/* KPI strip */}
      {!isLoading && data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Surface padding="compact" className="text-center">
            <p className="text-[11px] uppercase tracking-wider text-ink-400">
              Tentativas
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-ink-900">
              {data.total}
            </p>
          </Surface>
          <Surface
            padding="compact"
            className="bg-negative/5 text-center ring-1 ring-negative/20"
          >
            <p className="text-[11px] uppercase tracking-wider text-negative">
              Usuarios distintos
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-negative">
              {data.top_users.length}
            </p>
          </Surface>
          <Surface
            padding="compact"
            className="bg-warning/5 text-center ring-1 ring-warning/20"
          >
            <p className="text-[11px] uppercase tracking-wider text-warning">
              Ventana
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-warning">
              {data.window_days}d
            </p>
          </Surface>
        </div>
      )}

      {/* Top users con más tentativas */}
      {!isLoading && data && data.top_users.length > 0 && (
        <Surface>
          <Surface.Header divider>
            <Surface.Title>Usuarios con más tentativas</Surface.Title>
            <Surface.Subtitle>
              Si un user aparece muchas veces, revisalo en /admin/users.
            </Surface.Subtitle>
          </Surface.Header>
          <div className="space-y-2">
            {data.top_users.map((u, i) => (
              <div
                key={`${u.user_email}-${i}`}
                className="flex items-center justify-between gap-3 rounded-xl bg-ink-50/40 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <User className="h-4 w-4 text-ink-400 shrink-0" strokeWidth={1.5} />
                  <span className="truncate text-sm font-medium text-ink-900">
                    {u.user_email ?? "Sin email"}
                  </span>
                  {u.user_role && (
                    <Badge variant="neutral">{u.user_role}</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="tabular-nums text-ink-500">
                    {u.attempt_count} tentativas
                  </span>
                  <span className="tabular-nums text-ink-500">
                    {u.empresas_distintas} empresas
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Surface>
      )}

      {/* Tabla de tentativas */}
      <Surface padding="none">
        <Surface.Header className="px-6 pt-6" divider>
          <Surface.Title>Histórico de tentativas</Surface.Title>
          <Surface.Subtitle>
            Cada fila es una vez que el user intentó acceder a una empresa
            fuera de su scope.
          </Surface.Subtitle>
        </Surface.Header>
        {isLoading ? (
          <div className="space-y-2 px-6 pb-6">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <div className="px-6 pb-6 text-sm text-negative">
            Error: {error instanceof Error ? error.message : "desconocido"}
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green">
              <Inbox className="h-6 w-6" strokeWidth={1.5} />
            </span>
            <p className="mt-3 text-sm font-medium text-ink-900">
              Sin tentativas cross-tenant en {windowDays} días
            </p>
            <p className="text-xs text-ink-500">
              Esto es bueno — significa que todos los users están operando
              dentro de su scope.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-hairline text-sm">
              <thead className="bg-ink-50/40">
                <tr>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                    Cuándo
                  </th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                    User
                  </th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                    Intentó acceder a
                  </th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                    Solo tiene acceso a
                  </th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                    Vía
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data.items.map((v) => (
                  <tr key={v.id} className="hover:bg-ink-50/30">
                    <td className="px-4 py-2 text-xs tabular-nums text-ink-500">
                      {new Date(v.occurred_at).toLocaleString("es-CL")}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-ink-900">
                          {v.user_email ?? v.user_id.slice(0, 8)}
                        </span>
                        {v.user_role && (
                          <Badge variant="neutral">{v.user_role}</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="danger">{v.attempted_empresa}</Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-500">
                      {v.allowed_empresas.length === 0
                        ? "(ninguna)"
                        : v.allowed_empresas.join(", ")}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-500 font-mono">
                      {v.via ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación */}
        {!isLoading && data && data.total > size && (
          <div className="flex items-center justify-between border-t border-hairline px-6 py-3">
            <p className="text-xs text-ink-500 tabular-nums">
              Página {data.page} de {Math.ceil(data.total / data.size)} ·{" "}
              {data.total} total
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-hairline bg-white px-3 py-1 text-xs disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page * size >= data.total}
                className="rounded-lg border border-hairline bg-white px-3 py-1 text-xs disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </Surface>

      {/* Footnote */}
      <div className="rounded-xl bg-amber-50/40 ring-1 ring-amber-200/40 p-3 text-xs text-amber-700 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={1.75} />
        <p>
          Una tentativa NO indica brecha de seguridad — el backend devolvió
          403 correctamente. Pero si ves un user que reintenta a varias
          empresas en poco tiempo, vale la pena hablar con esa persona o
          revisarle el rol asignado en{" "}
          <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono">
            /admin/users
          </code>
          .
        </p>
      </div>
    </div>
  );
}
