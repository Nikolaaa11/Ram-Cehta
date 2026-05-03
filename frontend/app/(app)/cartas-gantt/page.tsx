"use client";

/**
 * Cartas Gantt Cross-Empresa — Vista consolidada para CEO/Ejecutivos.
 *
 * Agrega los proyectos de las 9 empresas en una única vista. Cada empresa
 * tiene su sección colapsable con sus proyectos, Gantt y KPIs.
 *
 * Se accede desde sidebar Ejecutivo · Cartas Gantt (debajo de Calendario).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  GanttChartSquare,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Target,
  TrendingUp,
  Pencil,
  ExternalLink,
  Loader2,
  Filter,
} from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { GanttMini } from "@/components/avance/GanttMini";
import { SincronizarTodosButton } from "@/components/avance/SincronizarTodosButton";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { useMe } from "@/hooks/use-me";
import { useSession } from "@/hooks/use-session";
import { usePageShortcuts } from "@/hooks/use-page-shortcuts";
import { apiClient } from "@/lib/api/client";
import { SavedViewsMenu } from "@/components/shared/SavedViewsMenu";
import type { ProyectoListItem, HitoRead } from "@/lib/api/schema";

type ViewFilter = "todas" | "criticas" | "en_progreso";

const VIEW_OPTIONS: ComboboxItem[] = [
  { value: "todas", label: "Todas las empresas" },
  { value: "criticas", label: "Solo con riesgos críticos" },
  { value: "en_progreso", label: "Solo con proyectos en progreso" },
];

interface EmpresaConProyectos {
  codigo: string;
  razon_social: string;
  proyectos: ProyectoListItem[];
  isLoading: boolean;
  error: Error | null;
}

export default function CartasGanttPage() {
  const { data: empresas = [], isLoading: empresasLoading } =
    useCatalogoEmpresas();
  const { session } = useSession();
  const { data: me } = useMe();
  const canSync = me?.allowed_actions?.includes("avance:create") ?? false;
  const [filter, setFilter] = useState<ViewFilter>("todas");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // V4 fase 7.8 — Keyboard shortcuts
  usePageShortcuts({
    Escape: () => {
      setFilter("todas");
      setExpanded(new Set());
    },
    "f t": () => setFilter("todas"),
    "f c": () => setFilter("criticas"),
    "f p": () => setFilter("en_progreso"),
    e: () => {
      // expandir/colapsar todas las empresas
      setExpanded((prev) => {
        if (prev.size === 0) {
          // expandir todas — necesitamos los códigos
          return new Set(empresas.map((emp) => emp.codigo));
        }
        return new Set();
      });
    },
  });

  // Fetch en paralelo los proyectos de cada empresa
  const proyectosQueries = useQueries({
    queries: empresas.map((e) => ({
      queryKey: ["avance", "proyectos", e.codigo],
      queryFn: () =>
        apiClient.get<ProyectoListItem[]>(
          `/avance/${e.codigo}/proyectos`,
          session,
        ),
      enabled: !!session && empresas.length > 0,
      staleTime: 5 * 60 * 1000,
    })),
  });

  // Combinar empresas + sus queries
  const empresasConProyectos: EmpresaConProyectos[] = useMemo(
    () =>
      empresas.map((e, i) => {
        const q = proyectosQueries[i];
        return {
          codigo: e.codigo,
          razon_social: e.razon_social,
          proyectos: q?.data ?? [],
          isLoading: q?.isLoading ?? false,
          error: q?.error ?? null,
        };
      }),
    [empresas, proyectosQueries],
  );

  // Aplicar filtros
  const visibles = useMemo(() => {
    if (filter === "todas") return empresasConProyectos;
    if (filter === "criticas") {
      return empresasConProyectos.filter((e) =>
        e.proyectos.some((p) => p.riesgos_abiertos > 0),
      );
    }
    if (filter === "en_progreso") {
      return empresasConProyectos.filter((e) =>
        e.proyectos.some((p) => p.estado === "en_progreso"),
      );
    }
    return empresasConProyectos;
  }, [empresasConProyectos, filter]);

  // KPIs cross-empresa
  const kpis = useMemo(() => {
    let totalProyectos = 0;
    let enProgreso = 0;
    let completados = 0;
    let totalHitos = 0;
    let hitosCompletados = 0;
    let totalRiesgos = 0;

    for (const e of empresasConProyectos) {
      totalProyectos += e.proyectos.length;
      for (const p of e.proyectos) {
        if (p.estado === "en_progreso") enProgreso++;
        if (p.estado === "completado") completados++;
        totalHitos += p.hitos?.length ?? 0;
        hitosCompletados +=
          p.hitos?.filter((h) => h.estado === "completado").length ?? 0;
        totalRiesgos += p.riesgos_abiertos ?? 0;
      }
    }
    return {
      totalProyectos,
      enProgreso,
      completados,
      totalHitos,
      hitosCompletados,
      pctHitos:
        totalHitos > 0 ? Math.round((hitosCompletados / totalHitos) * 100) : 0,
      totalRiesgos,
      empresasConProyectos: empresasConProyectos.filter(
        (e) => e.proyectos.length > 0,
      ).length,
    };
  }, [empresasConProyectos]);

  const toggleExpanded = (codigo: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo);
      else next.add(codigo);
      return next;
    });
  };

  const expandirTodas = () => {
    setExpanded(new Set(visibles.map((e) => e.codigo)));
  };

  const contraerTodas = () => {
    setExpanded(new Set());
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* Header */}
      <Surface variant="glass" className="border border-cehta-green/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cehta-green/15 text-cehta-green">
                <GanttChartSquare className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
                  Cartas Gantt — Vista Portafolio
                </h1>
                <p className="text-xs text-ink-500">
                  Proyectos de las 9 empresas · hitos · riesgos · KPIs
                  consolidados
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSync && <SincronizarTodosButton />}
            <SavedViewsMenu
              page="cartas_gantt"
              currentFilters={{ filter }}
              onApply={(f) => {
                if (typeof f.filter === "string")
                  setFilter(f.filter as ViewFilter);
              }}
            />
            <Filter className="h-4 w-4 text-ink-400" strokeWidth={1.75} />
            <Combobox
              items={VIEW_OPTIONS}
              value={filter}
              onValueChange={(v) => setFilter(v as ViewFilter)}
              placeholder="Filtro"
              triggerClassName="min-w-[220px]"
            />
            <button
              type="button"
              onClick={expandirTodas}
              className="rounded-lg border border-hairline bg-white px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              Expandir todo
            </button>
            <button
              type="button"
              onClick={contraerTodas}
              className="rounded-lg border border-hairline bg-white px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              Contraer todo
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <KpiTile
            label="Proyectos"
            value={kpis.totalProyectos}
            sub={`${kpis.empresasConProyectos} empresas`}
            Icon={Target}
            tone="cehta"
          />
          <KpiTile
            label="En progreso"
            value={kpis.enProgreso}
            sub={`${kpis.completados} completados`}
            Icon={Clock}
            tone="info"
          />
          <KpiTile
            label="Hitos cumplidos"
            value={`${kpis.hitosCompletados}/${kpis.totalHitos}`}
            sub={`${kpis.pctHitos}% del total`}
            Icon={CheckCircle2}
            tone="positive"
          />
          <KpiTile
            label="Riesgos abiertos"
            value={kpis.totalRiesgos}
            sub="cross-portfolio"
            Icon={AlertTriangle}
            tone={kpis.totalRiesgos > 0 ? "negative" : "ink"}
          />
          <KpiTile
            label="Avance promedio"
            value={`${kpis.pctHitos}%`}
            sub="por hitos cumplidos"
            Icon={TrendingUp}
            tone="cehta"
          />
        </div>
      </Surface>

      {/* Loading inicial */}
      {empresasLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      )}

      {/* Empresas con proyectos */}
      {!empresasLoading &&
        visibles.map((empresa) => (
          <EmpresaProyectos
            key={empresa.codigo}
            empresa={empresa}
            isExpanded={expanded.has(empresa.codigo)}
            onToggle={() => toggleExpanded(empresa.codigo)}
          />
        ))}

      {/* Empty state global: ninguna empresa tiene proyectos importados */}
      {!empresasLoading &&
        kpis.totalProyectos === 0 &&
        empresasConProyectos.every((e) => !e.isLoading && !e.error) && (
          <Surface className="py-12 text-center">
            <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green">
              <GanttChartSquare className="h-7 w-7" strokeWidth={1.5} />
            </span>
            <p className="mt-3 text-base font-semibold text-ink-900">
              Aún no hay Gantts en el portafolio
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
              Subí los <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs">Roadmap.xlsx</code> de
              cada empresa a Dropbox en{" "}
              <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-xs">
                01-Empresas/{`{empresa}`}/05-Proyectos &amp; Avance/
              </code>
              {" "}y luego presioná{" "}
              <span className="font-medium text-cehta-green">
                Sincronizar todos los Gantts
              </span>{" "}
              en la parte superior.
            </p>
            {canSync && (
              <div className="mt-4 flex justify-center">
                <SincronizarTodosButton />
              </div>
            )}
          </Surface>
        )}

      {!empresasLoading && visibles.length === 0 && kpis.totalProyectos > 0 && (
        <Surface className="py-16 text-center">
          <p className="text-base font-semibold text-ink-900">
            Sin empresas que coincidan con el filtro
          </p>
          <p className="mt-1 text-sm text-ink-500">
            Probá con &ldquo;Todas las empresas&rdquo;.
          </p>
        </Surface>
      )}
    </div>
  );
}

