"use client";

/**
 * CompliancePanelPro — V4 fase 9.3
 *
 * Vista consolidada "ultra pro" para ver de un vistazo si TODO está en orden.
 *
 * Muestra:
 *   1. Hero KPI con score global (% on time + count vencidos)
 *   2. Grid por categoría (CMF / CORFO / UAF / SII / INTERNO / AUDITORIA…)
 *      con count por estado (entregados / pendientes / vencidos)
 *   3. Top 5 urgentes con quick action "Marcar entregado"
 *
 * Pensado para abrir cada lunes y resolver lo crítico en 5 min.
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingUp,
  ShieldCheck,
  CalendarDays,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type CategoriaEntregable,
  type EntregableRead,
  useEntregables,
} from "@/hooks/use-entregables";
import { MarcarEntregadoDialog } from "@/components/entregables/MarcarEntregadoDialog";
import { cn } from "@/lib/utils";

const CATEGORIA_ICON: Record<CategoriaEntregable, string> = {
  CMF: "🏛️",
  CORFO: "🌿",
  UAF: "🛡️",
  SII: "📋",
  INTERNO: "📑",
  AUDITORIA: "🔍",
  ASAMBLEA: "🤝",
  OPERACIONAL: "⚙️",
};

const CATEGORIA_LABEL: Record<CategoriaEntregable, string> = {
  CMF: "CMF",
  CORFO: "CORFO",
  UAF: "UAF",
  SII: "SII / Tributario",
  INTERNO: "Reglamento Interno",
  AUDITORIA: "Auditoría",
  ASAMBLEA: "Asamblea",
  OPERACIONAL: "Operacional",
};

type CategoriaStats = {
  categoria: CategoriaEntregable;
  total: number;
  entregados: number;
  pendientes: number;
  vencidos: number;
  proximos_7d: number;
  pct_on_time: number;
};

export function CompliancePanelPro() {
  const hoy = new Date();
  const desdeHace12meses = new Date(hoy);
  desdeHace12meses.setMonth(desdeHace12meses.getMonth() - 12);
  const hasta = new Date(hoy);
  hasta.setMonth(hasta.getMonth() + 12);

  // Pull amplio: 12 meses atrás (entregados) + 12 meses adelante (pendientes)
  const { data: entregables = [], isLoading } = useEntregables({
    desde: desdeHace12meses.toISOString().slice(0, 10),
    hasta: hasta.toISOString().slice(0, 10),
  });

  const [marcarTarget, setMarcarTarget] = useState<EntregableRead | null>(null);

  // Stats por categoría
  const statsPorCategoria: CategoriaStats[] = useMemo(() => {
    const map = new Map<CategoriaEntregable, CategoriaStats>();
    const hoyMs = hoy.getTime();
    const en7d = hoyMs + 7 * 24 * 60 * 60 * 1000;

    for (const e of entregables) {
      let s = map.get(e.categoria);
      if (!s) {
        s = {
          categoria: e.categoria,
          total: 0,
          entregados: 0,
          pendientes: 0,
          vencidos: 0,
          proximos_7d: 0,
          pct_on_time: 0,
        };
        map.set(e.categoria, s);
      }
      s.total++;
      if (e.estado === "entregado") {
        s.entregados++;
      } else {
        s.pendientes++;
        const fechaMs = new Date(e.fecha_limite + "T00:00:00").getTime();
        if (fechaMs < hoyMs) s.vencidos++;
        else if (fechaMs <= en7d) s.proximos_7d++;
      }
    }
    for (const s of map.values()) {
      s.pct_on_time = s.total > 0 ? Math.round((s.entregados / s.total) * 100) : 0;
    }
    return Array.from(map.values()).sort((a, b) =>
      a.categoria.localeCompare(b.categoria),
    );
  }, [entregables, hoy]);

  // Stats globales
  const global = useMemo(() => {
    const total = entregables.length;
    let entregados = 0;
    let vencidos = 0;
    let proximos_7d = 0;
    const hoyMs = hoy.getTime();
    const en7d = hoyMs + 7 * 24 * 60 * 60 * 1000;

    for (const e of entregables) {
      if (e.estado === "entregado") {
        entregados++;
      } else {
        const fechaMs = new Date(e.fecha_limite + "T00:00:00").getTime();
        if (fechaMs < hoyMs) vencidos++;
        else if (fechaMs <= en7d) proximos_7d++;
      }
    }

    const pct_on_time = total > 0 ? Math.round((entregados / total) * 100) : 0;
    let semaforo: "verde" | "amarillo" | "rojo" = "verde";
    if (vencidos > 0 || pct_on_time < 70) semaforo = "rojo";
    else if (proximos_7d > 3 || pct_on_time < 90) semaforo = "amarillo";

    return { total, entregados, vencidos, proximos_7d, pct_on_time, semaforo };
  }, [entregables, hoy]);

  // Top 5 urgentes
  const top5Urgentes = useMemo(() => {
    return [...entregables]
      .filter((e) => e.estado !== "entregado")
      .sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite))
      .slice(0, 5);
  }, [entregables]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Hero global con semáforo */}
      <Surface
        variant="glass"
        className={cn(
          "relative overflow-hidden border-2",
          global.semaforo === "verde" && "border-positive/30",
          global.semaforo === "amarillo" && "border-warning/30",
          global.semaforo === "rojo" && "border-negative/30",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <span
              className={cn(
                "inline-flex h-14 w-14 items-center justify-center rounded-2xl",
                global.semaforo === "verde" && "bg-positive/15 text-positive",
                global.semaforo === "amarillo" && "bg-warning/15 text-warning",
                global.semaforo === "rojo" && "bg-negative/15 text-negative",
              )}
            >
              <ShieldCheck className="h-7 w-7" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-xs uppercase tracking-[0.15em] text-ink-500">
                Estado de Compliance
              </p>
              <h2 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
                {global.semaforo === "verde" && "Todo bajo control"}
                {global.semaforo === "amarillo" && "Atención esta semana"}
                {global.semaforo === "rojo" && "🚨 Acción requerida"}
              </h2>
              <p className="mt-1 text-sm text-ink-600">
                {global.entregados} de {global.total} entregables on time (
                {global.pct_on_time}%) en los últimos 12 meses + próximos 12.
              </p>
            </div>
          </div>

          {/* Stats inline */}
          <div className="flex flex-wrap gap-3">
            <MiniStat
              label="Vencidos"
              value={global.vencidos}
              tone={global.vencidos > 0 ? "negative" : "positive"}
              Icon={AlertTriangle}
            />
            <MiniStat
              label="Esta semana"
              value={global.proximos_7d}
              tone={global.proximos_7d > 0 ? "warning" : "ink"}
              Icon={Clock}
            />
            <MiniStat
              label="Entregados"
              value={global.entregados}
              tone="positive"
              Icon={CheckCircle2}
            />
          </div>
        </div>
      </Surface>

      {/* Grid por categoría */}
      <Surface>
        <Surface.Header divider>
          <Surface.Title>
            <span className="inline-flex items-center gap-2">
              <CalendarDays
                className="h-5 w-5 text-cehta-green"
                strokeWidth={1.75}
              />
              Por categoría
            </span>
          </Surface.Title>
          <Surface.Subtitle>
            Estado consolidado de cada bloque del reglamento (clickeá para
            filtrar abajo)
          </Surface.Subtitle>
        </Surface.Header>
        <Surface.Body>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            {statsPorCategoria.map((s) => (
              <CategoriaCard key={s.categoria} stats={s} />
            ))}
          </div>
        </Surface.Body>
      </Surface>

      {/* Top 5 urgentes con quick action */}
      {top5Urgentes.length > 0 && (
        <Surface>
          <Surface.Header divider>
            <Surface.Title>
              <span className="inline-flex items-center gap-2">
                <TrendingUp
                  className="h-5 w-5 text-warning"
                  strokeWidth={1.75}
                />
                Top 5 urgentes — actuá esta semana
              </span>
            </Surface.Title>
            <Surface.Subtitle>
              Ordenados por fecha más cercana. Quick action: marcar entregado.
            </Surface.Subtitle>
          </Surface.Header>
          <Surface.Body>
            <ul className="space-y-2">
              {top5Urgentes.map((e) => (
                <UrgenteRow
                  key={e.entregable_id}
                  entregable={e}
                  onMarcar={() => setMarcarTarget(e)}
                />
              ))}
            </ul>
          </Surface.Body>
        </Surface>
      )}

      {/* Modal marcar entregado */}
      {marcarTarget && (
        <MarcarEntregadoDialog
          open={!!marcarTarget}
          onOpenChange={(o) => {
            if (!o) setMarcarTarget(null);
          }}
          entregable={marcarTarget}
          estadoTarget="entregado"
          onSuccess={() => setMarcarTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Sub-componentes ───────────────────────────────────────────────────────

function CategoriaCard({ stats }: { stats: CategoriaStats }) {
  const tone =
    stats.vencidos > 0
      ? "negative"
      : stats.proximos_7d > 0
      ? "warning"
      : stats.pct_on_time >= 90
      ? "positive"
      : "ink";

  const ringClasses = {
    negative: "ring-negative/30",
    warning: "ring-warning/30",
    positive: "ring-positive/30",
    ink: "ring-hairline",
  }[tone];

  return (
    <div
      className={cn(
        "rounded-2xl bg-white p-4 ring-1 transition-shadow hover:shadow-card-hover",
        ringClasses,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-medium text-ink-700">
            <span aria-hidden>{CATEGORIA_ICON[stats.categoria]}</span>
            {CATEGORIA_LABEL[stats.categoria]}
          </p>
          <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-ink-900">
            {stats.entregados}
            <span className="text-lg font-light text-ink-400">
              {" "}
              / {stats.total}
            </span>
          </p>
          <p className="text-xs text-ink-500">
            {stats.pct_on_time}% on time
          </p>
        </div>

        {/* Mini badge si hay alertas */}
        {(stats.vencidos > 0 || stats.proximos_7d > 0) && (
          <div className="flex flex-col items-end gap-1">
            {stats.vencidos > 0 && (
              <span className="rounded-md bg-negative/10 px-2 py-0.5 text-[10px] font-bold text-negative">
                {stats.vencidos} vencidos
              </span>
            )}
            {stats.proximos_7d > 0 && (
              <span className="rounded-md bg-warning/10 px-2 py-0.5 text-[10px] font-bold text-warning">
                {stats.proximos_7d} en 7d
              </span>
            )}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-1000",
            tone === "positive" && "bg-positive",
            tone === "warning" && "bg-warning",
            tone === "negative" && "bg-negative",
            tone === "ink" && "bg-cehta-green",
          )}
          style={{ width: `${stats.pct_on_time}%` }}
        />
      </div>
    </div>
  );
}

function UrgenteRow({
  entregable,
  onMarcar,
}: {
  entregable: EntregableRead;
  onMarcar: () => void;
}) {
  const fecha = new Date(entregable.fecha_limite + "T00:00:00");
  const hoy = new Date();
  const diasRestantes =
    entregable.dias_restantes ??
    Math.floor((fecha.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
  const esVencido = diasRestantes < 0;
  const fechaFmt = fecha.toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-white px-4 py-3 transition-colors hover:bg-ink-50/40",
        esVencido ? "border-negative/30" : "border-hairline",
      )}
    >
      <span className="text-xl" aria-hidden>
        {CATEGORIA_ICON[entregable.categoria]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-600">
            {entregable.categoria}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-ink-400">
            {entregable.periodo}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm font-medium text-ink-900">
          {entregable.nombre}
        </p>
        <p className="text-xs text-ink-500">
          {entregable.responsable} · {fechaFmt}
        </p>
      </div>
      <div className="text-right">
        <p
          className={cn(
            "font-mono text-sm font-bold tabular-nums",
            esVencido ? "text-negative" : diasRestantes <= 7 ? "text-warning" : "text-ink-700",
          )}
        >
          {esVencido
            ? `Hace ${Math.abs(diasRestantes)}d`
            : diasRestantes === 0
            ? "HOY"
            : `En ${diasRestantes}d`}
        </p>
      </div>
      <button
        type="button"
        onClick={onMarcar}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-positive/10 px-2.5 py-1.5 text-xs font-medium text-positive transition-colors hover:bg-positive/20"
      >
        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
        Marcar entregado
      </button>
    </li>
  );
}

function MiniStat({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  tone: "positive" | "warning" | "negative" | "ink";
  Icon: React.ElementType;
}) {
  const colors = {
    positive: "bg-positive/10 text-positive",
    warning: "bg-warning/10 text-warning",
    negative: "bg-negative/10 text-negative",
    ink: "bg-ink-100 text-ink-600",
  }[tone];
  return (
    <div className="rounded-xl border border-hairline bg-white px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-md", colors)}>
          <Icon className="h-3 w-3" strokeWidth={2} />
        </span>
        <p className="text-[10px] uppercase tracking-wider text-ink-400">
          {label}
        </p>
      </div>
      <p className="mt-1 font-display text-xl font-semibold tabular-nums text-ink-900">
        {value}
      </p>
    </div>
  );
}
