"use client";

/**
 * /admin/http-trail — V5++ ola AE
 *
 * Vista forense de TODA mutación HTTP (POST/PATCH/PUT/DELETE) de las
 * últimas 24h por default. Útil para:
 *   - "¿qué hizo el user X mientras no miraba?"
 *   - "¿hay endpoints lentos?"
 *   - "¿qué errores devolvió el backend?"
 *
 * Data viene de audit.http_mutations (middleware Ola AE).
 *
 * Filtros: user, method, endpoint prefix, solo errores, solo lentos,
 * ventana temporal (1h-30d).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw, AlertCircle, Zap } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { Surface } from "@/components/ui/surface";

interface MutationRow {
  id: number;
  method: string;
  path: string;
  status_code: number;
  latency_ms: number;
  user_email: string | null;
  ip: string | null;
  timestamp: string;
}

interface Summary {
  window_hours: number;
  counters: {
    total: number;
    ok: number;
    client_errors: number;
    server_errors: number;
    slow: number;
    avg_latency_ms: number;
    max_latency_ms: number;
  };
  top_users: Array<{ user_email: string; n: number }>;
  top_paths: Array<{ path: string; n: number; avg_ms: number }>;
  top_errors: Array<{ path: string; status_code: number; n: number }>;
}

interface MutationsResponse {
  total: number;
  page: number;
  size: number;
  items: MutationRow[];
}

const WINDOW_OPTIONS = [
  { value: 1, label: "Última hora" },
  { value: 24, label: "Últimas 24h" },
  { value: 168, label: "Últimos 7 días" },
  { value: 720, label: "Últimos 30 días" },
];

export default function HttpTrailPage() {
  const { session } = useSession();
  const [windowHours, setWindowHours] = useState(24);
  const [userEmail, setUserEmail] = useState("");
  const [methodFilter, setMethodFilter] = useState<string>("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [onlySlow, setOnlySlow] = useState(false);
  const [pathPrefix, setPathPrefix] = useState("");
  const [page, setPage] = useState(1);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [mutations, setMutations] = useState<MutationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const sumParams = `since_hours=${windowHours}`;
      const sum = await apiClient.get<Summary>(`/audit/http-mutations/summary?${sumParams}`, session);
      setSummary(sum);

      const params = new URLSearchParams({
        page: String(page),
        size: "50",
        since_hours: String(windowHours),
      });
      if (userEmail) params.set("user_email", userEmail);
      if (methodFilter) params.set("method", methodFilter);
      if (onlyErrors) params.set("only_errors", "true");
      if (onlySlow) params.set("only_slow", "true");
      if (pathPrefix) params.set("path_prefix", pathPrefix);

      const data = await apiClient.get<MutationsResponse>(
        `/audit/http-mutations?${params}`,
        session,
      );
      setMutations(data);
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, page, windowHours]);

  const refresh = () => {
    setPage(1);
    fetchData();
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="text-ink-500 hover:text-ink-900 dark:hover:text-ink-100"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">
              Audit trail HTTP
            </h1>
            <p className="text-sm text-ink-500 mt-1">
              Cada mutación queda registrada — quién, cuándo, qué endpoint, qué status.
            </p>
          </div>
        </div>
        <button
          onClick={refresh}
          className="inline-flex items-center gap-2 rounded-lg border border-hairline bg-white px-3 py-2 text-sm hover:border-cehta-green/40 dark:bg-ink-900 dark:text-ink-300"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Refrescar
        </button>
      </div>

      {/* Window selector */}
      <div className="flex gap-2 flex-wrap">
        {WINDOW_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => {
              setWindowHours(opt.value);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              windowHours === opt.value
                ? "bg-cehta-green text-white"
                : "bg-white text-ink-700 hover:bg-ink-50 dark:bg-ink-900 dark:text-ink-300 border border-hairline"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card label="Total mutaciones" value={summary.counters.total} />
          <Card
            label="Errores (4xx/5xx)"
            value={summary.counters.client_errors + summary.counters.server_errors}
            tone="danger"
          />
          <Card label="Lentas (>1s)" value={summary.counters.slow} tone="warn" />
          <Card
            label="Latencia promedio"
            value={`${summary.counters.avg_latency_ms || 0}ms`}
          />
        </div>
      )}

      {/* Top users & paths */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Surface className="p-4">
            <h3 className="text-sm font-medium text-ink-900 dark:text-ink-100 mb-3">
              Top users (volumen)
            </h3>
            <ul className="space-y-1.5 text-sm">
              {summary.top_users.slice(0, 8).map((u) => (
                <li key={u.user_email} className="flex justify-between">
                  <span className="text-ink-700 dark:text-ink-300 truncate mr-2">
                    {u.user_email}
                  </span>
                  <span className="font-medium text-ink-900 dark:text-ink-100">{u.n}</span>
                </li>
              ))}
            </ul>
          </Surface>

          <Surface className="p-4">
            <h3 className="text-sm font-medium text-ink-900 dark:text-ink-100 mb-3">
              Top endpoints (volumen + latencia)
            </h3>
            <ul className="space-y-1.5 text-sm">
              {summary.top_paths.slice(0, 8).map((p, i) => (
                <li key={i} className="flex justify-between">
                  <span className="font-mono text-xs text-ink-700 dark:text-ink-300 truncate mr-2">
                    {p.path}
                  </span>
                  <span className="font-medium text-ink-900 dark:text-ink-100 whitespace-nowrap">
                    {p.n} · {p.avg_ms}ms
                  </span>
                </li>
              ))}
            </ul>
          </Surface>

          <Surface className="p-4">
            <h3 className="text-sm font-medium text-ink-900 dark:text-ink-100 mb-3">
              Top errores
            </h3>
            {summary.top_errors.length === 0 ? (
              <p className="text-sm text-cehta-green">✅ Sin errores en este período</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {summary.top_errors.slice(0, 8).map((e, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="font-mono text-xs text-red-600 dark:text-red-400 truncate mr-2">
                      [{e.status_code}] {e.path}
                    </span>
                    <span className="font-medium">{e.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </Surface>
        </div>
      )}

      {/* Filters */}
      <Surface className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="user_email (ej. grietta@cehta...)"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            className="px-3 py-2 rounded-lg border border-hairline text-sm dark:bg-ink-900 dark:text-ink-100"
          />
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-hairline text-sm dark:bg-ink-900 dark:text-ink-100"
          >
            <option value="">Todos los métodos</option>
            <option value="POST">POST</option>
            <option value="PATCH">PATCH</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input
            type="text"
            placeholder="Path prefix (ej. /api/v1/vouchers)"
            value={pathPrefix}
            onChange={(e) => setPathPrefix(e.target.value)}
            className="px-3 py-2 rounded-lg border border-hairline text-sm dark:bg-ink-900 dark:text-ink-100"
          />
          <div className="flex gap-3 items-center">
            <label className="flex items-center gap-1.5 text-sm text-ink-700 dark:text-ink-300">
              <input
                type="checkbox"
                checked={onlyErrors}
                onChange={(e) => setOnlyErrors(e.target.checked)}
              />
              <AlertCircle className="size-3.5 text-red-500" />
              Solo errores
            </label>
            <label className="flex items-center gap-1.5 text-sm text-ink-700 dark:text-ink-300">
              <input
                type="checkbox"
                checked={onlySlow}
                onChange={(e) => setOnlySlow(e.target.checked)}
              />
              <Zap className="size-3.5 text-amber-500" />
              Solo lentas
            </label>
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <button
            onClick={refresh}
            className="px-3 py-1.5 rounded-lg bg-cehta-green text-white text-sm font-medium hover:bg-cehta-green-700"
          >
            Aplicar filtros
          </button>
        </div>
      </Surface>

      {/* Table */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Surface className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 dark:bg-ink-900 text-ink-500">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Timestamp</th>
              <th className="text-left px-3 py-2 font-medium">User</th>
              <th className="text-left px-3 py-2 font-medium">Method</th>
              <th className="text-left px-3 py-2 font-medium">Path</th>
              <th className="text-right px-3 py-2 font-medium">Status</th>
              <th className="text-right px-3 py-2 font-medium">Latencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
            {(mutations?.items || []).map((m) => (
              <tr
                key={m.id}
                className={
                  m.status_code >= 500
                    ? "bg-red-50/30 dark:bg-red-950/10"
                    : m.status_code >= 400
                    ? "bg-amber-50/30 dark:bg-amber-950/10"
                    : ""
                }
              >
                <td className="px-3 py-2 text-xs text-ink-500 whitespace-nowrap">
                  {new Date(m.timestamp).toLocaleString("es-CL")}
                </td>
                <td className="px-3 py-2 text-xs">{m.user_email || "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{m.method}</td>
                <td className="px-3 py-2 font-mono text-xs truncate max-w-md">
                  {m.path}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono text-xs ${
                    m.status_code >= 500
                      ? "text-red-600"
                      : m.status_code >= 400
                      ? "text-amber-600"
                      : "text-cehta-green"
                  }`}
                >
                  {m.status_code}
                </td>
                <td
                  className={`px-3 py-2 text-right font-mono text-xs ${
                    m.latency_ms > 1000 ? "text-amber-600" : "text-ink-500"
                  }`}
                >
                  {m.latency_ms}ms
                </td>
              </tr>
            ))}
            {(mutations?.items || []).length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-ink-500">
                  Sin resultados para los filtros aplicados
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {mutations && mutations.total > mutations.size && (
          <div className="flex justify-between items-center p-3 border-t border-hairline">
            <span className="text-sm text-ink-500">
              {((mutations.page - 1) * mutations.size) + 1}–
              {Math.min(mutations.page * mutations.size, mutations.total)} de {mutations.total}
            </span>
            <div className="flex gap-2">
              <button
                disabled={mutations.page <= 1}
                onClick={() => setPage(page - 1)}
                className="px-3 py-1.5 rounded-lg border border-hairline text-sm disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                disabled={mutations.page * mutations.size >= mutations.total}
                onClick={() => setPage(page + 1)}
                className="px-3 py-1.5 rounded-lg border border-hairline text-sm disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </Surface>
    </div>
  );
}

function Card({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "danger" | "warn";
}) {
  const color =
    tone === "danger"
      ? "text-red-500"
      : tone === "warn"
      ? "text-amber-500"
      : "text-ink-900 dark:text-ink-100";
  return (
    <Surface className="p-3">
      <div className="text-xs text-ink-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${color}`}>{value}</div>
    </Surface>
  );
}