// ─── Sub-componentes ────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  sub,
  Icon,
  tone,
}: {
  label: string;
  value: string | number;
  sub: string;
  Icon: React.ElementType;
  tone: "cehta" | "info" | "positive" | "negative" | "ink";
}) {
  const colors = {
    cehta: "text-cehta-green bg-cehta-green/10",
    info: "text-info bg-info/10",
    positive: "text-positive bg-positive/10",
    negative: "text-negative bg-negative/10",
    ink: "text-ink-700 bg-ink-100/50",
  }[tone];
  return (
    <div className="rounded-xl border border-hairline bg-white px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${colors}`}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <p className="text-[10px] uppercase tracking-wider text-ink-400">
          {label}
        </p>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
        {value}
      </p>
      <p className="text-[11px] text-ink-500">{sub}</p>
    </div>
  );
}

function EmpresaProyectos({
  empresa,
  isExpanded,
  onToggle,
}: {
  empresa: EmpresaConProyectos;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const proyectosCount = empresa.proyectos.length;
  const enProgreso = empresa.proyectos.filter(
    (p) => p.estado === "en_progreso",
  ).length;
  const completados = empresa.proyectos.filter(
    (p) => p.estado === "completado",
  ).length;
  const riesgos = empresa.proyectos.reduce(
    (sum, p) => sum + (p.riesgos_abiertos ?? 0),
    0,
  );

  if (empresa.isLoading) {
    return (
      <Surface padding="compact">
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
          <span className="text-sm text-ink-500">
            Cargando proyectos de {empresa.codigo}…
          </span>
        </div>
      </Surface>
    );
  }

  if (empresa.error) {
    return (
      <Surface padding="compact" className="bg-negative/5 ring-negative/20">
        <p className="text-sm text-negative">
          {empresa.codigo}: {empresa.error.message}
        </p>
      </Surface>
    );
  }

  if (proyectosCount === 0) {
    return null; // No mostrar empresas sin proyectos
  }

  return (
    <Surface padding="none">
      {/* Header colapsable */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-ink-50/40"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" strokeWidth={2} />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" strokeWidth={2} />
        )}
        <EmpresaLogo empresaCodigo={empresa.codigo} size={36} />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-ink-900">
            {empresa.razon_social}
          </p>
          <p className="text-xs text-ink-500">
            {proyectosCount} proyecto{proyectosCount !== 1 ? "s" : ""} ·{" "}
            {enProgreso} en progreso · {completados} completados
            {riesgos > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-negative/10 px-1.5 py-0.5 text-[10px] font-bold text-negative">
                <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.5} />
                {riesgos} riesgos
              </span>
            )}
          </p>
        </div>
        <Link
          href={`/empresa/${empresa.codigo}/avance`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
        >
          <Pencil className="h-3 w-3" strokeWidth={1.75} />
          Editar
          <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
        </Link>
      </button>

      {/* Contenido expandido: cards de proyectos */}
      {isExpanded && (
        <div className="border-t border-hairline bg-ink-50/20 p-4">
          <div className="space-y-4">
            {empresa.proyectos.map((p) => (
              <ProyectoCard
                key={p.proyecto_id}
                proyecto={p}
                empresaCodigo={empresa.codigo}
              />
            ))}
          </div>
        </div>
      )}
    </Surface>
  );
}

