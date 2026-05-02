"use client";

/**
 * HeatmapYearView — V4 fase 7.12.
 *
 * Vista año completo estilo GitHub contributions: 12 meses × 31 días con
 * cada celda coloreada según densidad de entregables vencidos en esa fecha.
 *
 * Click en un día → lista los entregables de ese día abajo.
 *
 * Densidad por colores:
 *   0:  bg-ink-50  (sin entregables)
 *   1:  bg-cehta-green/10
 *   2:  bg-cehta-green/30
 *   3+: bg-cehta-green/60
 *   Rojo si hay vencidos sin entregar
 */
import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import type { EntregableRead } from "@/hooks/use-entregables";
import { cn } from "@/lib/utils";

const MES_NOMBRES_CORTOS = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

interface DayCell {
  iso: string;
  date: Date;
  count: number;
  vencidos: number;
  entregados: number;
  pendientes: number;
}

function densityColor(cell: DayCell): string {
  // Si hay vencidos sin entregar → rojo
  if (cell.vencidos > 0) {
    return cell.vencidos >= 3
      ? "bg-negative/60 text-white"
      : cell.vencidos >= 2
        ? "bg-negative/40"
        : "bg-negative/25";
  }
  if (cell.count === 0) return "bg-ink-50";
  if (cell.count === 1) return "bg-cehta-green/15";
  if (cell.count === 2) return "bg-cehta-green/35";
  if (cell.count === 3) return "bg-cehta-green/55 text-white";
  return "bg-cehta-green/75 text-white";
}

export function HeatmapYearView({
  entregables,
  year,
}: {
  entregables: EntregableRead[];
  year?: number;
}) {
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const targetYear = year ?? new Date().getFullYear();

  // Agrupar entregables por fecha YYYY-MM-DD
  const byDate = useMemo(() => {
    const map = new Map<string, EntregableRead[]>();
    for (const e of entregables) {
      if (!e.fecha_limite.startsWith(String(targetYear))) continue;
      const key = e.fecha_limite; // YYYY-MM-DD
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [entregables, targetYear]);

  // Build 12-month grid
  const months = useMemo(() => {
    const out: { mes: number; days: DayCell[] }[] = [];
    for (let m = 0; m < 12; m++) {
      const lastDay = new Date(targetYear, m + 1, 0).getDate();
      const days: DayCell[] = [];
      for (let d = 1; d <= 31; d++) {
        if (d > lastDay) {
          days.push({
            iso: "",
            date: new Date(0),
            count: 0,
            vencidos: 0,
            entregados: 0,
            pendientes: 0,
          });
          continue;
        }
        const iso = `${targetYear}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const items = byDate.get(iso) ?? [];
        let vencidos = 0;
        let entregados = 0;
        let pendientes = 0;
        for (const e of items) {
          if (e.estado === "entregado") entregados++;
          else if (e.nivel_alerta === "vencido") vencidos++;
          else pendientes++;
        }
        days.push({
          iso,
          date: new Date(targetYear, m, d),
          count: items.length,
          vencidos,
          entregados,
          pendientes,
        });
      }
      out.push({ mes: m, days });
    }
    return out;
  }, [byDate, targetYear]);

  const selectedItems = selectedIso ? byDate.get(selectedIso) ?? [] : [];

  return (
    <Surface>
      <Surface.Header className="border-b border-hairline pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cehta-green/15 text-cehta-green">
              <CalendarDays className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <Surface.Title>Heatmap {targetYear}</Surface.Title>
              <Surface.Subtitle>
                Densidad de entregables por día. Rojo = vencidos sin
                entregar, verde = pipeline activo.
              </Surface.Subtitle>
            </div>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-2 text-[10px] text-ink-500">
            <span>Menos</span>
            <span className="inline-block h-3 w-3 rounded bg-ink-50" />
            <span className="inline-block h-3 w-3 rounded bg-cehta-green/15" />
            <span className="inline-block h-3 w-3 rounded bg-cehta-green/35" />
            <span className="inline-block h-3 w-3 rounded bg-cehta-green/55" />
            <span className="inline-block h-3 w-3 rounded bg-cehta-green/75" />
            <span>Más</span>
            <span className="ml-2 inline-block h-3 w-3 rounded bg-negative/40" />
            <span className="text-negative">Vencidos</span>
          </div>
        </div>
      </Surface.Header>

      {/* Grid */}
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[680px]">
          {/* Header con números 1..31 */}
          <div className="ml-12 flex items-center text-[9px] text-ink-400">
            {Array.from({ length: 31 }, (_, i) => (
              <div
                key={i}
                className="flex w-[18px] items-center justify-center"
              >
                {i + 1}
              </div>
            ))}
          </div>
          {months.map(({ mes, days }) => (
            <div key={mes} className="mt-1 flex items-center">
              <div className="w-12 text-right pr-2 text-[10px] font-medium uppercase tracking-wider text-ink-500">
                {MES_NOMBRES_CORTOS[mes]}
              </div>
              {days.map((day, idx) => {
                if (!day.iso) {
                  return (
                    <div
                      key={idx}
                      className="h-[18px] w-[18px] shrink-0"
                    />
                  );
                }
                const isSelected = day.iso === selectedIso;
                const tooltip =
                  day.count === 0
                    ? `${day.iso} · sin entregables`
                    : `${day.iso} · ${day.count} entregable${day.count !== 1 ? "s" : ""}` +
                      (day.vencidos > 0
                        ? ` (${day.vencidos} vencidos)`
                        : "");
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedIso(isSelected ? null : day.iso)}
                    title={tooltip}
                    className={cn(
                      "m-px h-[16px] w-[16px] shrink-0 rounded-sm transition-all hover:ring-1 hover:ring-cehta-green focus:outline-none focus:ring-2 focus:ring-cehta-green",
                      densityColor(day),
                      isSelected && "ring-2 ring-cehta-green",
                    )}
                  >
                    {day.count > 0 && (
                      <span className="block text-center text-[8px] font-bold leading-[16px]">
                        {day.count > 9 ? "9+" : day.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Detail del día seleccionado */}
      {selectedIso && (
        <div className="mt-4 rounded-2xl border border-cehta-green/30 bg-cehta-green/5 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink-900">
              {new Date(selectedIso + "T00:00:00").toLocaleDateString("es-CL", {
                weekday: "long",
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </p>
            <button
              type="button"
              onClick={() => setSelectedIso(null)}
              className="text-[11px] text-ink-500 hover:text-ink-900"
            >
              cerrar ✕
            </button>
          </div>
          {selectedItems.length === 0 ? (
            <p className="mt-2 text-xs italic text-ink-500">
              Sin entregables registrados para este día.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {selectedItems.map((e) => (
                <li
                  key={e.entregable_id}
                  className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs"
                >
                  <span className="rounded-md bg-ink-100/60 px-1.5 py-0.5 text-[10px] font-bold uppercase">
                    {e.categoria}
                  </span>
                  <span className="flex-1 truncate font-medium text-ink-900">
                    {e.nombre}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[9px] font-medium uppercase",
                      e.estado === "entregado"
                        ? "bg-positive/15 text-positive"
                        : e.nivel_alerta === "vencido"
                          ? "bg-negative/15 text-negative"
                          : "bg-info/15 text-info",
                    )}
                  >
                    {e.estado.replace("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Surface>
  );
}
