"use client";

/**
 * Calendario de Entregables Regulatorios — FIP CEHTA ESG / AFIS S.A.
 *
 * V4 fase 6 — Implementación del PROMPT_MAESTRO_calendario_entregables.
 *
 * 3 vistas tab navigables:
 *   1) Próximos — lista por fecha ASC con filtros
 *   2) Mensual — grid calendario 1 mes con pills de entregables por día
 *   3) Timeline — barra horizontal 12 meses
 *
 * Compliance (Bloque 10 del PROMPT_MAESTRO):
 *   - Sin TIR/IRR/rentabilidades
 *   - Sin montos USD del portafolio en pantalla
 *   - "AFIS S.A." en contextos externos (este es uso interno).
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  Filter,
  ListChecks,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { EntregableCard } from "@/components/entregables/EntregableCard";
import {
  type CategoriaEntregable,
  type EstadoEntregable,
  type EntregableRead,
  useEntregables,
  useEntregablesCounts,
  useReporteRegulatorio,
} from "@/hooks/use-entregables";

type Vista = "proximos" | "mensual" | "timeline";

const CATEGORIAS: ComboboxItem[] = [
  { value: "", label: "Todas las categorías" },
  { value: "CMF", label: "CMF" },
  { value: "CORFO", label: "CORFO" },
  { value: "UAF", label: "UAF" },
  { value: "SII", label: "SII" },
  { value: "INTERNO", label: "Interno" },
  { value: "AUDITORIA", label: "Auditoría" },
  { value: "ASAMBLEA", label: "Asamblea" },
  { value: "OPERACIONAL", label: "Operacional" },
];

const ESTADOS: ComboboxItem[] = [
  { value: "", label: "Todos los estados" },
  { value: "pendiente", label: "Pendiente" },
  { value: "en_proceso", label: "En proceso" },
  { value: "entregado", label: "Entregado" },
  { value: "no_entregado", label: "No entregado" },
];

const MES_NOMBRES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function exportarCSV(entregables: EntregableRead[]): void {
  const headers = [
    "ID", "Nombre", "Categoría", "Período", "Fecha Límite",
    "Días Restantes", "Estado", "Fecha Entrega Real", "Notas",
    "Referencia Normativa", "Responsable",
  ];
  const rows = entregables.map((e) => [
    e.entregable_id,
    e.nombre,
    e.categoria,
    e.periodo,
    e.fecha_limite,
    e.dias_restantes ?? "",
    e.estado,
    e.fecha_entrega_real ?? "",
    e.notas ?? "",
    e.referencia_normativa ?? "",
    e.responsable,
  ]);
  const csv = [
    headers.join(","),
    ...rows.map((r) => r.map(escapeCSV).join(",")),
  ].join("\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `entregables_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function EntregablesPage() {
  const [vista, setVista] = useState<Vista>("proximos");
  const [categoria, setCategoria] = useState<string>("");
  const [estado, setEstado] = useState<string>("");
  const [mesActual, setMesActual] = useState(new Date());

  const filters = useMemo(
    () => ({
      categoria: (categoria || undefined) as CategoriaEntregable | undefined,
      estado: (estado || undefined) as EstadoEntregable | undefined,
    }),
    [categoria, estado],
  );

  const entregablesQ = useEntregables(filters);
  const countsQ = useEntregablesCounts();

  const entregables = entregablesQ.data ?? [];
  const counts = countsQ.data ?? {
    pendiente: 0, en_proceso: 0, entregado: 0, no_entregado: 0,
  };

  const alertasActivas = useMemo(
    () =>
      entregables.filter(
        (e) =>
          (e.estado === "pendiente" || e.estado === "en_proceso") &&
          (e.nivel_alerta === "vencido" ||
            e.nivel_alerta === "hoy" ||
            e.nivel_alerta === "critico" ||
            e.nivel_alerta === "urgente" ||
            e.nivel_alerta === "proximo"),
      ),
    [entregables],
  );

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      {/* Header */}
      <Surface variant="glass" className="border border-cehta-green/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cehta-green/15 text-cehta-green">
                <ClipboardList className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
                  Calendario de Entregables
                </h1>
                <p className="text-xs text-ink-500">
                  AFIS S.A. · RUT 77.423.556-6 · FIP CEHTA ESG ·{" "}
                  Compliance Regulatorio
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => exportarCSV(entregables)}
            disabled={entregables.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors duration-150 ease-apple hover:bg-ink-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" strokeWidth={1.75} />
            Exportar CSV
          </button>
        </div>

        {/* KPIs */}
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiTile
            label="Críticos"
            value={alertasActivas.filter(
              (e) => e.nivel_alerta === "vencido" || e.nivel_alerta === "hoy" || e.nivel_alerta === "critico"
            ).length}
            tone="negative"
            Icon={AlertTriangle}
          />
          <KpiTile label="Pendientes" value={counts.pendiente} tone="ink" Icon={ListChecks} />
          <KpiTile label="En proceso" value={counts.en_proceso} tone="info" Icon={ClipboardList} />
          <KpiTile label="Entregados" value={counts.entregado} tone="positive" Icon={CheckCircle2} />
        </div>
      </Surface>

      {/* Banner de alertas activas */}
      {alertasActivas.length > 0 && (
        <Surface className="border border-warning/30 bg-warning/5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-warning/15 text-warning">
              <AlertTriangle className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-warning">
                {alertasActivas.length} entregable
                {alertasActivas.length === 1 ? "" : "s"} con alerta activa (≤15 días)
              </p>
              <p className="mt-0.5 text-xs text-ink-600">
                Ordenados por urgencia descendente. Acción inmediata recomendada
                en los marcados como críticos.
              </p>
            </div>
          </div>
        </Surface>
      )}

      {/* Tabs de vistas */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl bg-ink-100/50 p-0.5 ring-1 ring-hairline">
          <ViewTab vista={vista} target="proximos" set={setVista} Icon={ListChecks} label="Próximos" />
          <ViewTab vista={vista} target="mensual" set={setVista} Icon={CalendarIcon} label="Mensual" />
          <ViewTab vista={vista} target="timeline" set={setVista} Icon={FileText} label="Timeline" />
        </div>

        <div className="ml-auto flex flex-wrap items-end gap-2">
          <Filter className="h-4 w-4 text-ink-400" strokeWidth={1.75} />
          <Combobox
            items={CATEGORIAS}
            value={categoria}
            onValueChange={setCategoria}
            placeholder="Categoría"
            triggerClassName="min-w-[180px]"
          />
          <Combobox
            items={ESTADOS}
            value={estado}
            onValueChange={setEstado}
            placeholder="Estado"
            triggerClassName="min-w-[180px]"
          />
        </div>
      </div>

      {/* Vista activa */}
      {entregablesQ.isLoading && (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      )}

      {entregablesQ.error && (
        <Surface className="border border-negative/20 bg-negative/5">
          <Surface.Title className="text-negative">
            No se pudo cargar los entregables
          </Surface.Title>
          <Surface.Subtitle>{entregablesQ.error.message}</Surface.Subtitle>
        </Surface>
      )}

      {!entregablesQ.isLoading && !entregablesQ.error && (
        <>
          {vista === "proximos" && <VistaProximos entregables={entregables} />}
          {vista === "mensual" && (
            <VistaMensual
              entregables={entregables}
              mesActual={mesActual}
              setMesActual={setMesActual}
            />
          )}
          {vista === "timeline" && <VistaTimeline entregables={entregables} />}
        </>
      )}
    </div>
  );
}

