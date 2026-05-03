"use client";

/**
 * MiSemanaWidget — V4 fase 7.15.
 *
 * Vista "Mi semana" — los 7 días siguientes con timeline horizontal
 * mostrando entregables agrupados por día. Da visibilidad de la carga
 * semanal completa de un golpe.
 *
 * Diferencia con MiDiaWidget:
 *   - MiDia → enfocado en hoy + urgentes inmediatos
 *   - MiSemana → planificación de 7 días con distribución por día
 *
 * Layout: 7 columnas (días) × N filas (entregables del día), apilado
 * tipo Trello mini.
 */
import { useMemo } from "react";
import { ArrowRight, CalendarDays } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { useEntregables } from "@/hooks/use-entregables";
import { cn } from "@/lib/utils";

const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const CATEGORIA_DOT: Record<string, string> = {
  CMF: "bg-purple-500",
  CORFO: "bg-cehta-green",
  UAF: "bg-red-500",
  SII: "bg-orange-500",
  INTERNO: "bg-blue-500",
  AUDITORIA: "bg-gray-500",
  ASAMBLEA: "bg-yellow-500",
  OPERACIONAL: "bg-emerald-500",
};

interface DayBucket {
  date: Date;
  isoDate: string;
  isToday: boolean;
  isWeekend: boolean;
  items: Array<{
    id: number;
    nombre: string;
    categoria: string;
    nivel: string;
    estado: string;
  }>;
}

export function MiSemanaWidget() {
  const today = new Date();
  const en7d = new Date(today);
  en7d.setDate(today.getDate() + 7);

  const { data: entregables = [], isLoading } = useEntregables({
    desde: today.toISOString().slice(0, 10),
    hasta: en7d.toISOString().slice(0, 10),
  });

  // Construir 7 días desde hoy
  const buckets = useMemo<DayBucket[]>(() => {
    const out: DayBucket[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const isoDate = d.toISOString().slice(0, 10);
      const dayOfWeek = d.getDay();
      const items = entregables
        .filter(
          (e) =>
            e.estado !== "entregado" &&
            e.estado !== "no_entregado" &&
            e.fecha_limite === isoDate,
        )
        .map((e) => ({
          id: e.entregable_id,
          nombre: e.nombre,
          categoria: e.categoria,
          nivel: e.nivel_alerta ?? "normal",
          estado: e.estado,
        }))
        .slice(0, 8); // cap 8 por día para que no se desborde
      out.push({
        date: d,
        isoDate,
        isToday: i === 0,
        isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
        items,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entregables]);

  const totalSemana = buckets.reduce((acc, b) => acc + b.items.length, 0);

  return (
    <Surface>
      <Surface.Header className="border-b border-hairline pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cehta-green/15 text-cehta-green">
              <CalendarDays className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <Surface.Title>Mi semana</Surface.Title>
              <Surface.Subtitle>
                Timeline 7 días ·{" "}
                <strong>{totalSemana}</strong> entregable
                {totalSemana !== 1 ? "s" : ""}
              </Surface.Subtitle>
            </div>
          </div>
          <a
            href="/entregables"
            className="inline-flex items-center gap-1 text-xs font-medium text-cehta-green hover:underline"
          >
            Ver detalle <ArrowRight className="h-3 w-3" strokeWidth={2} />
          </a>
        </div>
      </Surface.Header>

      {isLoading ? (
        <div className="mt-3 grid grid-cols-7 gap-1">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-7 gap-1.5">
          {buckets.map((b) => (
            <div
              key={b.isoDate}
              className={cn(
                "flex min-h-[140px] flex-col gap-1 rounded-lg border p-1.5 transition-colors",
                b.isToday
                  ? "border-cehta-green/40 bg-cehta-green/5"
                  : b.isWeekend
                    ? "border-hairline bg-ink-50/30"
                    : "border-hairline bg-white",
              )}
            >
              {/* Header del día */}
              <div className="flex items-baseline justify-between gap-1 px-0.5">
                <span
                  className={cn(
                    "text-[9px] font-semibold uppercase tracking-wider",
                    b.isToday ? "text-cehta-green" : "text-ink-500",
                  )}
                >
                  {DIAS_CORTOS[b.date.getDay() === 0 ? 6 : b.date.getDay() - 1]}
                </span>
                <span
                  className={cn(
                    "text-base font-bold tabular-nums",
                    b.isToday ? "text-cehta-green" : "text-ink-700",
                  )}
                >
                  {b.date.getDate()}
                </span>
              </div>

              {/* Items del día */}
              <div className="flex flex-1 flex-col gap-1">
                {b.items.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center text-[9px] text-ink-300">
                    —
                  </div>
                ) : (
                  b.items.map((item) => {
                    const isUrgente =
                      item.nivel === "vencido" ||
                      item.nivel === "hoy" ||
                      item.nivel === "critico";
                    return (
                      <a
                        key={item.id}
                        href="/entregables"
                        title={`${item.categoria} · ${item.nombre}`}
                        className={cn(
                          "flex items-center gap-1 rounded px-1 py-0.5 text-[9px] transition-colors hover:bg-ink-100",
                          isUrgente && "bg-negative/10 text-negative",
                          !isUrgente && "text-ink-700",
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                            CATEGORIA_DOT[item.categoria] ?? "bg-ink-400",
                          )}
                        />
                        <span className="line-clamp-1 flex-1 font-medium">
                          {item.nombre}
                        </span>
                      </a>
                    );
                  })
                )}
              </div>

              {/* Counter si hay más de 8 (cap) */}
              {b.items.length === 8 && (
                <p className="text-center text-[9px] text-ink-400">
                  +más
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Leyenda categorías */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-ink-500">
        <span>Categorías:</span>
        {Object.entries(CATEGORIA_DOT)
          .slice(0, 6)
          .map(([cat, color]) => (
            <span key={cat} className="inline-flex items-center gap-1">
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  color,
                )}
              />
              {cat}
            </span>
          ))}
      </div>
    </Surface>
  );
}
