"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  endOfMonth,
  format,
  startOfMonth,
} from "date-fns";
import { CalendarDays, ListChecks, Plus, Printer, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useApiQuery } from "@/hooks/use-api-query";
import { useMe } from "@/hooks/use-me";
import { useObligations } from "@/hooks/use-obligations";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { usePageShortcuts } from "@/hooks/use-page-shortcuts";
import { apiClient, ApiError } from "@/lib/api/client";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox } from "@/components/ui/combobox";
import { MonthView } from "@/components/calendar/MonthView";
import { EventCreateDialog } from "@/components/calendar/EventCreateDialog";
import { EventDayDrawer } from "@/components/calendar/EventDayDrawer";
import { EventDot, TIPO_LABEL } from "@/components/calendar/EventDot";
import { ObligationsTimeline } from "@/components/calendar/ObligationsTimeline";
import { AgenteSecretaria } from "@/components/calendar/AgenteSecretaria";
import { cn } from "@/lib/utils";
import type {
  AgentRunReport,
  CalendarEventRead,
  ObligationTipo,
} from "@/lib/api/schema";

const TIPOS_LEGEND = [
  "f29",
  "reporte_lp",
  "comite",
  "reporte_trimestral",
  "vencimiento",
  "otro",
];

type Tab = "mes" | "obligaciones";

const OBLIGATION_TIPOS: { value: ObligationTipo; label: string }[] = [
  { value: "f29", label: "F29" },
  { value: "legal", label: "Legal" },
  { value: "oc", label: "OC" },
  { value: "suscripcion", label: "Suscripción" },
  { value: "event", label: "Evento" },
];