const ESTADO_PROYECTO_BADGE: Record<
  string,
  { label: string; className: string }
> = {
  planificado: {
    label: "Planificado",
    className: "bg-ink-100 text-ink-700",
  },
  en_progreso: {
    label: "En progreso",
    className: "bg-info/15 text-info",
  },
  completado: {
    label: "Completado",
    className: "bg-positive/15 text-positive",
  },
  cancelado: {
    label: "Cancelado",
    className: "bg-negative/15 text-negative",
  },
  pausado: {
    label: "Pausado",
    className: "bg-warning/15 text-warning",
  },
};

function ProyectoCard({
  proyecto,
  empresaCodigo,
}: {
  proyecto: ProyectoListItem;
  empresaCodigo: string;
}) {
  const [showDetalle, setShowDetalle] = useState(false);

  const estadoBadge = ESTADO_PROYECTO_BADGE[proyecto.estado] ?? {
    label: proyecto.estado,
    className: "bg-ink-100 text-ink-700",
  };

  const hitos = proyecto.hitos ?? [];
  const hitosCompletados = hitos.filter(
    (h: HitoRead) => h.estado === "completado",
  ).length;
  const hitosEnProgreso = hitos.filter(
    (h: HitoRead) => h.estado === "en_progreso",
  ).length;
  const hitosPendientes = hitos.filter(
    (h: HitoRead) => h.estado === "pendiente",
  ).length;

  return (
    <Surface padding="compact" variant="default">
      {/* Header proyecto */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-ink-900">{proyecto.nombre}</h3>
            <span
              className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold ${estadoBadge.className}`}
            >
              {estadoBadge.label}
            </span>
          </div>
          {proyecto.descripcion && (
            <p className="mt-0.5 text-xs text-ink-600">{proyecto.descripcion}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums text-cehta-green">
            {proyecto.progreso_pct}%
          </p>
          <p className="text-[10px] uppercase tracking-wider text-ink-400">
            avance
          </p>
        </div>
      </div>

      {/* Gantt */}
      <div className="mt-3">
        <GanttMini
          fechaInicio={proyecto.fecha_inicio}
          fechaFin={proyecto.fecha_fin_estimada}
          progresoPct={proyecto.progreso_pct}
          hitos={hitos}
        />
      </div>

      {/* Mini KPIs proyecto */}
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <MiniStat
          label="Hitos"
          value={`${hitosCompletados}/${hitos.length}`}
          tone="positive"
        />
        <MiniStat
          label="En progreso"
          value={hitosEnProgreso}
          tone="info"
        />
        <MiniStat
          label="Pendientes"
          value={hitosPendientes}
          tone="ink"
        />
        <MiniStat
          label="Riesgos"
          value={proyecto.riesgos_abiertos ?? 0}
          tone={proyecto.riesgos_abiertos ? "negative" : "ink"}
        />
      </div>

      {/* Toggle detalle hitos */}
      <button
        type="button"
        onClick={() => setShowDetalle((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-cehta-green hover:underline"
      >
        {showDetalle ? "Ocultar" : "Ver"} detalle hitos
        {showDetalle ? (
          <ChevronDown className="h-3 w-3" strokeWidth={2} />
        ) : (
          <ChevronRight className="h-3 w-3" strokeWidth={2} />
        )}
      </button>

      {showDetalle && hitos.length > 0 && (
        <div className="mt-2 space-y-1 rounded-xl bg-ink-50/40 p-2">
          {hitos
            .slice()
            .sort((a, b) => {
              const fa = a.fecha_planificada ?? "";
              const fb = b.fecha_planificada ?? "";
              return fa.localeCompare(fb);
            })
            .map((h) => (
              <HitoRow key={h.hito_id} hito={h} />
            ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-hairline pt-2">
        <Link
          href={`/empresa/${empresaCodigo}/avance`}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-600 hover:text-cehta-green"
        >
          <Pencil className="h-3 w-3" strokeWidth={1.75} />
          Actualizar progreso del proyecto
          <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
        </Link>
      </div>
    </Surface>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "positive" | "info" | "ink" | "negative";
}) {
  const color = {
    positive: "text-positive",
    info: "text-info",
    ink: "text-ink-700",
    negative: "text-negative",
  }[tone];
  return (
    <div className="rounded-lg bg-ink-50/60 px-2 py-1.5">
      <p className={`text-base font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-ink-400">
        {label}
      </p>
    </div>
  );
}

const HITO_COLOR: Record<string, string> = {
  completado: "bg-positive",
  en_progreso: "bg-warning",
  pendiente: "bg-ink-300",
  cancelado: "bg-negative",
};

function HitoRow({ hito: h }: { hito: HitoRead }) {
  const fecha = h.fecha_planificada
    ? new Date(h.fecha_planificada + "T00:00:00").toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "Sin fecha";

  return (
    <div className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-xs">
      <span
        className={`inline-block h-2 w-2 rounded-full ${HITO_COLOR[h.estado] ?? "bg-ink-300"}`}
      />
      <span
        className={`flex-1 truncate ${h.estado === "completado" ? "line-through text-ink-400" : "text-ink-800"}`}
      >
        {h.nombre}
      </span>
      <span className="font-mono text-[10px] tabular-nums text-ink-500">
        {fecha}
      </span>
      {(h.progreso_pct ?? 0) > 0 && h.estado !== "completado" && (
        <span className="font-mono text-[10px] tabular-nums text-cehta-green">
          {h.progreso_pct}%
        </span>
      )}
    </div>
  );
}
