"use client";

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { EventDot } from "./EventDot";
import { cn } from "@/lib/utils";
import type { CalendarEventRead } from "@/lib/api/schema";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

interface Props {
  cursor: Date;
  events: CalendarEventRead[];
  onCursorChange: (date: Date) => void;
  onDayClick: (day: Date) => void;
}

export function MonthView({
  cursor,
  events,
  onCursorChange,
  onDayClick,
}: Props) {
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const eventsByDay = new Map<string, CalendarEventRead[]>();
  for (const ev of events) {
    const key = ev.fecha_inicio.slice(0, 10);
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key)!.push(ev);
  }

  return (
    <Surface padding="none" className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
        <h2 className="font-display text-lg font-semibold capitalize text-ink-900">
          {format(cursor, "MMMM yyyy", { locale: es })}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onCursorChange(subMonths(cursor, 1))}
            className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100/40"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => onCursorChange(new Date())}
            className="rounded-lg px-3 py-1 text-xs font-medium text-ink-700 ring-1 ring-hairline hover:bg-ink-100/40"
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => onCursorChange(addMonths(cursor, 1))}
            className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100/40"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-hairline bg-ink-100/30 text-xs font-medium uppercase tracking-wide text-ink-500">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-center">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDay.get(key) ?? [];
          const inMonth = isSameMonth(day, cursor);
          const today = isToday(day);
          return (
            <button
              type="button"
              key={key}
              onClick={() => onDayClick(day)}
              className={cn(
                "flex min-h-[88px] flex-col items-start gap-1 border-b border-r border-hairline px-2 py-1.5 text-left transition-colors duration-150 hover:bg-ink-100/30",
                !inMonth && "bg-ink-100/20 text-ink-300",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums",
                  today
                    ? "bg-cehta-green text-white font-semibold"
                    : inMonth
                      ? "text-ink-700"
                      : "text-ink-300",
                )}
              >
                {format(day, "d")}
              </span>
              <div className="flex flex-1 w-full flex-col gap-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map((ev) => (
                  <div
                    key={ev.event_id}
                    className={cn(
                      "flex w-full items-center gap-1.5 overflow-hidden rounded-md px-1.5 py-0.5 text-[10px]",
                      ev.completado
                        ? "bg-ink-100/40 text-ink-300 line-through"
                        : "bg-ink-100/60 text-ink-700",
                    )}
                  >
                    <EventDot tipo={ev.tipo} completado={ev.completado} />
                    <span className="truncate" title={ev.titulo}>
                      {ev.titulo}
                    </span>
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <span className="text-[10px] text-ink-500">
                    +{dayEvents.length - 3} más
                  </span>
                )}
              </div>
              {today && !dayEvents.length && (
                <span className="sr-only">Hoy{isSameDay(day, new Date()) ? "" : ""}</span>
              )}
            </button>
          );
        })}
      </div>
    </Surface>
  );
}