// ─── Sub-componentes ────────────────────────────────────────────────────────

function ViewTab({
  vista,
  target,
  set,
  Icon,
  label,
}: {
  vista: Vista;
  target: Vista;
  set: (v: Vista) => void;
  Icon: React.ElementType;
  label: string;
}) {
  const active = vista === target;
  return (
    <button
      type="button"
      onClick={() => set(target)}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150 ease-apple ${
        active
          ? "bg-white text-ink-900 shadow-card/40"
          : "text-ink-600 hover:bg-white/40"
      }`}
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
      {label}
    </button>
  );
}

function KpiTile({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  tone: "negative" | "info" | "positive" | "ink";
  Icon: React.ElementType;
}) {
  const colors = {
    negative: "text-negative bg-negative/10",
    info: "text-info bg-info/10",
    positive: "text-positive bg-positive/10",
    ink: "text-ink-700 bg-ink-100/50",
  }[tone];
  return (
    <div className="flex items-center gap-3 rounded-xl border border-hairline bg-white px-3 py-2.5">
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${colors}`}>
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div>
        <p className="text-2xl font-semibold tabular-nums text-ink-900">{value}</p>
        <p className="text-[10px] uppercase tracking-wider text-ink-400">
          {label}
        </p>
      </div>
    </div>
  );
}

// ─── Vista 1: Próximos ──────────────────────────────────────────────────────

function VistaProximos({ entregables }: { entregables: EntregableRead[] }) {
  if (entregables.length === 0) {
    return (
      <Surface className="py-16 text-center">
        <p className="text-base font-semibold text-ink-900">Sin entregables</p>
        <p className="mt-1 text-sm text-ink-500">
          Probá ajustando los filtros o agregando uno nuevo.
        </p>
      </Surface>
    );
  }
  return (
    <div className="space-y-3">
      {entregables.map((e) => (
        <EntregableCard key={e.entregable_id} entregable={e} />
      ))}
    </div>
  );
}

// ─── Vista 2: Calendario Mensual ────────────────────────────────────────────

