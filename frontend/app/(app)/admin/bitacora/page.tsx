"use client";

/**
 * /admin/bitacora — V5++ ola AO
 *
 * Bitácora unificada: TODA la actividad de TODOS los usuarios.
 * Combina:
 *   - action_log (creación/edición/eliminación de entidades)
 *   - http_mutations (cada POST/PATCH/PUT/DELETE)
 *
 * Filtros: usuario, empresa, ventana temporal.
 * Vista timeline cronológica + summary stats.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Activity,
  User as UserIcon,
  Building2,
  ListChecks,
  RefreshCw,
  AlertCircle,
  Zap,
  Filter,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useDebounce } from "@/hooks/use-debounce";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";

interface TimelineItem {
  source: "action" | "http";
  timestamp: string;
  user_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  summary: string;
  status_code: number | null;
  path: string | null;
  latency_ms: number | null;
}

interface Summary {
  window_days: number;
  totals: {
    actions_total: number;
    http_total: number;
    users_active: number;
  };
  top_users: Array<{ user_email: string; actions: number }>;
  top_entities: Array<{ entity_type: string; n: number }>;
  daily_breakdown: Array<{ dia: string; actions: number }>;
}

const WINDOWS = [
  { hours: 24, label: "24h" },
  { hours: 72, label: "3 días" },
  { hours: 168, label: "7 días" },
  { hours: 720, label: "30 días" },
];

export default function BitacoraPage() {
  const { session } = useSession();
  const [windowHours, setWindowHours] = useState(72);
  const [userEmailFilter, setUserEmailFilter] = useState("");
  const [empresaFilter, setEmpresaFilter] = useState("");
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);

  // V5++ ola BE: debounce 400ms — evita request en cada keystroke del filter
  const debouncedEmail = useDebounce(userEmailFilter, 400);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        since_hours: String(windowHours),
        limit: "300",
      });
      if (debouncedEmail) params.set("user_email", debouncedEmail);

      const tl = await apiClient.get<{ items: TimelineItem[] }>(
        `/bitacora/timeline?${params}`,
        session,
      );
      setItems(tl.items);

      const days = Math.max(1, Math.round(windowHours / 24));
      const sum = await apiClient.get<Summary>(
        `/bitacora/summary?since_days=${days}`,
        session,
      );
      setSummary(sum);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "Error cargando bitácora",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, windowHours, debouncedEmail]);

  // Filtro client-side por empresa (texto contiene)
  const filteredItems = useMemo(() => {
    if (!empresaFilter) return items;
    const q = empresaFilter.toLowerCase();
    return items.filter((it) => {
      const haystack = [
        it.entity_label,
        it.summary,
        it.path,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, empresaFilter]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
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
              Bitácora
            </h1>
            <p className="text-sm text-ink-500 mt-1">
              Registro automático de cada acción de cada usuario. Forense
              completo.
            </p>
          </div>
        </div>
        <button
          onClick={fetchData}
          className="inline-flex items-center gap-2 rounded-lg border border-hairline bg-white px-3 py-2 text-sm hover:border-cehta-green/40 dark:bg-ink-900 dark:text-ink-300"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Refrescar
        </button>
      </div>

      {/* Window selector */}
      <div className="flex gap-2 flex-wrap">
        {WINDOWS.map((w) => (
          <button
            key={w.hours}
            onClick={() => setWindowHours(w.hours)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              windowHours === w.hours
                ? "bg-cehta-green text-white"
                : "bg-white text-ink-700 hover:bg-ink-50 dark:bg-ink-900 dark:text-ink-300 border border-hairline"
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard
            icon={<Activity className="size-4 text-cehta-green" />}
            label="Acciones registradas"
            value={summary.totals.actions_total}
          />
          <KpiCard
            icon={<Zap className="size-4 text-blue-500" />}
            label="Requests HTTP"
            value={summary.totals.http_total}
          />
          <KpiCard
            icon={<UserIcon className="size-4 text-amber-500" />}
            label="Usuarios activos"
            value={summary.totals.users_active}
          />
          <KpiCard
            icon={<ListChecks className="size-4 text-purple-500" />}
            label="Items mostrados"
            value={filteredItems.length}
          />
        </div>
      )}

      {/* Top users + entities */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Surface className="p-4">
            <h3 className="text-sm font-medium text-ink-900 dark:text-ink-100 mb-3 flex items-center gap-2">
              <UserIcon className="size-4 text-amber-500" />
              Top usuarios por actividad
            </h3>
            {summary.top_users.length === 0 ? (
              <p className="text-sm text-ink-500">Sin actividad en este período</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {summary.top_users.slice(0, 10).map((u) => (
                  <li
                    key={u.user_email}
                    className="flex justify-between items-center"
                  >
                    <button
                      onClick={() => setUserEmailFilter(u.user_email)}
                      className="text-ink-700 dark:text-ink-300 truncate mr-2 hover:text-cehta-green text-left"
                    >
                      {u.user_email}
                    </button>
                    <span className="font-medium text-ink-900 dark:text-ink-100 px-2 py-0.5 rounded bg-ink-100 dark:bg-ink-800 text-xs">
                      {u.actions}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Surface>

          <Surface className="p-4">
            <h3 className="text-sm font-medium text-ink-900 dark:text-ink-100 mb-3 flex items-center gap-2">
              <ListChecks className="size-4 text-purple-500" />
              Top entidades editadas
            </h3>
            {summary.top_entities.length === 0 ? (
              <p className="text-sm text-ink-500">Sin actividad</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {summary.top_entities.map((e) => (
                  <li
                    key={e.entity_type}
                    className="flex justify-between items-center"
                  >
                    <span className="text-ink-700 dark:text-ink-300 font-mono text-xs">
                      {e.entity_type}
                    </span>
                    <span className="font-medium text-ink-900 dark:text-ink-100 px-2 py-0.5 rounded bg-ink-100 dark:bg-ink-800 text-xs">
                      {e.n}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Surface>
        </div>
      )}

      {/* Filters */}
      <Surface className="p-4">
        <div className="flex items-center gap-2 mb-3 text-sm text-ink-500">
          <Filter className="size-4" />
          Filtros
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="Email del usuario (filtra al tipear)"
            value={userEmailFilter}
            onChange={(e) => setUserEmailFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-hairline text-sm bg-white dark:bg-ink-900 dark:text-ink-100"
          />
          <input
            type="text"
            placeholder="Empresa (ej. EVOQUE)"
            value={empresaFilter}
            onChange={(e) => setEmpresaFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-hairline text-sm bg-white dark:bg-ink-900 dark:text-ink-100"
          />
          <button
            onClick={() => {
              setUserEmailFilter("");
              setEmpresaFilter("");
              fetchData();
            }}
            className="px-3 py-2 rounded-lg border border-hairline text-sm hover:bg-ink-50 dark:bg-ink-900 dark:text-ink-300"
          >
            Limpiar filtros
          </button>
        </div>
      </Surface>

      {/* Timeline */}
      <Surface className="overflow-hidden">
        <div className="px-4 py-3 border-b border-hairline flex items-center justify-between">
          <h3 className="text-sm font-medium text-ink-900 dark:text-ink-100">
            Timeline cronológico ({filteredItems.length} eventos)
          </h3>
          {loading && (
            <RefreshCw className="size-4 animate-spin text-ink-400" />
          )}
        </div>
        {filteredItems.length === 0 && !loading ? (
          <div className="p-8 text-center text-ink-500 text-sm">
            Sin actividad para los filtros aplicados
          </div>
        ) : (
          <ul className="divide-y divide-ink-100 dark:divide-ink-800">
            {filteredItems.map((it, idx) => (
              <li
                key={idx}
                className="px-4 py-3 hover:bg-ink-50 dark:hover:bg-ink-900/40"
              >
                <div className="flex items-start gap-3">
                  <SourceBadge source={it.source} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-sm text-ink-900 dark:text-ink-100 truncate">
                        {it.summary}
                      </span>
                      <span className="text-xs text-ink-400 whitespace-nowrap">
                        {new Date(it.timestamp).toLocaleString("es-CL")}
                      </span>
                    </div>
                    <div className="text-xs text-ink-500 mt-1 flex items-center gap-3 flex-wrap">
                      {it.user_email && (
                        <span className="flex items-center gap-1">
                          <UserIcon className="size-3" />
                          {it.user_email}
                        </span>
                      )}
                      {it.entity_type && (
                        <span className="font-mono text-[10px] bg-ink-100 dark:bg-ink-800 px-1.5 py-0.5 rounded">
                          {it.entity_type}
                          {it.entity_id && ` #${it.entity_id}`}
                        </span>
                      )}
                      {it.status_code && (
                        <span
                          className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                            it.status_code >= 500
                              ? "bg-red-100 text-red-700"
                              : it.status_code >= 400
                                ? "bg-amber-100 text-amber-700"
                                : "bg-cehta-green/10 text-cehta-green"
                          }`}
                        >
                          {it.status_code}
                        </span>
                      )}
                      {it.latency_ms !== null && it.latency_ms > 1000 && (
                        <span className="text-amber-600 flex items-center gap-1">
                          <AlertCircle className="size-3" />
                          {it.latency_ms}ms lento
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Surface>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Surface className="p-4">
      <div className="flex items-center gap-2 text-xs text-ink-500">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold mt-2 text-ink-900 dark:text-ink-100">
        {value.toLocaleString("es-CL")}
      </div>
    </Surface>
  );
}

function SourceBadge({ source }: { source: "action" | "http" }) {
  if (source === "action") {
    return (
      <span className="inline-flex items-center justify-center size-7 rounded-full bg-cehta-green/10 text-cehta-green flex-shrink-0">
        <ListChecks className="size-4" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center size-7 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 flex-shrink-0">
      <Zap className="size-4" />
    </span>
  );
}
