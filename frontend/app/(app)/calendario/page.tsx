"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  endOfMonth,
  format,
  startOfMonth,
} from "date-fns";
import { CalendarDays, ListChecks, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useApiQuery } from "@/hooks/use-api-query";
import { useMe } from "@/hooks/use-me";
import { useObligations } from "@/hooks/use-obligations";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { apiClient, ApiError } from "@/lib/api/client";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox } from "@/components/ui/combobox";
import { MonthView } from "@/components/calendar/MonthView";
import { EventCreateDialog } from "@/components/calendar/EventCreateDialog";
import { EventDayDrawer } from "@/components/calendar/EventDayDrawer";
import { EventDot, TIPO_LABEL } from "@/components/calendar/EventDot";
import { ObligationsTimeline } from "@/components/calendar/ObligationsTimeline";
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

  const from = format(startOfMonth(cursor), "yyyy-MM-dd");
  const to = format(endOfMonth(cursor), "yyyy-MM-dd");

  const { data, isLoading } = useApiQuery<CalendarEventRead[]>(
    ["calendar", from, to],
    `/calendar/events?from=${from}&to=${to}`,
  );

  const events = data ?? [];

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
  const obligations = oblTipos.size > 1
    ? obligationsAll.filter((o) => oblTipos.has(o.tipo))
    : obligationsAll;

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
          {canRunAgents && (
            <button
              type="button"
              onClick={() => agentsMutation.mutate()}
              disabled={agentsMutation.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40 disabled:opacity-60"
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
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-apple hover:bg-cehta-green-700"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              Nuevo evento
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 rounded-xl bg-ink-100/40 p-1 w-fit">
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
                Desde
              </label>
              <input
                type="date"
                value={oblFromDate}
                onChange={(e) => setOblFromDate(e.target.value)}
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
                onChange={(e) => setOblToDate(e.target.value)}
                className="rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                Tipos
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
            <ObligationsTimeline obligations={obligations} />
          )}
        </>
      )}

      <EventCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultDate={createDate}
        onCreated={refresh}
      />

      <EventDayDrawer
        day={drawerDay}
        events={events}
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
