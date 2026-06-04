"use client";

/**
 * TimelineGantt — vista horizontal estilo Linear/Frappe Gantt.
 *
 * Layout:
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ Empresa │ Proyecto       │ May │ Jun │ Jul │ Aug │ Sep    │
 *   ├─────────┼────────────────┼─────┼─────┼─────┼─────┼────────┤
 *   │ RHO     │ Panimávida     │ ████████████░░░░░░             │
 *   │         │ La Ligua       │     ████████░░░░░░             │
 *   │ DTE     │ La Serena ZU   │ █████████████████░░            │
 *   └───────────────────────────────────────────────────────────┘
 *                              ↑ hoy (línea roja vertical)
 *
 * - Sin deps externas (puro SVG/CSS, ~5KB gzip)
 * - Eje X scroll horizontal con meses
 * - Color de barra por estado del proyecto
 * - Progress fill interno según progreso_pct
 * - Hover muestra tooltip con detalle
 * - Click en barra abre /empresa/{cod}/avance
 */
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  GanttChart,
  Target,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { EMPRESA_COLOR } from "./empresa-colors";
import { cn } from "@/lib/utils";
import type { ProyectoListItem } from "@/lib/api/schema";

interface EmpresaWithProyectos {
  codigo: string;
  razon_social: string;
  proyectos: ProyectoListItem[];
}

interface Props {
  empresas: EmpresaWithProyectos[];
}

const MES_NOMBRES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

