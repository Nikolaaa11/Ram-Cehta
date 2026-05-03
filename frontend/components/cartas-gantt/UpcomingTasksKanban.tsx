"use client";

/**
 * UpcomingTasksKanban — vista swimlane de tareas urgentes cross-empresa.
 *
 * 4 columnas con buckets temporales:
 *   VENCIDAS (rojo, pulse)
 *   HOY (cehta-green)
 *   ESTA SEMANA (info azul)
 *   PRÓXIMAS 2 SEM (gris)
 *
 * Cada card muestra: empresa logo, código, proyecto, nombre del hito,
 * progress bar, encargado, fecha relativa. Hover → quick actions.
 *
 * Filtros: empresa, encargado, "solo mías" (todos vía URL state).
 * Mobile: una columna a la vez con tabs (no swimlane).
 *
 * NO incluye DnD inicialmente — el usuario mueve tareas entre columnas
 * cambiando la fecha via <TaskQuickActions>. DnD se puede sumar después
 * con @dnd-kit sin tocar este componente.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Calendar, CalendarClock, Clock, Inbox, Filter, Search } from "lucide-react";
import { useUpcomingTasks } from "@/hooks/use-upcoming-tasks";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskCard } from "./TaskCard";
import { cn } from "@/lib/utils";
import type { HitoConContexto, UpcomingTasksResponse } from "@/lib/api/schema";

interface Props {
  empresa?: string;
  encargado?: string;
}

type BucketKey =
  | "vencidas"
  | "hoy"
  | "esta_semana"
  | "proximas_2_semanas"
  | "sin_fecha";

interface BucketConfig {
  key: BucketKey;
  label: string;
  Icon: React.ElementType;
  tone: "negative" | "cehta" | "info" | "ink" | "warning";
  description: string;
}

const BUCKETS: BucketConfig[] = [
  {
    key: "vencidas",
    label: "Vencidas",
    Icon: AlertTriangle,
    tone: "negative",
    description: "Tareas con fecha pasada — atención inmediata",
  },
  {
    key: "hoy",
    label: "Hoy",
    Icon: Clock,
    tone: "cehta",
    description: "Tareas que vencen hoy",
  },
  {
    key: "esta_semana",
    label: "Esta semana",
    Icon: CalendarClock,
    tone: "info",
    description: "Tareas hasta el domingo",
  },
  {
    key: "proximas_2_semanas",
    label: "Próximas 2 sem",
    Icon: Calendar,
    tone: "ink",
    description: "Tareas hasta dentro de 14 días",
  },
];

const TONE_STYLES = {
  negative: {
    bg: "bg-negative/5",
    border: "border-negative/30",
    text: "text-negative",
    icon: "bg-negative/10 text-negative",
    pulse: true,
  },
  cehta: {
    bg: "bg-cehta-green/5",
    border: "border-cehta-green/30",
    text: "text-cehta-green",
    icon: "bg-cehta-green/10 text-cehta-green",
    pulse: false,
  },
  info: {
    bg: "bg-info/5",
    border: "border-info/30",
    text: "text-info",
    icon: "bg-info/10 text-info",
    pulse: false,
  },
  ink: {
    bg: "bg-ink-100/40",
    border: "border-hairline",
    text: "text-ink-600",
    icon: "bg-ink-100 text-ink-600",
    pulse: false,
  },
  warning: {
    bg: "bg-warning/5",
    border: "border-warning/30",
    text: "text-warning",
    icon: "bg-warning/10 text-warning",
    pulse: false,
  },
} as const;

export function UpcomingTasksKanban({ empresa, encargado }: Props) {
  const [search, setSearch] = useState("");
  const [activeBucketMobile, setActiveBucketMobile] = useState<BucketKey>("hoy");
  const query = useUpcomingTasks({ empresa, encargado });

  // Filtrar todas las columnas con el search
  const filtered = useMemo(() => {
    if (!query.data) return null;
    if (!search.trim()) return query.data;
    const q = search.trim().toLowerCase();
    const filterFn = (h: HitoConContexto) =>
      h.nombre.toLowerCase().includes(q) ||
      h.proyecto_nombre.toLowerCase().includes(q) ||
      h.empresa_codigo.toLowerCase().includes(q) ||
      (h.encargado ?? "").toLowerCase().includes(q);
    return {
      ...query.data,
      vencidas: query.data.vencidas.filter(filterFn),
      hoy: query.data.hoy.filter(filterFn),
      esta_semana: query.data.esta_semana.filter(filterFn),
      proximas_2_semanas: query.data.proximas_2_semanas.filter(filterFn),
      sin_fecha: query.data.sin_fecha.filter(filterFn),
    } satisfies UpcomingTasksResponse;
  }, [query.data, search]);

  if (query.isLoading || query.isPending) {
    return <KanbanSkeleton />;
  }

  if (query.isError || !filtered) {
    return (
      <Surface className="border border-negative/20 bg-negative/5 py-6 text-center">
        <p className="text-sm text-negative">
          No se pudo cargar el tablero de tareas.
        </p>
        <button
          type="button"
          onClick={() => query.refetch()}
          className="mt-2 rounded-lg bg-white px-3 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
        >
          Reintentar
        </button>
      </Surface>
    );
  }

  // Empty state global: si todas las columnas están vacías
  const totalActivos =
    filtered.vencidas.length +
    filtered.hoy.length +
    filtered.esta_semana.length +
    filtered.proximas_2_semanas.length;

  if (totalActivos === 0 && !search.trim()) {
    return (
      <Surface className="py-12 text-center">
        <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-positive/15 text-positive">
          <Inbox className="h-6 w-6" strokeWidth={1.5} />
        </span>
        <p className="mt-3 text-base font-semibold text-ink-900">
          Inbox cero — bien ahí
        </p>
        <p className="mt-1 text-sm text-ink-500">
          {filtered.stats.total_completados > 0
            ? `Llevás ${filtered.stats.total_completados} hitos completados.`
            : "Sin tareas pendientes."}
        </p>
      </Surface>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: search + stats */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
            strokeWidth={1.75}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tarea, encargado, empresa…"
            className="w-full rounded-xl border-0 bg-white py-2 pl-9 pr-3 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </div>
        <KanbanStats data={filtered} />
      </div>

      {/* Tabs mobile: una columna a la vez */}
      <div className="flex md:hidden -mx-1 overflow-x-auto pb-2">
        <div className="flex items-center gap-1 px-1">
          {BUCKETS.map((b) => {
            const count = filtered[b.key].length;
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => setActiveBucketMobile(b.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                  activeBucketMobile === b.key
                    ? "bg-white text-ink-900 shadow-sm ring-1 ring-hairline"
                    : "text-ink-500 hover:text-ink-700",
                )}
              >
                <b.Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                {b.label}
                <span
                  className={cn(
                    "rounded px-1 text-[10px] tabular-nums",
                    activeBucketMobile === b.key
                      ? `${TONE_STYLES[b.tone].icon}`
                      : "bg-ink-100 text-ink-500",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop: 4 columnas swimlane */}
      <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-4 gap-3">
        {BUCKETS.map((b) => (
          <BucketColumn
            key={b.key}
            config={b}
            hitos={filtered[b.key]}
          />
        ))}
      </div>

      {/* Mobile: una sola columna */}
      <div className="md:hidden">
        {BUCKETS.filter((b) => b.key === activeBucketMobile).map((b) => (
          <BucketColumn
            key={b.key}
            config={b}
            hitos={filtered[b.key]}
            mobile
          />
        ))}
      </div>

      {/* Sin fecha (si existen) — sección aparte abajo */}
      {filtered.sin_fecha.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer rounded-xl border border-dashed border-hairline bg-white px-4 py-3 text-sm font-medium text-ink-600 hover:bg-ink-50">
            <span className="inline-flex items-center gap-2">
              <Filter className="h-3.5 w-3.5" strokeWidth={1.75} />
              {filtered.sin_fecha.length} hitos sin fecha planificada
              <span className="text-xs text-ink-400">(click para ver)</span>
            </span>
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.sin_fecha.map((h) => (
              <TaskCard key={h.hito_id} hito={h} bucket="sin_fecha" />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── Sub-componentes ───────────────────────────────────────────────────────

function BucketColumn({
  config,
  hitos,
  mobile,
}: {
  config: BucketConfig;
  hitos: HitoConContexto[];
  mobile?: boolean;
}) {
  const tone = TONE_STYLES[config.tone];
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border bg-white",
        tone.border,
      )}
    >
      {/* Header sticky */}
      <header
        className={cn(
          "sticky top-0 z-10 flex items-center justify-between gap-2 rounded-t-2xl border-b px-3 py-2.5",
          tone.bg,
          tone.border,
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded-md",
              tone.icon,
              tone.pulse && hitos.length > 0 && "animate-pulse",
            )}
          >
            <config.Icon className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <h3
            className={cn(
              "text-xs font-semibold uppercase tracking-wider",
              tone.text,
            )}
          >
            {config.label}
          </h3>
        </div>
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
            tone.icon,
          )}
        >
          {hitos.length}
        </span>
      </header>

      {/* Lista */}
      <div
        className={cn(
          "flex flex-col gap-2 p-2",
          !mobile && "max-h-[calc(100vh-340px)] overflow-y-auto",
        )}
      >
        {hitos.length === 0 ? (
          <p className="py-6 text-center text-xs italic text-ink-400">
            {config.key === "vencidas"
              ? "Todo al día 🎉"
              : config.key === "hoy"
              ? "Sin tareas hoy"
              : "Sin tareas en este bucket"}
          </p>
        ) : (
          hitos.map((h) => (
            <TaskCard key={h.hito_id} hito={h} bucket={config.key} />
          ))
        )}
      </div>
    </div>
  );
}

function KanbanStats({ data }: { data: UpcomingTasksResponse }) {
  const s = data.stats;
  const tendencia =
    s.completadas_ultima_semana - s.completadas_semana_anterior;
  return (
    <div className="flex items-center gap-3 text-xs">
      <Stat
        label="Activos"
        value={s.total_pendientes + s.total_en_progreso}
      />
      <Stat
        label="Vencidas"
        value={s.vencidas_count}
        tone={s.vencidas_count > 0 ? "negative" : "ink"}
      />
      <Stat
        label="Cerrados sem"
        value={s.completadas_ultima_semana}
        delta={tendencia !== 0 ? tendencia : undefined}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  delta,
}: {
  label: string;
  value: number;
  tone?: "negative" | "ink";
  delta?: number;
}) {
  return (
    <div className="flex flex-col">
      <p className="text-[10px] uppercase tracking-wider text-ink-400">
        {label}
      </p>
      <p
        className={cn(
          "text-base font-semibold tabular-nums",
          tone === "negative" ? "text-negative" : "text-ink-900",
        )}
      >
        {value.toLocaleString("es-CL")}
        {delta !== undefined && (
          <span
            className={cn(
              "ml-1 text-[10px] font-medium",
              delta > 0 ? "text-positive" : "text-negative",
            )}
          >
            {delta > 0 ? "+" : ""}
            {delta}
          </span>
        )}
      </p>
    </div>
  );
}

function KanbanSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-2xl border border-hairline bg-white p-3"
        >
          <Skeleton className="h-6 w-2/3 rounded" />
          {[0, 1, 2].map((j) => (
            <Skeleton key={j} className="h-20 rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  );
}
