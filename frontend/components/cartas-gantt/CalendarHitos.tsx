"use client";

/**
 * CalendarHitos — vista calendario mensual de hitos del Gantt.
 *
 * Cada celda de día muestra hasta 4 chips de hitos (códigos empresa
 * coloreados). Click en chip → drill-down al avance de la empresa.
 * Click en día → modal con todos los hitos del día agrupados.
 *
 * Reusa `useUpcomingTasks` (ya existente del Sprint 2 Cartas Gantt) que
 * trae buckets vencidas/hoy/esta_semana/proximas_2_semanas + sin_fecha.
 * Nosotros agregamos en el frontend pulling extendido a 6 meses (default).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
} from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { EMPRESA_COLOR } from "./empresa-colors";
import { cn } from "@/lib/utils";
import type { UpcomingTasksResponse, HitoConContexto } from "@/lib/api/schema";

interface Props {
  empresa?: string;
}

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MES_NOMBRES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function CalendarHitos({ empresa }: Props) {
  const [cursor, setCursor] = useState(new Date());
  const [diaSeleccionado, setDiaSeleccionado] = useState<Date | null>(null);

  // Pull data del calendario en formato Upcoming (cap 200 por bucket)
  const qs = new URLSearchParams();
  if (empresa) qs.set("empresa", empresa);
  const queryString = qs.toString();
  const { data, isLoading } = useApiQuery<UpcomingTasksResponse>(
    ["upcoming-tasks-calendar", empresa ?? ""],
    `/avance/portfolio/upcoming-tasks${queryString ? "?" + queryString : ""}`,
  );

  // Combinar todos los hitos en un solo array y agrupar por día
  const hitosByDay = useMemo(() => {
    const map = new Map<string, HitoConContexto[]>();
    if (!data) return map;
    const all = [
      ...data.vencidas,
      ...data.hoy,
      ...data.esta_semana,
      ...data.proximas_2_semanas,
    ];
    for (const h of all) {
      if (!h.fecha_planificada) continue;
      const key = h.fecha_planificada;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(h);
    }
    return map;
  }, [data]);

  // Generar grid del mes
  const gridDays = useMemo(() => {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    // Inicio = lunes de la semana de monthStart
    const start = new Date(monthStart);
    const dayOfWeek = (start.getDay() + 6) % 7; // 0 = lunes
    start.setDate(start.getDate() - dayOfWeek);
    // Fin = domingo de la semana de monthEnd
    const end = new Date(monthEnd);
    const endDayOfWeek = (end.getDay() + 6) % 7;
    end.setDate(end.getDate() + (6 - endDayOfWeek));

    const days: Date[] = [];
    const cur = new Date(start);
    while (cur <= end) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }, [cursor]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  return (
    <Surface padding="none" className="overflow-hidden">
      {/* Toolbar mes */}
      <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-cehta-green" strokeWidth={1.75} />
          <h2 className="font-display text-lg font-semibold capitalize text-ink-900">
            {MES_NOMBRES[cursor.getMonth()]} {cursor.getFullYear()}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              const next = new Date(cursor);
              next.setMonth(next.getMonth() - 1);
              setCursor(next);
            }}
            className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100/40"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date())}
            className="rounded-lg px-3 py-1 text-xs font-medium text-ink-700 ring-1 ring-hairline hover:bg-ink-100/40"
          >
            Hoy
          </button>
          <button
            type="button"
            onClick={() => {
              const next = new Date(cursor);
              next.setMonth(next.getMonth() + 1);
              setCursor(next);
            }}
            className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100/40"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Header weekdays */}
      <div className="grid grid-cols-7 border-b border-hairline">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-ink-500"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Grid de días */}
      <div className="grid grid-cols-7">
        {gridDays.map((day, i) => {
          const isCurrentMonth = day.getMonth() === cursor.getMonth();
          const isToday = isSameDay(day, new Date());
          const dayKey = day.toISOString().slice(0, 10);
          const hitosDelDia = hitosByDay.get(dayKey) ?? [];
          const visibles = hitosDelDia.slice(0, 4);
          const extras = hitosDelDia.length - 4;

          return (
            <button
              key={i}
              type="button"
              onClick={() =>
                hitosDelDia.length > 0 && setDiaSeleccionado(day)
              }
              className={cn(
                "min-h-[100px] border-b border-r border-hairline p-1.5 text-left transition-colors",
                !isCurrentMonth && "bg-ink-50/30 text-ink-400",
                isCurrentMonth && "hover:bg-ink-50/40",
                hitosDelDia.length > 0 && "cursor-pointer",
                hitosDelDia.length === 0 && "cursor-default",
                (i + 1) % 7 === 0 && "border-r-0",
              )}
            >
              <div
                className={cn(
                  "mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs",
                  isToday
                    ? "bg-cehta-green font-bold text-white"
                    : "font-medium",
                )}
              >
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {visibles.map((h) => (
                  <HitoChip key={h.hito_id} hito={h} />
                ))}
                {extras > 0 && (
                  <p className="px-1 text-[9px] font-medium text-ink-500">
                    +{extras} más
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Modal con detalle del día */}
      {diaSeleccionado && (
        <DiaDetalleDialog
          day={diaSeleccionado}
          hitos={hitosByDay.get(diaSeleccionado.toISOString().slice(0, 10)) ?? []}
          onClose={() => setDiaSeleccionado(null)}
        />
      )}
    </Surface>
  );
}

// ─── Sub-componentes ───────────────────────────────────────────────────────

function HitoChip({ hito }: { hito: HitoConContexto }) {
  const color = EMPRESA_COLOR[hito.empresa_codigo] ?? "#94a3b8";
  return (
    <div
      className="truncate rounded-sm px-1 py-0.5 text-[10px] text-white"
      style={{ background: color }}
      title={`${hito.empresa_codigo} · ${hito.nombre}`}
    >
      <span className="font-mono font-semibold">{hito.empresa_codigo}</span>
      <span className="ml-1 opacity-90">{hito.nombre}</span>
    </div>
  );
}

function DiaDetalleDialog({
  day,
  hitos,
  onClose,
}: {
  day: Date;
  hitos: HitoConContexto[];
  onClose: () => void;
}) {
  // Group by empresa
  const porEmpresa = new Map<string, HitoConContexto[]>();
  for (const h of hitos) {
    if (!porEmpresa.has(h.empresa_codigo)) porEmpresa.set(h.empresa_codigo, []);
    porEmpresa.get(h.empresa_codigo)!.push(h);
  }

  const fechaFmt = day.toLocaleDateString("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl"
      >
        <header className="border-b border-hairline px-6 py-4">
          <p className="text-xs uppercase tracking-wider text-ink-500">
            {fechaFmt}
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink-900">
            {hitos.length} hitos para hoy
          </h2>
        </header>

        <div className="p-6 space-y-5">
          {Array.from(porEmpresa.entries()).map(([empCod, items]) => {
            const color = EMPRESA_COLOR[empCod] ?? "#94a3b8";
            return (
              <section key={empCod}>
                <div className="mb-2 flex items-center gap-2">
                  <EmpresaLogo empresaCodigo={empCod} size={20} />
                  <span
                    className="rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-white"
                    style={{ background: color }}
                  >
                    {empCod}
                  </span>
                  <span className="text-xs text-ink-500">
                    {items.length} hito{items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="space-y-1">
                  {items.map((h) => (
                    <li
                      key={h.hito_id}
                      className="flex items-start gap-2 rounded-lg bg-ink-50/40 px-3 py-2"
                    >
                      <span
                        className={cn(
                          "mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                          h.estado === "completado" && "bg-positive",
                          h.estado === "en_progreso" && "bg-cehta-green",
                          h.estado === "pendiente" && "bg-ink-300",
                          h.estado === "cancelado" && "bg-negative",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink-900">
                          {h.nombre}
                        </p>
                        <p className="text-xs text-ink-500">
                          {h.proyecto_nombre}
                          {h.encargado && ` · ${h.encargado}`}
                          {h.progreso_pct > 0 && ` · ${h.progreso_pct}%`}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/empresa/${empCod}/avance` as never}
                  className="mt-2 inline-block text-xs font-medium text-cehta-green hover:underline"
                >
                  Ir al avance de {empCod} →
                </Link>
              </section>
            );
          })}
        </div>

        <div className="flex justify-end border-t border-hairline px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
