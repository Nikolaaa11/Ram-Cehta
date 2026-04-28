"use client";

/**
 * GanttMini — Gantt simple en SVG nativo (sin deps extra).
 *
 * Eje X = días entre fecha_inicio y fecha_fin_estimada.
 * Renderea: barra horizontal con progreso del proyecto + dots de hitos
 * en su fecha_planificada con color según estado.
 *
 * Si faltan fechas, muestra un placeholder informativo.
 */
import type { HitoRead } from "@/lib/api/schema";

const CHART_WIDTH = 720;
const CHART_HEIGHT = 96;
const PADDING_X = 16;
const TRACK_Y = 56;
const TRACK_HEIGHT = 14;

interface Props {
  fechaInicio?: string | null;
  fechaFin?: string | null;
  progresoPct: number;
  hitos: HitoRead[];
}

function parse(date: string | null | undefined): Date | null {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diffDays(a: Date, b: Date): number {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)));
}

function fmtMonth(date: Date): string {
  return date.toLocaleString("es-CL", { month: "short", year: "2-digit" });
}

const ESTADO_COLOR: Record<string, string> = {
  completado: "#34c759", // positive
  en_progreso: "#ff9f0a", // warning
  pendiente: "#a1a1aa", // ink-300
  cancelado: "#ff3b30", // negative
};

export function GanttMini({ fechaInicio, fechaFin, progresoPct, hitos }: Props) {
  const start = parse(fechaInicio);
  const end = parse(fechaFin);

  if (!start || !end || end <= start) {
    return (
      <div className="rounded-xl bg-ink-100/40 p-4 text-center text-xs text-ink-500">
        Definí fecha de inicio y fecha fin estimada para visualizar el Gantt.
      </div>
    );
  }

  const totalDays = diffDays(start, end);
  const innerWidth = CHART_WIDTH - PADDING_X * 2;
  const dayWidth = innerWidth / totalDays;

  const months: { date: Date; x: number }[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const offsetDays = Math.max(0, diffDays(start, cursor));
    months.push({
      date: new Date(cursor),
      x: PADDING_X + offsetDays * dayWidth,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const progressWidth = (innerWidth * Math.max(0, Math.min(100, progresoPct))) / 100;

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="w-full"
      role="img"
      aria-label="Gantt mini"
    >
      {months.map((m) => (
        <g key={m.date.toISOString()}>
          <line
            x1={m.x}
            y1={20}
            x2={m.x}
            y2={CHART_HEIGHT - 8}
            stroke="#e5e7eb"
            strokeWidth={1}
          />
          <text
            x={m.x + 4}
            y={16}
            fontSize={10}
            fill="#71717a"
            fontFamily="system-ui"
          >
            {fmtMonth(m.date)}
          </text>
        </g>
      ))}

      <rect
        x={PADDING_X}
        y={TRACK_Y}
        width={innerWidth}
        height={TRACK_HEIGHT}
        rx={6}
        fill="#f4f4f5"
      />
      <rect
        x={PADDING_X}
        y={TRACK_Y}
        width={progressWidth}
        height={TRACK_HEIGHT}
        rx={6}
        fill="#15803d"
        opacity={0.85}
      />

      {hitos.map((h) => {
        const planned = parse(h.fecha_planificada);
        if (!planned) return null;
        const offsetDays = diffDays(start, planned);
        const x = PADDING_X + offsetDays * dayWidth;
        const color = ESTADO_COLOR[h.estado] ?? "#a1a1aa";
        return (
          <g key={h.hito_id}>
            <circle
              cx={x}
              cy={TRACK_Y + TRACK_HEIGHT / 2}
              r={6}
              fill="white"
              stroke={color}
              strokeWidth={2}
            />
            {h.estado === "completado" && (
              <circle cx={x} cy={TRACK_Y + TRACK_HEIGHT / 2} r={3} fill={color} />
            )}
            <title>
              {h.nombre} · {h.estado} · {h.fecha_planificada}
            </title>
          </g>
        );
      })}
    </svg>
  );
}
