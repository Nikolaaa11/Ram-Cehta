"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { endOfMonth, format, startOfMonth } from "date-fns";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useApiQuery } from "@/hooks/use-api-query";
import { useMe } from "@/hooks/use-me";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { MonthView } from "@/components/calendar/MonthView";
import { EventCreateDialog } from "@/components/calendar/EventCreateDialog";
import { EventDayDrawer } from "@/components/calendar/EventDayDrawer";
import { EventDot, TIPO_LABEL } from "@/components/calendar/EventDot";
import type { AgentRunReport, CalendarEventRead } from "@/lib/api/schema";

const TIPOS_LEGEND = [
  "f29",
  "reporte_lp",
  "comite",
  "reporte_trimestral",
  "vencimiento",
  "otro",
];

export default function CalendarioPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canCreate = me?.allowed_actions?.includes("calendar:create") ?? false;
  const canRunAgents = me?.allowed_actions?.includes("calendar:admin") ?? false;

  const [cursor, setCursor] = useState<Date>(new Date());
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState<Date | null>(null);
  const [drawerDay, setDrawerDay] = useState<Date | null>(null);

  const from = format(startOfMonth(cursor), "yyyy-MM-dd");
  const to = format(endOfMonth(cursor), "yyyy-MM-dd");

  const { data, isLoading } = useApiQuery<CalendarEventRead[]>(
    ["calendar", from, to],
    `/calendar/events?from=${from}&to=${to}`,
  );

  const events = data ?? [];

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

  return (
    <div className="mx-auto max-w-[1280px] space-y-6 px-6 py-6 lg:px-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
            Calendario
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            F29, reportes a LPs, comités y vencimientos. Los agentes generan
            recordatorios automáticos del reglamento interno.
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

      <Surface padding="compact" className="flex flex-wrap items-center gap-4">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Tipos
        </span>
        {TIPOS_LEGEND.map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-xs text-ink-700">
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