export default function CalendarioPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canCreate = me?.allowed_actions?.includes("calendar:create") ?? false;
  const canRunAgents = me?.allowed_actions?.includes("calendar:admin") ?? false;

  const [tab, setTab] = useState<Tab>("mes");
  const [cursor, setCursor] = useState<Date>(new Date());
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState<Date | null>(null);
  const [drawerDay, setDrawerDay] = useState<Date | null>(null);
  // Filtro empresa para tab Mes (V4 fase 7.5)
  const [mesEmpresa, setMesEmpresa] = useState<string>("");
  const [mesTipo, setMesTipo] = useState<string>("");

  // Filtros tab obligaciones
  const [oblEmpresa, setOblEmpresa] = useState<string>("");
  const [oblTipos, setOblTipos] = useState<Set<ObligationTipo>>(new Set());
  const today = new Date();
  const [oblFromDate, setOblFromDate] = useState<string>(
    format(today, "yyyy-MM-dd"),
  );
  const [oblToDate, setOblToDate] = useState<string>(
    format(addDays(today, 90), "yyyy-MM-dd"),
  );
  // Quick-range preset (V4 fase 7.7) — controla los date inputs en bloque
  const [oblPreset, setOblPreset] = useState<
    "7d" | "30d" | "90d" | "ytd" | "custom"
  >("90d");
  // Búsqueda libre por título de obligación
  const [oblBusqueda, setOblBusqueda] = useState<string>("");

  const aplicarPreset = (preset: typeof oblPreset) => {
    setOblPreset(preset);
    const t = new Date();
    if (preset === "7d") {
      setOblFromDate(format(t, "yyyy-MM-dd"));
      setOblToDate(format(addDays(t, 7), "yyyy-MM-dd"));
    } else if (preset === "30d") {
      setOblFromDate(format(t, "yyyy-MM-dd"));
      setOblToDate(format(addDays(t, 30), "yyyy-MM-dd"));
    } else if (preset === "90d") {
      setOblFromDate(format(t, "yyyy-MM-dd"));
      setOblToDate(format(addDays(t, 90), "yyyy-MM-dd"));
    } else if (preset === "ytd") {
      setOblFromDate(format(t, "yyyy-MM-dd"));
      setOblToDate(format(new Date(t.getFullYear(), 11, 31), "yyyy-MM-dd"));
    }
    // 'custom' deja los valores como están
  };

  const limpiarFiltrosObligaciones = () => {
    setOblEmpresa("");
    setOblTipos(new Set());
    setOblBusqueda("");
    aplicarPreset("90d");
  };

  // V4 fase 7.8 — Keyboard shortcuts
  usePageShortcuts({
    "g m": () => setTab("mes"),
    "g o": () => setTab("obligaciones"),
    Escape: () => {
      if (tab === "obligaciones") limpiarFiltrosObligaciones();
      else {
        setMesEmpresa("");
        setMesTipo("");
      }
    },
    p: () => window.print(),
  });

  const from = format(startOfMonth(cursor), "yyyy-MM-dd");
  const to = format(endOfMonth(cursor), "yyyy-MM-dd");

  const { data, isLoading } = useApiQuery<CalendarEventRead[]>(
    ["calendar", from, to],
    `/calendar/events?from=${from}&to=${to}`,
  );

  const allEvents = data ?? [];
  const events = allEvents.filter((ev) => {
    if (mesEmpresa && ev.empresa_codigo !== mesEmpresa) return false;
    if (mesTipo && ev.tipo !== mesTipo) return false;
    return true;
  });

  const { data: empresas } = useCatalogoEmpresas();
  const empresaItems = [
    { value: "", label: "Todas las empresas" },
    ...(empresas?.map((e) => ({ value: e.codigo, label: e.codigo })) ?? []),
  ];

  // Si hay 1 tipo seleccionado, lo enviamos al backend; si hay 0 o >1 lo
  // dejamos abierto y filtramos client-side.
  const singleTipo: ObligationTipo | null =
    oblTipos.size === 1 ? Array.from(oblTipos)[0]! : null;

  const obligationsQuery = useObligations({
    empresa_codigo: oblEmpresa || null,
    tipo: singleTipo,
    from_date: oblFromDate,
    to_date: oblToDate,
  });
  const obligationsAll = obligationsQuery.data ?? [];
  const obligationsByTipo = oblTipos.size > 1
    ? obligationsAll.filter((o) => oblTipos.has(o.tipo))
    : obligationsAll;
  // V4 fase 7.7 — filtro búsqueda libre client-side sobre title
  const obligations = oblBusqueda.trim()
    ? obligationsByTipo.filter((o) =>
        o.title.toLowerCase().includes(oblBusqueda.trim().toLowerCase()),
      )
    : obligationsByTipo;

  const refresh = () => qc.invalidateQueries({ queryKey: ["calendar"] });

  const agentsMutation = useMutation({
    mutationFn: () =>
      apiClient.post<AgentRunReport>("/calendar/agents/run", {}, session),
    onSuccess: (report) => {
      toast.success(
        `Agentes corridos: ${report.total_creados} eventos creados`,
      );
      refresh();
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error en agentes");
    },
  });

  const toggleTipo = (t: ObligationTipo) => {
    setOblTipos((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 px-6 py-6 lg:px-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
            Calendario
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            F29, reportes a LPs, comités, vencimientos legales y OCs
            pendientes — todo en un solo lugar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            title="Imprimir mes actual / Exportar PDF"
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40 print:hidden"
          >
            <Printer className="h-4 w-4" strokeWidth={1.5} />
            Imprimir mes
          </button>
          {canRunAgents && (
            <button
              type="button"
              onClick={() => agentsMutation.mutate()}
              disabled={agentsMutation.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40 disabled:opacity-60 print:hidden"
            >
              <Sparkles className="h-4 w-4" strokeWidth={1.5} />
              {agentsMutation.isPending ? "Corriendo…" : "Correr agentes"}
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() => {
                setCreateDate(null);
                setCreateOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-apple hover:bg-cehta-green-700 print:hidden"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              Nuevo evento
            </button>
          )}
        </div>
      </div>

      {/* Encabezado adicional sólo visible al imprimir */}
      <div className="hidden print:block">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Calendario · FIP CEHTA ESG · AFIS S.A.
        </p>
        <p className="text-xs text-ink-700">
          Mes:{" "}
          <strong>
            {cursor.toLocaleDateString("es-CL", {
              month: "long",
              year: "numeric",
            })}
          </strong>
          {" · "}
          Generado el{" "}
          {new Date().toLocaleString("es-CL", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-xl bg-ink-100/40 p-1 w-fit print:hidden">
        <TabButton
          active={tab === "mes"}
          onClick={() => setTab("mes")}
          icon={CalendarDays}
          label="Mes"
        />
        <TabButton
          active={tab === "obligaciones"}
          onClick={() => setTab("obligaciones")}
          icon={ListChecks}
          label="Obligaciones"
        />
      </div>

      {tab === "mes" && (
        <>
          <Surface
            padding="compact"
            className="flex flex-wrap items-end gap-3"
          >
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                Empresa
              </label>
              <Combobox
                items={empresaItems}
                value={mesEmpresa}
                onValueChange={setMesEmpresa}
                placeholder="Todas"
                triggerClassName="w-[180px]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                Tipo de evento
              </label>
              <select
                value={mesTipo}
                onChange={(e) => setMesTipo(e.target.value)}
                className="rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              >
                <option value="">Todos los tipos</option>
                {TIPOS_LEGEND.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            {(mesEmpresa || mesTipo) && (
              <button
                type="button"
                onClick={() => {
                  setMesEmpresa("");
                  setMesTipo("");
                }}
                className="ml-auto inline-flex items-center gap-1 rounded-xl border border-hairline bg-white px-3 py-2 text-xs font-medium text-ink-600 hover:bg-ink-50"
              >
                Limpiar
              </button>
            )}
            <span className="ml-auto text-[11px] text-ink-500">
              {events.length} de {allEvents.length} eventos
            </span>
          </Surface>

          <Surface
            padding="compact"
            className="flex flex-wrap items-center gap-4"
          >
            <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Tipos
            </span>
            {TIPOS_LEGEND.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1.5 text-xs text-ink-700"
              >
                <EventDot tipo={t} />
                {TIPO_LABEL[t]}
              </span>
            ))}
          </Surface>

          {isLoading ? (
            <Skeleton className="h-[640px] w-full rounded-2xl" />
          ) : (
            <MonthView
              cursor={cursor}
              events={events}
              onCursorChange={setCursor}
              onDayClick={(d) => setDrawerDay(d)}
            />
          )}
        </>
      )}

      {tab === "obligaciones" && (
        <>
          <Surface
            padding="compact"
            className="flex flex-wrap items-end gap-3"
          >
            {/* Quick-range presets — V4 fase 7.7 */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                Rango
              </span>
              <div className="inline-flex rounded-xl bg-ink-100/40 p-0.5 ring-1 ring-hairline">
                {(
                  [
                    { v: "7d" as const, label: "7d" },
                    { v: "30d" as const, label: "30d" },
                    { v: "90d" as const, label: "90d" },
                    { v: "ytd" as const, label: "YTD" },
                  ]
                ).map(({ v, label }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => aplicarPreset(v)}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all duration-150 ease-apple",
                      oblPreset === v
                        ? "bg-white text-ink-900 shadow-card/40"
                        : "text-ink-600 hover:bg-white/40",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                Empresa
              </label>
              <Combobox
                items={empresaItems}
                value={oblEmpresa}
                onValueChange={setOblEmpresa}
                placeholder="Todas"
                triggerClassName="w-[180px]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                Buscar
              </label>
              <input
                type="text"
                value={oblBusqueda}
                onChange={(e) => setOblBusqueda(e.target.value)}
                placeholder="Por título…"
                className="w-[200px] rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                Desde
              </label>
              <input
                type="date"
                value={oblFromDate}
                onChange={(e) => {
                  setOblFromDate(e.target.value);
                  setOblPreset("custom");
                }}
                className="rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                Hasta
              </label>
              <input
                type="date"
                value={oblToDate}
                onChange={(e) => {
                  setOblToDate(e.target.value);
                  setOblPreset("custom");
                }}
                className="rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                Tipos
                {(oblEmpresa ||
                  oblTipos.size > 0 ||
                  oblBusqueda ||
                  oblPreset !== "90d") && (
                  <button
                    type="button"
                    onClick={limpiarFiltrosObligaciones}
                    className="ml-2 inline-flex items-center gap-0.5 rounded-md border border-hairline bg-white px-1.5 py-0.5 text-[10px] font-medium normal-case text-ink-600 hover:bg-ink-50"
                  >
                    Limpiar
                  </button>
                )}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {OBLIGATION_TIPOS.map((t) => {
                  const active = oblTipos.has(t.value);
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => toggleTipo(t.value)}
                      className={cn(
                        "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors duration-150 ease-apple ring-1",
                        active
                          ? "bg-cehta-green text-white ring-cehta-green"
                          : "bg-white text-ink-700 ring-hairline hover:bg-cehta-green/5 hover:text-cehta-green",
                      )}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Surface>

          {obligationsQuery.isLoading ? (
            <Skeleton className="h-[480px] w-full rounded-2xl" />
          ) : obligationsQuery.isError ? (
            <Surface padding="default">
              <p className="text-sm text-negative">
                Error cargando obligaciones:{" "}
                {obligationsQuery.error?.message ?? "desconocido"}
              </p>
            </Surface>
          ) : (
            <>
              <p className="px-1 text-[11px] text-ink-500">
                {obligations.length} de {obligationsAll.length} obligaciones
                {oblBusqueda && (
                  <>
                    {" · "}
                    <span className="font-medium text-cehta-green">
                      búsqueda: &quot;{oblBusqueda}&quot;
                    </span>
                  </>
                )}
              </p>
              <ObligationsTimeline obligations={obligations} />
            </>
          )}
        </>
      )}

      {/* Agente Secretaria — entregables próximos 60 días con info requerida.
          Oculto al imprimir (lo importante para el papel es el grid mensual). */}
      <div className="print:hidden">
        <AgenteSecretaria />
      </div>

      <EventCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultDate={createDate}
        onCreated={refresh}
      />

      <EventDayDrawer
        day={drawerDay}
        events={events}
        obligations={obligationsAll}
        onClose={() => setDrawerDay(null)}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof CalendarDays;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all duration-150 ease-apple",
        active
          ? "bg-white text-ink-900 shadow-card"
          : "text-ink-500 hover:text-ink-700",
      )}
      aria-pressed={active}
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} />
      {label}
    </button>
  );
}
