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
import { memo, useMemo, useState } from "react";
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
  Upload,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { EntregableCard } from "@/components/entregables/EntregableCard";
import { MarcarEntregadoDialog } from "@/components/entregables/MarcarEntregadoDialog";
import { BulkActionBar } from "@/components/entregables/BulkActionBar";
import { AskAiDialog } from "@/components/entregables/AskAiDialog";
import { CsvImportDialog } from "@/components/entregables/CsvImportDialog";
import { HeatmapYearView } from "@/components/entregables/HeatmapYearView";
import { IcsSubscribeDialog } from "@/components/entregables/IcsSubscribeDialog";
import { SmartInsights } from "@/components/entregables/SmartInsights";
import { SavedViewsMenu } from "@/components/shared/SavedViewsMenu";
import { ExportExcelButton } from "@/components/shared/ExportExcelButton";
import {
  KeyboardShortcutsHelp,
  useEntregablesShortcuts,
} from "@/components/entregables/KeyboardShortcutsHelp";
import {
  type CategoriaEntregable,
  type EstadoEntregable,
  type EntregableRead,
  useEntregables,
  useEntregablesCounts,
  useUpdateEntregable,
} from "@/hooks/use-entregables";

type Vista = "agenda" | "proximos" | "mensual" | "timeline" | "heatmap";

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
  const [vista, setVista] = useState<Vista>("agenda");
  const [categoria, setCategoria] = useState<string>("");
  const [estado, setEstado] = useState<string>("");
  const [mesActual, setMesActual] = useState(new Date());

  // V4 fase 7.6 — Keyboard shortcuts global a la página
  useEntregablesShortcuts({
    setVista,
    clearFilters: () => {
      setCategoria("");
      setEstado("");
    },
  });

  // V4 fase 7.7 — CSV import dialog
  const [importOpen, setImportOpen] = useState(false);
  // V4 fase 7.9 — ICS subscribe dialog
  const [icsOpen, setIcsOpen] = useState(false);
  // V5 fase 1 — Ask AI dialog
  const [askOpen, setAskOpen] = useState(false);

  const filters = useMemo(
    () => ({
      categoria: (categoria || undefined) as CategoriaEntregable | undefined,
      estado: (estado || undefined) as EstadoEntregable | undefined,
    }),
    [categoria, estado],
  );

  const entregablesQ = useEntregables(filters);
  const countsQ = useEntregablesCounts();

  // Memo de array para que useMemo de alertasActivas no re-corra en cada render
  const entregables = useMemo(
    () => entregablesQ.data ?? [],
    [entregablesQ.data],
  );
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAskOpen(true)}
              title="Preguntale al asistente"
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green/10 px-3 py-1.5 text-xs font-medium text-cehta-green ring-1 ring-cehta-green/30 transition-colors hover:bg-cehta-green/15"
            >
              ✨ Preguntar AI
            </button>
            <KeyboardShortcutsHelp />
            <SavedViewsMenu
              page="entregables"
              currentFilters={{ vista, categoria, estado }}
              onApply={(f) => {
                if (typeof f.vista === "string")
                  setVista(f.vista as Vista);
                if (typeof f.categoria === "string")
                  setCategoria(f.categoria);
                if (typeof f.estado === "string")
                  setEstado(f.estado);
              }}
            />
            <a
              href="/entregables/reporte"
              className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors duration-150 ease-apple hover:bg-ink-50"
            >
              <FileText className="h-4 w-4" strokeWidth={1.75} />
              Reporte para acta CV
            </a>
            <button
              type="button"
              onClick={() => setIcsOpen(true)}
              title="Sincronizar con Google Calendar / Outlook"
              className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors duration-150 ease-apple hover:bg-ink-50"
            >
              <CalendarDays className="h-4 w-4" strokeWidth={1.75} />
              Sync calendario
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors duration-150 ease-apple hover:bg-ink-50"
            >
              <Upload className="h-4 w-4" strokeWidth={1.75} />
              Importar CSV
            </button>
            <ExportExcelButton
              entity="entregables"
              estado={estado || null}
              label="Excel"
            />
            <button
              type="button"
              onClick={() => exportarCSV(entregables)}
              disabled={entregables.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors duration-150 ease-apple hover:bg-ink-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4" strokeWidth={1.75} />
              CSV
            </button>
          </div>
        </div>

        <CsvImportDialog open={importOpen} onOpenChange={setImportOpen} />
        <IcsSubscribeDialog open={icsOpen} onOpenChange={setIcsOpen} />
        <AskAiDialog open={askOpen} onOpenChange={setAskOpen} />

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
          <ViewTab vista={vista} target="agenda" set={setVista} Icon={ClipboardList} label="Agenda" />
          <ViewTab vista={vista} target="proximos" set={setVista} Icon={ListChecks} label="Próximos" />
          <ViewTab vista={vista} target="mensual" set={setVista} Icon={CalendarIcon} label="Mensual" />
          <ViewTab vista={vista} target="timeline" set={setVista} Icon={FileText} label="Timeline" />
          <ViewTab vista={vista} target="heatmap" set={setVista} Icon={CalendarDays} label="Heatmap" />
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

      {/* V4 fase 7.12 — Quick filter chips bar (categorías como tabs visuales) */}
      <CategoriaChipsBar
        entregables={entregables}
        active={categoria}
        onChange={setCategoria}
      />

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
          {/* V4 fase 7.10 — Smart Insights template-based */}
          <SmartInsights />

          {vista === "agenda" && <VistaAgenda entregables={entregables} />}
          {vista === "proximos" && <VistaProximos entregables={entregables} />}
          {vista === "mensual" && (
            <VistaMensual
              entregables={entregables}
              mesActual={mesActual}
              setMesActual={setMesActual}
            />
          )}
          {vista === "timeline" && <VistaTimeline entregables={entregables} />}
          {vista === "heatmap" && <HeatmapYearView entregables={entregables} />}
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
    return <EmptyEntregables />;
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
                {items.length > 0 && (
                  <span className="ml-1 inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-cehta-green/15 px-1 text-[8px] font-bold text-cehta-green">
                    {items.length}
                  </span>
                )}
              </p>
              {/* TODOS los entregables del día — scroll vertical si exceden el alto */}
              <div className="max-h-[120px] space-y-0.5 overflow-y-auto pr-0.5">
                {items.map((e) => (
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
                  {items.map((e) => (
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

// ─── Vista Agenda Secretaria — tabla cronológica completa por mes ───────────

const ESTADO_LABEL_AGENDA: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  entregado: "Entregado",
  no_entregado: "No entregado",
};

const ESTADO_BG_AGENDA: Record<string, string> = {
  pendiente: "bg-ink-100/60 text-ink-700",
  en_proceso: "bg-info/15 text-info",
  entregado: "bg-positive/15 text-positive",
  no_entregado: "bg-negative/15 text-negative",
};

const CATEGORIA_BG_AGENDA: Record<string, string> = {
  CMF: "bg-purple-100 text-purple-800",
  CORFO: "bg-cehta-green/15 text-cehta-green",
  UAF: "bg-red-100 text-red-800",
  SII: "bg-orange-100 text-orange-800",
  INTERNO: "bg-blue-100 text-blue-800",
  AUDITORIA: "bg-gray-100 text-gray-800",
  ASAMBLEA: "bg-yellow-100 text-yellow-800",
  OPERACIONAL: "bg-emerald-100 text-emerald-800",
};

function VistaAgenda({ entregables }: { entregables: EntregableRead[] }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Agrupados por mes para mejor lectura, pero TODOS los entregables visibles.
  const agrupado = useMemo(() => {
    const map = new Map<string, EntregableRead[]>();
    for (const e of entregables) {
      const d = new Date(e.fecha_limite + "T00:00:00");
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entregables]);

  const toggleId = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleMonth = (items: EntregableRead[]) => {
    const ids = items.map((e) => e.entregable_id);
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  if (entregables.length === 0) {
    return <EmptyEntregables />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-info/20 bg-info/5 p-3 text-sm text-ink-700">
        <strong>📋 Vista Agenda</strong> — Listado cronológico completo del año.
        Marcá los <span className="font-mono">checkboxes</span> para hacer
        cambios masivos (cierre de mes en segundos), o usá{" "}
        <span className="rounded bg-ink-100/60 px-1 py-0.5 font-mono text-xs">
          Marcar ▾
        </span>{" "}
        en cada fila para una sola.
      </div>
      {agrupado.map(([mesKey, items]) => {
        const [year, month] = mesKey.split("-");
        const mesNombre = MES_NOMBRES[parseInt(month ?? "1") - 1] ?? "";
        const ids = items.map((e) => e.entregable_id);
        const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
        const someSelected = ids.some((id) => selected.has(id));
        return (
          <Surface key={mesKey} padding="none">
            <Surface.Header className="sticky top-0 z-10 border-b border-hairline bg-white/95 px-5 py-3 backdrop-blur">
              <div className="flex items-center justify-between">
                <Surface.Title className="capitalize">
                  {mesNombre} {year}
                </Surface.Title>
                <span className="text-xs text-ink-500">
                  {items.length} entregable{items.length !== 1 ? "s" : ""}
                  {someSelected && (
                    <>
                      {" · "}
                      <span className="font-semibold text-cehta-green">
                        {ids.filter((id) => selected.has(id)).length} seleccionado
                        {ids.filter((id) => selected.has(id)).length !== 1
                          ? "s"
                          : ""}
                      </span>
                    </>
                  )}
                </span>
              </div>
            </Surface.Header>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-hairline text-sm">
                <thead className="bg-ink-50/50 text-[10px] uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="w-8 px-2 py-2 text-left">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = !allSelected && someSelected;
                        }}
                        onChange={() => toggleMonth(items)}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-ink-300 text-cehta-green focus:ring-1 focus:ring-cehta-green"
                        aria-label={`Seleccionar todos de ${mesNombre}`}
                      />
                    </th>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">Categoría</th>
                    <th className="px-3 py-2 text-left">Entregable</th>
                    <th className="hidden px-3 py-2 text-left lg:table-cell">
                      Período
                    </th>
                    <th className="hidden px-3 py-2 text-left md:table-cell">
                      Responsable
                    </th>
                    <th className="hidden px-3 py-2 text-left sm:table-cell">
                      Estado
                    </th>
                    <th className="px-3 py-2 text-right">Días</th>
                    <th className="px-3 py-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {items.map((e) => (
                    <AgendaRow
                      key={e.entregable_id}
                      entregable={e}
                      selected={selected.has(e.entregable_id)}
                      onToggleSelect={toggleId}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>
        );
      })}
      <BulkActionBar
        selectedIds={Array.from(selected)}
        onClear={() => setSelected(new Set())}
      />
    </div>
  );
}

interface AgendaRowProps {
  entregable: EntregableRead;
  selected: boolean;
  onToggleSelect: (id: number) => void;
}

const AgendaRow = memo(
  AgendaRowImpl,
  (prev, next) =>
    prev.selected === next.selected &&
    prev.entregable.entregable_id === next.entregable.entregable_id &&
    prev.entregable.estado === next.entregable.estado &&
    prev.entregable.updated_at === next.entregable.updated_at,
);

function AgendaRowImpl({ entregable: e, selected, onToggleSelect }: AgendaRowProps) {
  const [showActions, setShowActions] = useState(false);
  const [dialogTarget, setDialogTarget] = useState<EstadoEntregable | null>(
    null,
  );
  const updateMut = useUpdateEntregable();

  const fecha = new Date(e.fecha_limite + "T00:00:00").toLocaleDateString(
    "es-CL",
    { day: "2-digit", month: "short" },
  );

  const handleMarcar = async (
    estado: "entregado" | "en_proceso" | "no_entregado" | "pendiente",
  ) => {
    setShowActions(false);
    // entregado y no_entregado abren el modal — necesitan metadata
    // (fecha real / adjunto / motivo). en_proceso y pendiente son toggles
    // baratos sin formulario.
    if (estado === "entregado" || estado === "no_entregado") {
      setDialogTarget(estado);
      return;
    }
    try {
      await updateMut.mutateAsync({
        id: e.entregable_id,
        body: { estado },
      });
    } catch {
      // toast manejado por la mutation hook
    }
  };

  const dias = e.dias_restantes;
  const isUrgente =
    e.nivel_alerta === "vencido" ||
    e.nivel_alerta === "hoy" ||
    e.nivel_alerta === "critico";
  const isProximo =
    e.nivel_alerta === "urgente" || e.nivel_alerta === "proximo";

  return (
    <tr
      className={`transition-colors hover:bg-ink-50/40 ${
        e.estado === "entregado" ? "opacity-50" : ""
      } ${selected ? "bg-cehta-green/5" : ""}`}
    >
      <td className="px-2 py-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(e.entregable_id)}
          className="h-3.5 w-3.5 cursor-pointer rounded border-ink-300 text-cehta-green focus:ring-1 focus:ring-cehta-green"
          aria-label={`Seleccionar ${e.nombre}`}
        />
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums text-ink-900">
        {fecha}
      </td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
            CATEGORIA_BG_AGENDA[e.categoria] ?? "bg-ink-100 text-ink-700"
          }`}
        >
          {e.categoria}
        </span>
      </td>
      <td className="px-3 py-2 text-ink-900">
        <p className="line-clamp-2 font-medium sm:line-clamp-1">{e.nombre}</p>
        {/* En mobile mostramos período + responsable + estado inline para
            no perder info al ocultar las columnas. */}
        <p className="mt-0.5 text-[10px] text-ink-500 sm:hidden">
          <span className="font-mono">{e.periodo}</span>
          {" · "}
          {e.responsable}
          {" · "}
          <span className="capitalize">{e.estado.replace("_", " ")}</span>
        </p>
        {e.referencia_normativa && (
          <p className="mt-0.5 line-clamp-1 text-[10px] italic text-ink-400">
            {e.referencia_normativa}
          </p>
        )}
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2 font-mono text-xs text-ink-700 lg:table-cell">
        {e.periodo}
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-ink-700 md:table-cell">
        {e.responsable}
      </td>
      <td className="hidden px-3 py-2 sm:table-cell">
        <span
          className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
            ESTADO_BG_AGENDA[e.estado] ?? "bg-ink-100 text-ink-700"
          }`}
        >
          {ESTADO_LABEL_AGENDA[e.estado] ?? e.estado}
        </span>
      </td>
      <td
        className={`whitespace-nowrap px-3 py-2 text-right text-xs font-medium tabular-nums ${
          isUrgente
            ? "text-negative"
            : isProximo
              ? "text-warning"
              : "text-ink-500"
        }`}
      >
        {dias === null
          ? "—"
          : dias < 0
            ? `${Math.abs(dias)}d vencido`
            : dias === 0
              ? "HOY"
              : `${dias}d`}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <div className="relative inline-block">
          <button
            type="button"
            onClick={() => setShowActions((v) => !v)}
            disabled={updateMut.isPending}
            className="rounded-lg border border-hairline bg-white px-2 py-1 text-[11px] font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:opacity-50"
          >
            Marcar ▾
          </button>
          {showActions && (
            <>
              <button
                type="button"
                aria-label="Cerrar menú"
                onClick={() => setShowActions(false)}
                className="fixed inset-0 z-20 cursor-default"
              />
              <div className="absolute right-0 top-full z-30 mt-1 flex w-48 flex-col gap-0.5 rounded-xl border border-hairline bg-white p-1 shadow-card-hover">
                {e.estado !== "entregado" && (
                  <button
                    type="button"
                    onClick={() => handleMarcar("entregado")}
                    className="rounded-lg px-2.5 py-1.5 text-left text-xs text-positive hover:bg-positive/10"
                  >
                    ✓ Marcar entregado
                  </button>
                )}
                {e.estado !== "en_proceso" && e.estado !== "entregado" && (
                  <button
                    type="button"
                    onClick={() => handleMarcar("en_proceso")}
                    className="rounded-lg px-2.5 py-1.5 text-left text-xs text-info hover:bg-info/10"
                  >
                    ⏳ En proceso
                  </button>
                )}
                {e.estado !== "no_entregado" && e.estado !== "entregado" && (
                  <button
                    type="button"
                    onClick={() => handleMarcar("no_entregado")}
                    className="rounded-lg px-2.5 py-1.5 text-left text-xs text-negative hover:bg-negative/10"
                  >
                    ✗ No entregado
                  </button>
                )}
                {e.estado !== "pendiente" && (
                  <button
                    type="button"
                    onClick={() => handleMarcar("pendiente")}
                    className="rounded-lg px-2.5 py-1.5 text-left text-xs text-ink-700 hover:bg-ink-100"
                  >
                    ↺ Volver a pendiente
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <MarcarEntregadoDialog
          entregable={e}
          estadoTarget={dialogTarget}
          open={dialogTarget !== null}
          onOpenChange={(o) => !o && setDialogTarget(null)}
        />
      </td>
    </tr>
  );
}

/**
 * CategoriaChipsBar — V4 fase 7.12.
 *
 * Bar horizontal con chips por categoría regulatoria, donde cada chip
 * muestra el badge con count de entregables pendientes de esa categoría.
 * Click en un chip aplica/quita el filtro. "Todas" deselecciona.
 *
 * Filosofía: toggle de un click contra el dropdown que requiere abrir +
 * scroll + click. Para los 8 valores de Categoria, esto es más rápido.
 */
const CHIP_CATEGORIAS = [
  { value: "CMF", label: "CMF", color: "bg-purple-100 text-purple-800" },
  { value: "CORFO", label: "CORFO", color: "bg-cehta-green/15 text-cehta-green" },
  { value: "UAF", label: "UAF", color: "bg-red-100 text-red-800" },
  { value: "SII", label: "SII", color: "bg-orange-100 text-orange-800" },
  { value: "INTERNO", label: "Interno", color: "bg-blue-100 text-blue-800" },
  { value: "AUDITORIA", label: "Auditoría", color: "bg-gray-100 text-gray-800" },
  { value: "ASAMBLEA", label: "Asamblea", color: "bg-yellow-100 text-yellow-800" },
  { value: "OPERACIONAL", label: "Operacional", color: "bg-emerald-100 text-emerald-800" },
];

function CategoriaChipsBar({
  entregables,
  active,
  onChange,
}: {
  entregables: EntregableRead[];
  active: string;
  onChange: (next: string) => void;
}) {
  // Conteos por categoría (entregables que NO están entregados)
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of entregables) {
      if (e.estado === "entregado" || e.estado === "no_entregado") continue;
      map[e.categoria] = (map[e.categoria] ?? 0) + 1;
    }
    return map;
  }, [entregables]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange("")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 ease-apple ring-1",
          active === ""
            ? "bg-ink-900 text-white ring-ink-900"
            : "bg-white text-ink-700 ring-hairline hover:bg-ink-50",
        )}
      >
        Todas
      </button>
      {CHIP_CATEGORIAS.map((c) => {
        const isActive = active === c.value;
        const count = counts[c.value] ?? 0;
        return (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(isActive ? "" : c.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 ease-apple ring-1",
              isActive
                ? "bg-cehta-green text-white ring-cehta-green"
                : "bg-white text-ink-700 ring-hairline hover:bg-cehta-green/5 hover:text-cehta-green",
            )}
          >
            <span
              className={cn(
                "inline-flex h-1.5 w-1.5 rounded-full",
                isActive ? "bg-white" : c.color.split(" ")[0],
              )}
            />
            {c.label}
            {count > 0 && (
              <span
                className={cn(
                  "inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
                  isActive
                    ? "bg-white/20 text-white"
                    : "bg-ink-100 text-ink-600",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Empty state inteligente — V4 fase 7.6.
 *
 * Cuando no hay resultados, ofrecemos CTAs útiles en lugar del clásico
 * "no hay nada". El usuario operativo no debe quedarse mirando una
 * pantalla vacía sin saber qué hacer.
 */
function EmptyEntregables() {
  return (
    <Surface className="py-12 text-center">
      <div className="mx-auto max-w-md">
        <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green">
          <ClipboardList className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <p className="text-base font-semibold text-ink-900">
          No hay entregables que coincidan
        </p>
        <p className="mt-1 text-sm text-ink-500">
          Probá quitando filtros, cambiando de vista, o usá los atajos para
          navegar más rápido.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <a
            href="/entregables"
            className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:bg-cehta-green-700"
          >
            Limpiar filtros
          </a>
          <a
            href="/entregables/reporte"
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
          >
            <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
            Ver reporte para acta CV
          </a>
          <button
            type="button"
            onClick={() => {
              const evt = new KeyboardEvent("keydown", {
                key: "?",
                bubbles: true,
              });
              window.dispatchEvent(evt);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50"
          >
            Ver atajos de teclado
            <kbd className="rounded border border-hairline bg-ink-50 px-1 py-0.5 font-mono text-[10px]">
              ?
            </kbd>
          </button>
        </div>
      </div>
    </Surface>
  );
}