function VistaMensual({
  entregables,
  mesActual,
  setMesActual,
}: {
  entregables: EntregableRead[];
  mesActual: Date;
  setMesActual: (d: Date) => void;
}) {
  const year = mesActual.getFullYear();
  const month = mesActual.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = (firstDay.getDay() + 6) % 7; // lunes = 0
  const daysInMonth = lastDay.getDate();

  // Agrupar entregables por día del mes mostrado
  const porDia = useMemo(() => {
    const map: Record<number, EntregableRead[]> = {};
    for (const e of entregables) {
      const d = new Date(e.fecha_limite + "T00:00:00");
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day]!.push(e);
      }
    }
    return map;
  }, [entregables, year, month]);

  const cells: (number | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const isToday = (d: number) =>
    today.getFullYear() === year &&
    today.getMonth() === month &&
    today.getDate() === d;

  return (
    <Surface padding="none">
      <Surface.Header className="flex items-center justify-between border-b border-hairline px-5 py-3">
        <button
          type="button"
          onClick={() => setMesActual(new Date(year, month - 1, 1))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100/50"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <p className="font-display text-lg font-semibold tracking-tight text-ink-900">
          {MES_NOMBRES[month]} {year}
        </p>
        <button
          type="button"
          onClick={() => setMesActual(new Date(year, month + 1, 1))}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 hover:bg-ink-100/50"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </Surface.Header>

      <div className="grid grid-cols-7 border-b border-hairline">
        {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
          <div
            key={d}
            className="border-r border-hairline px-2 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-ink-400 last:border-r-0"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (day === null) {
            return (
              <div
                key={`empty-${i}`}
                className="min-h-[110px] border-b border-r border-hairline bg-ink-50/30 last:border-r-0"
              />
            );
          }
          const items = porDia[day] ?? [];
          return (
            <div
              key={day}
              className={`min-h-[110px] border-b border-r border-hairline p-1.5 last:border-r-0 ${
                isToday(day) ? "bg-cehta-green/5" : ""
              }`}
            >
              <p
                className={`mb-1 text-[11px] font-semibold tabular-nums ${
                  isToday(day) ? "text-cehta-green" : "text-ink-500"
                }`}
              >
                {day}
              </p>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((e) => (
                  <div
                    key={e.entregable_id}
                    title={`${e.nombre} (${e.categoria} · ${e.estado})`}
                    className={`truncate rounded px-1 py-0.5 text-[9px] font-medium leading-tight ${
                      e.estado === "entregado"
                        ? "bg-positive/10 text-positive line-through"
                        : e.nivel_alerta === "vencido" ||
                            e.nivel_alerta === "hoy" ||
                            e.nivel_alerta === "critico"
                          ? "bg-negative/10 text-negative"
                          : e.nivel_alerta === "urgente" ||
                              e.nivel_alerta === "proximo"
                            ? "bg-warning/10 text-warning"
                            : "bg-ink-100/50 text-ink-600"
                    }`}
                  >
                    {e.categoria} · {e.nombre.slice(0, 18)}
                  </div>
                ))}
                {items.length > 3 && (
                  <p className="px-1 text-[9px] text-ink-400">
                    +{items.length - 3} más
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Surface>
  );
}

// ─── Vista 3: Timeline anual ────────────────────────────────────────────────

function VistaTimeline({ entregables }: { entregables: EntregableRead[] }) {
  const year = new Date().getFullYear();

  // Agrupar por mes (0-11)
  const porMes: Record<number, EntregableRead[]> = useMemo(() => {
    const map: Record<number, EntregableRead[]> = {};
    for (let m = 0; m < 12; m++) map[m] = [];
    for (const e of entregables) {
      const d = new Date(e.fecha_limite + "T00:00:00");
      if (d.getFullYear() === year) {
        map[d.getMonth()]!.push(e);
      }
    }
    return map;
  }, [entregables, year]);

  return (
    <Surface padding="none">
      <Surface.Header className="border-b border-hairline px-5 py-3">
        <Surface.Title>Timeline anual {year}</Surface.Title>
        <Surface.Subtitle>
          Distribución mensual de entregables — identificá meses con sobrecarga.
        </Surface.Subtitle>
      </Surface.Header>
      <div className="space-y-1 p-4">
        {MES_NOMBRES.map((nombre, i) => {
          const items = porMes[i] ?? [];
          const criticos = items.filter(
            (e) =>
              e.nivel_alerta === "critico" ||
              e.nivel_alerta === "vencido" ||
              e.nivel_alerta === "hoy",
          );
          return (
            <div
              key={nombre}
              className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-ink-50/40"
            >
              <span className="w-24 shrink-0 text-sm font-medium text-ink-900">
                {nombre}
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap gap-1">
                  {items.slice(0, 12).map((e) => (
                    <span
                      key={e.entregable_id}
                      title={`${e.nombre} · ${e.fecha_limite}`}
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-md text-[9px] font-bold ${
                        e.estado === "entregado"
                          ? "bg-positive/15 text-positive"
                          : e.nivel_alerta === "vencido" ||
                              e.nivel_alerta === "hoy" ||
                              e.nivel_alerta === "critico"
                            ? "bg-negative/15 text-negative"
                            : "bg-ink-100/60 text-ink-700"
                      }`}
                    >
                      {e.categoria.slice(0, 1)}
                    </span>
                  ))}
                  {items.length > 12 && (
                    <span className="text-[10px] text-ink-400">+{items.length - 12}</span>
                  )}
                </div>
              </div>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-ink-500">
                {items.length} ent.
              </span>
              {criticos.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-negative/10 px-1.5 py-0.5 text-[10px] font-bold text-negative">
                  <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.5} />
                  {criticos.length} críticos
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Surface>
  );
}
