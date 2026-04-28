"use client";

import { format, isSameDay } from "date-fns";
import { es } from "date-fns/locale";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { useMe } from "@/hooks/use-me";
import { apiClient, ApiError } from "@/lib/api/client";
import { EventDot, TIPO_LABEL } from "./EventDot";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CalendarEventRead } from "@/lib/api/schema";

interface Props {
  day: Date | null;
  events: CalendarEventRead[];
  onClose: () => void;
}

export function EventDayDrawer({ day, events, onClose }: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canUpdate = me?.allowed_actions?.includes("calendar:update") ?? false;
  const canDelete = me?.allowed_actions?.includes("calendar:delete") ?? false;

  const completeMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient.post(`/calendar/events/${id}/complete`, {}, session),
    onSuccess: () => {
      toast.success("Evento marcado completado");
      qc.invalidateQueries({ queryKey: ["calendar"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error al actualizar");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient.delete(`/calendar/events/${id}`, session),
    onSuccess: () => {
      toast.success("Evento eliminado");
      qc.invalidateQueries({ queryKey: ["calendar"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error al eliminar");
    },
  });

  if (!day) return null;

  const dayEvents = events.filter((ev) =>
    isSameDay(new Date(ev.fecha_inicio), day),
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Cerrar"
      />
      <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-card-hover">
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <div>
            <h3 className="font-display text-base font-semibold capitalize text-ink-900">
              {format(day, "EEEE d 'de' MMMM", { locale: es })}
            </h3>
            <p className="text-xs text-ink-500">
              {dayEvents.length}{" "}
              {dayEvents.length === 1 ? "evento" : "eventos"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-500 hover:bg-ink-100/40"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {dayEvents.length === 0 ? (
            <p className="text-sm text-ink-500">Sin eventos en este día.</p>
          ) : (
            <ul className="space-y-3">
              {dayEvents.map((ev) => (
                <li
                  key={ev.event_id}
                  className={cn(
                    "rounded-xl border border-hairline p-4 transition-colors duration-150",
                    ev.completado && "bg-ink-100/30 opacity-75",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <EventDot tipo={ev.tipo} className="mt-1.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h4
                          className={cn(
                            "font-medium",
                            ev.completado
                              ? "text-ink-500 line-through"
                              : "text-ink-900",
                          )}
                        >
                          {ev.titulo}
                        </h4>
                        <Badge variant="neutral">
                          {TIPO_LABEL[ev.tipo] ?? ev.tipo}
                        </Badge>
                      </div>
                      {ev.empresa_codigo && (
                        <p className="mt-0.5 text-xs text-ink-500">
                          {ev.empresa_codigo}
                        </p>
                      )}
                      {ev.descripcion && (
                        <p className="mt-2 text-sm text-ink-700">
                          {ev.descripcion}
                        </p>
                      )}
                      {ev.auto_generado && (
                        <p className="mt-2 text-xs uppercase tracking-wide text-ink-300">
                          · Auto-generado
                        </p>
                      )}

                      {(canUpdate || canDelete) && (
                        <div className="mt-3 flex items-center gap-2">
                          {canUpdate && !ev.completado && (
                            <button
                              type="button"
                              onClick={() => completeMutation.mutate(ev.event_id)}
                              disabled={completeMutation.isPending}
                              className="inline-flex items-center gap-1 rounded-lg bg-positive/10 px-2 py-1 text-xs font-medium text-positive hover:bg-positive/20"
                            >
                              <Check className="h-3 w-3" strokeWidth={2} />
                              Completar
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm("¿Eliminar este evento?")) {
                                  deleteMutation.mutate(ev.event_id);
                                }
                              }}
                              disabled={deleteMutation.isPending}
                              className="inline-flex items-center gap-1 rounded-lg bg-negative/10 px-2 py-1 text-xs font-medium text-negative hover:bg-negative/20"
                            >
                              <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                              Eliminar
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