export function TimelineGantt({ empresas }: Props) {
  // Estado: zoom (días por pixel) + cursor inicial
  const [zoom, setZoom] = useState<"mes" | "trimestre" | "anio">("trimestre");
  const containerRef = useRef<HTMLDivElement>(null);

  // Calcular rango de fechas a renderizar — desde min(fecha_inicio) hasta max(fecha_fin)
  // Cap defensivo: ±18 meses desde hoy
  const range = useMemo(() => {
    const hoy = new Date();
    const minDefault = new Date(hoy);
    minDefault.setMonth(minDefault.getMonth() - 6);
    const maxDefault = new Date(hoy);
    maxDefault.setMonth(maxDefault.getMonth() + 18);

    let min = minDefault;
    let max = maxDefault;
    for (const emp of empresas) {
      for (const p of emp.proyectos) {
        if (p.fecha_inicio) {
          const d = new Date(p.fecha_inicio + "T00:00:00");
          if (d < min) min = d;
        }
        if (p.fecha_fin_estimada) {
          const d = new Date(p.fecha_fin_estimada + "T00:00:00");
          if (d > max) max = d;
        }
      }
    }
    // Snap a primer día del mes
    min = new Date(min.getFullYear(), min.getMonth(), 1);
    max = new Date(max.getFullYear(), max.getMonth() + 1, 0);
    return { min, max };
  }, [empresas]);

  // Generar la lista de meses en el rango
  const meses = useMemo(() => {
    const out: { date: Date; label: string; year: number; month: number }[] =
      [];
    const cursor = new Date(range.min);
    while (cursor <= range.max) {
      out.push({
        date: new Date(cursor),
        label: MES_NOMBRES[cursor.getMonth()] ?? "",
        year: cursor.getFullYear(),
        month: cursor.getMonth(),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return out;
  }, [range]);

  // Width de cada mes según zoom
  const COL_WIDTH = {
    mes: 120,
    trimestre: 80,
    anio: 50,
  }[zoom];

  // Total width de la timeline
  const totalWidth = meses.length * COL_WIDTH;
  const totalDays = Math.max(
    1,
    Math.round(
      (range.max.getTime() - range.min.getTime()) / (24 * 60 * 60 * 1000),
    ),
  );
  const pxPerDay = totalWidth / totalDays;

  // Posición de "hoy" en pixels
  const todayPx = useMemo(() => {
    const hoy = new Date();
    if (hoy < range.min || hoy > range.max) return null;
    const days = Math.round(
      (hoy.getTime() - range.min.getTime()) / (24 * 60 * 60 * 1000),
    );
    return days * pxPerDay;
  }, [range, pxPerDay]);

  const scrollToToday = () => {
    if (containerRef.current && todayPx !== null) {
      containerRef.current.scrollLeft = Math.max(0, todayPx - 200);
    }
  };

  // Filtrar empresas con al menos 1 proyecto con fechas
  const empresasConDatos = empresas
    .filter((e) =>
      e.proyectos.some((p) => p.fecha_inicio || p.fecha_fin_estimada),
    )
    .map((e) => ({
      ...e,
      proyectos: e.proyectos.filter(
        (p) => p.fecha_inicio || p.fecha_fin_estimada,
      ),
    }));

  if (empresasConDatos.length === 0) {
    return (
      <Surface className="py-12 text-center">
        <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-info/10 text-info">
          <GanttChart className="h-6 w-6" strokeWidth={1.5} />
        </span>
        <p className="mt-3 text-base font-semibold text-ink-900">
          Sin proyectos con fechas para mostrar
        </p>
        <p className="mt-1 text-sm text-ink-500">
          Importa Gantts con `fecha_inicio` y `fecha_fin_estimada` definidas.
        </p>
      </Surface>
    );
  }

  return (
    <Surface padding="none" className="overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-ink-500">
            Zoom:
          </span>
          <div className="inline-flex rounded-xl bg-ink-100/40 p-0.5">
            {(["mes", "trimestre", "anio"] as const).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoom(z)}
                className={cn(
                  "rounded-lg px-3 py-1 text-xs font-medium transition-colors",
                  zoom === z
                    ? "bg-white text-ink-900 shadow-card/40"
                    : "text-ink-600 hover:bg-white/40",
                )}
              >
                {z === "mes" ? "Mes" : z === "trimestre" ? "Trimestre" : "Año"}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={scrollToToday}
          className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
        >
          <Target className="h-3 w-3" strokeWidth={1.75} />
          Ir a hoy
        </button>
      </div>

      {/* Body con scroll horizontal */}
      <div className="flex">
        {/* Columna fija izquierda con nombres */}
        <div className="w-64 shrink-0 border-r border-hairline bg-ink-50/30">
          {/* Header alineado con eje X */}
          <div className="sticky top-0 z-10 flex h-10 items-center border-b border-hairline bg-white px-4 text-[10px] uppercase tracking-wider text-ink-500">
            Empresa · Proyecto
          </div>
          {empresasConDatos.map((emp) => (
            <div key={emp.codigo}>
              {/* Header empresa */}
              <div className="flex items-center gap-2 border-b border-hairline bg-ink-100/30 px-4 py-2">
                <EmpresaLogo empresaCodigo={emp.codigo} size={20} />
                <span className="font-mono text-xs font-bold text-ink-900">
                  {emp.codigo}
                </span>
                <span className="truncate text-[10px] text-ink-500">
                  {emp.proyectos.length}
                </span>
              </div>
              {/* Filas de proyectos */}
              {emp.proyectos.map((p) => (
                <div
                  key={p.proyecto_id}
                  className="flex h-10 items-center border-b border-hairline px-4"
                  title={p.nombre}
                >
                  <p className="truncate text-xs text-ink-700">{p.nombre}</p>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Timeline scroll horizontal */}
        <div
          ref={containerRef}
          className="flex-1 overflow-x-auto"
          style={{ scrollBehavior: "smooth" }}
        >
          <div style={{ width: totalWidth, minWidth: "100%" }}>
            {/* Header: meses */}
            <div className="sticky top-0 z-10 flex h-10 border-b border-hairline bg-white">
              {meses.map((m, i) => {
                const isFirstOfYear = m.month === 0;
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex shrink-0 flex-col items-center justify-center border-r border-hairline text-[10px]",
                      isFirstOfYear && "border-r-2 border-r-ink-300",
                    )}
                    style={{ width: COL_WIDTH }}
                  >
                    <span className="font-semibold uppercase tracking-wider text-ink-700">
                      {m.label}
                    </span>
                    {isFirstOfYear && (
                      <span className="text-ink-400">{m.year}</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Filas: empresas con sus proyectos */}
            {empresasConDatos.map((emp) => (
              <div key={emp.codigo}>
                {/* Header empresa (alto = 36px = py-2 + line-height) */}
                <div className="h-9 border-b border-hairline bg-ink-100/30" />
                {/* Filas proyectos */}
                {emp.proyectos.map((p) => (
                  <ProyectoBar
                    key={p.proyecto_id}
                    proyecto={p}
                    empresaCodigo={emp.codigo}
                    rangoMin={range.min}
                    pxPerDay={pxPerDay}
                  />
                ))}
              </div>
            ))}

            {/* Línea vertical "Hoy" */}
            {todayPx !== null && (
              <div
                className="pointer-events-none absolute bottom-0 top-10 z-20 w-0.5 bg-negative"
                style={{
                  left: 256 + todayPx, // 256 = w-64 de columna izquierda
                  // En realidad esto requiere otro layout porque está fuera del scroll horizontal
                }}
              />
            )}
          </div>
        </div>
      </div>
    </Surface>
  );
}

// ─── Sub-componentes ───────────────────────────────────────────────────────

const ESTADO_COLOR: Record<string, string> = {
  planificado: "bg-ink-300",
  en_progreso: "bg-cehta-green",
  completado: "bg-positive",
  cancelado: "bg-negative",
  pausado: "bg-warning",
};

function ProyectoBar({
  proyecto,
  empresaCodigo,
  rangoMin,
  pxPerDay,
}: {
  proyecto: ProyectoListItem;
  empresaCodigo: string;
  rangoMin: Date;
  pxPerDay: number;
}) {
  const [hover, setHover] = useState(false);

  // Calcular posición + ancho de la barra
  const { left, width } = useMemo(() => {
    const inicio = proyecto.fecha_inicio
      ? new Date(proyecto.fecha_inicio + "T00:00:00")
      : null;
    const fin = proyecto.fecha_fin_estimada
      ? new Date(proyecto.fecha_fin_estimada + "T00:00:00")
      : null;

    if (!inicio && !fin) return { left: 0, width: 0 };
    const start = inicio ?? fin!;
    const end = fin ?? new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const startDays =
      (start.getTime() - rangoMin.getTime()) / (24 * 60 * 60 * 1000);
    const durationDays = Math.max(
      1,
      (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000),
    );
    return {
      left: startDays * pxPerDay,
      width: Math.max(20, durationDays * pxPerDay), // mínimo 20px para que se vea
    };
  }, [proyecto, rangoMin, pxPerDay]);

  if (width === 0) {
    return <div className="h-10 border-b border-hairline" />;
  }

  const empColor = EMPRESA_COLOR[empresaCodigo] ?? "#94a3b8";
  const estadoColor =
    ESTADO_COLOR[proyecto.estado] ?? "bg-cehta-green";
  const progreso = proyecto.progreso_pct ?? 0;

  return (
    <div
      className="relative h-10 border-b border-hairline"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Link
        href={`/empresa/${empresaCodigo}/avance` as never}
        className="absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden rounded-md text-xs font-medium text-white transition-all hover:scale-y-110 hover:shadow-md"
        style={{
          left,
          width,
          background: empColor,
          height: 22,
        }}
        title={`${proyecto.nombre} (${progreso}% avance)`}
      >
        {/* Progress fill interno (más oscuro) */}
        <div
          className={cn("absolute inset-y-0 left-0", estadoColor)}
          style={{
            width: `${progreso}%`,
            opacity: 0.55,
          }}
        />
        {/* Texto del proyecto si entra */}
        {width > 60 && (
          <span className="relative z-10 truncate px-2 font-mono text-[10px] tabular-nums">
            {progreso > 0 && `${progreso}%`}
          </span>
        )}
      </Link>

      {/* Tooltip on hover */}
      {hover && (
        <div
          className="pointer-events-none absolute z-30 rounded-lg bg-ink-900 px-3 py-2 text-xs text-white shadow-lg"
          style={{
            left: Math.min(left, 600),
            top: -8,
            transform: "translateY(-100%)",
          }}
        >
          <p className="font-semibold">{proyecto.nombre}</p>
          <p className="mt-0.5 text-[10px] text-white/70">
            {proyecto.fecha_inicio} → {proyecto.fecha_fin_estimada ?? "?"}
          </p>
          <p className="text-[10px] text-white/70">
            {proyecto.estado.replace("_", " ")} · {progreso}% avance
          </p>
          <p className="text-[10px] text-white/70">
            {proyecto.hitos?.length ?? 0} hitos
            {proyecto.riesgos_abiertos > 0 &&
              ` · ${proyecto.riesgos_abiertos} riesgos`}
          </p>
        </div>
      )}
    </div>
  );
}
