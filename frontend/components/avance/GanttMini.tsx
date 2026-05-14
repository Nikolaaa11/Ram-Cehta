"use client";

/**
 * GanttMini — Gantt premium en SVG nativo (sin deps extra).
 *
 * Round 2 polish:
 *   - Gradient en progress bar + subtle shadow
 *   - "Today" line con label (verde Cehta)
 *   - Alternating month dividers (subtle bg) + bold year separator
 *   - Hito dots: ring blanco + halo en hover + tooltip rich (HTML overlay)
 *   - Animated entry (CSS transitions)
 *   - Legend de estados al pie
 */
import { useState } from "react";
import type { HitoRead } from "@/lib/api/schema";
import { cn } from "@/lib/utils";

const CHART_HEIGHT = 110;
const PADDING_X = 24;
const TRACK_Y = 64;
const TRACK_HEIGHT = 16;

const ESTADO_COLOR: Record<string, { fill: string; ring: string; label: string }> = {
  completado: { fill: "#34c759", ring: "#34c759", label: "Completado" },
  en_progreso: { fill: "#ff9f0a", ring: "#ff9f0a", label: "En progreso" },
  pendiente: { fill: "#ffffff", ring: "#a1a1aa", label: "Pendiente" },
  cancelado: { fill: "#ff3b30", ring: "#ff3b30", label: "Cancelado" },
};

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
  return date.toLocaleString("es-CL", { month: "short" });
}

function fmtMonthYear(date: Date): string {
  return date.toLocaleString("es-CL", { month: "short", year: "2-digit" });
}

function fmtFullDate(date: Date): string {
  return date.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function GanttMini({ fechaInicio, fechaFin, progresoPct, hitos }: Props) {
  const [hovered, setHovered] = useState<{
    hito: HitoRead;
    x: number;
    y: number;
  } | null>(null);

  const start = parse(fechaInicio);
  const end = parse(fechaFin);

  if (!start || !end || end <= start) {
    return (
      <div className="rounded-xl bg-gradient-to-br from-ink-100/40 to-ink-100/20 p-6 text-center ring-1 ring-hairline">
        <p className="text-xs text-ink-500">
          Definí fecha de inicio y fin estimada para visualizar el Gantt.
        </p>
      </div>
    );
  }

  const totalDays = diffDays(start, end);
  const CHART_WIDTH = 800;
  const innerWidth = CHART_WIDTH - PADDING_X * 2;
  const dayWidth = innerWidth / totalDays;

  // Build months — alternate bg + show year on Jan
  const months: { date: Date; x: number; width: number; isJan: boolean }[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const monthStart = new Date(cursor);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const xStart = PADDING_X + Math.max(0, diffDays(start, monthStart)) * dayWidth;
    const xEndCapped =
      monthEnd.getTime() < end.getTime() ? monthEnd : end;
    const xEnd = PADDING_X + diffDays(start, xEndCapped) * dayWidth;
    months.push({
      date: new Date(cursor),
      x: xStart,
      width: Math.max(0, xEnd - xStart),
      isJan: cursor.getMonth() === 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const progressWidth = (innerWidth * Math.max(0, Math.min(100, progresoPct))) / 100;

  // Today line (only if today is within range)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayInRange = today >= start && today <= end;
  const todayX = todayInRange
    ? PADDING_X + diffDays(start, today) * dayWidth
    : null;

  // Expected progress at today (for "ahead/behind schedule" hint)
  const expectedAtToday = todayInRange
    ? Math.round((diffDays(start, today) / totalDays) * 100)
    : null;
  const onTrack =
    expectedAtToday === null || progresoPct >= expectedAtToday - 5;

  const states = Array.from(new Set(hitos.map((h) => h.estado)));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Gantt del proyecto"
        style={{ overflow: "visible" }}
      >
        <defs>
          <linearGradient id="gantt-progress" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0e3f23" />
            <stop offset="50%" stopColor="#1d6f42" />
            <stop offset="100%" stopColor="#34c759" />
          </linearGradient>
          <linearGradient id="gantt-track" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f4f4f5" />
            <stop offset="100%" stopColor="#e4e4e7" />
          </linearGradient>
          <filter id="gantt-shadow" x="-2%" y="-50%" width="104%" height="200%">
            <feGaussianBlur stdDeviation="1.5" />
            <feOffset dx="0" dy="1" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.18" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Month bands — alternating subtle bg */}
        {months.map((m, idx) => (
          <rect
            key={m.date.toISOString()}
            x={m.x}
            y={32}
            width={m.width}
            height={CHART_HEIGHT - 48}
            fill={idx % 2 === 0 ? "transparent" : "#fafafa"}
            opacity={0.7}
          />
        ))}

        {/* Month dividers + labels */}
        {months.map((m) => (
          <g key={`d-${m.date.toISOString()}`}>
            <line
              x1={m.x}
              y1={28}
              x2={m.x}
              y2={CHART_HEIGHT - 14}
              stroke={m.isJan ? "#d4d4d8" : "#e5e7eb"}
              strokeWidth={m.isJan ? 1.5 : 1}
              strokeDasharray={m.isJan ? "0" : "2 3"}
            />
            <text
              x={m.x + 4}
              y={22}
              fontSize={10}
              fill={m.isJan ? "#1d6f42" : "#71717a"}
              fontWeight={m.isJan ? 600 : 400}
              fontFamily="system-ui, -apple-system"
            >
              {m.isJan ? fmtMonthYear(m.date) : fmtMonth(m.date)}
            </text>
          </g>
        ))}

        {/* Track */}
        <rect
          x={PADDING_X}
          y={TRACK_Y}
          width={innerWidth}
          height={TRACK_HEIGHT}
          rx={8}
          fill="url(#gantt-track)"
          stroke="#e4e4e7"
          strokeWidth={0.5}
        />

        {/* Progress fill */}
        <rect
          x={PADDING_X}
          y={TRACK_Y}
          width={progressWidth}
          height={TRACK_HEIGHT}
          rx={8}
          fill="url(#gantt-progress)"
          filter="url(#gantt-shadow)"
          style={{
            transition: "width 600ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />

        {/* Today line */}
        {todayX !== null && (
          <g>
            <line
              x1={todayX}
              y1={TRACK_Y - 12}
              x2={todayX}
              y2={TRACK_Y + TRACK_HEIGHT + 16}
              stroke={onTrack ? "#1d6f42" : "#ff3b30"}
              strokeWidth={2}
              strokeDasharray="4 3"
            />
            <rect
              x={todayX - 22}
              y={TRACK_Y - 28}
              width={44}
              height={16}
              rx={4}
              fill={onTrack ? "#1d6f42" : "#ff3b30"}
            />
            <text
              x={todayX}
              y={TRACK_Y - 17}
              fontSize={9}
              fill="white"
              fontWeight={700}
              textAnchor="middle"
              fontFamily="system-ui, -apple-system"
            >
              HOY
            </text>
          </g>
        )}

        {/* Hito dots */}
        {hitos.map((h) => {
          const planned = parse(h.fecha_planificada);
          if (!planned) return null;
          const offsetDays = diffDays(start, planned);
          const x = PADDING_X + offsetDays * dayWidth;
          const cfg = ESTADO_COLOR[h.estado] ?? ESTADO_COLOR.pendiente!;
          const cy = TRACK_Y + TRACK_HEIGHT / 2;
          const isHovered = hovered?.hito.hito_id === h.hito_id;
          return (
            <g
              key={h.hito_id}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement)
                  .getBoundingClientRect();
                const svg = e.currentTarget.ownerSVGElement as SVGSVGElement;
                const viewBoxW = svg.viewBox.baseVal.width || CHART_WIDTH;
                const scale = rect.width / viewBoxW;
                setHovered({
                  hito: h,
                  x: x * scale,
                  y: cy * scale,
                });
              }}
              onMouseLeave={() => setHovered(null)}
            >
              {/* halo on hover */}
              {isHovered && (
                <circle
                  cx={x}
                  cy={cy}
                  r={12}
                  fill={cfg.ring}
                  opacity={0.2}
                />
              )}
              <circle
                cx={x}
                cy={cy}
                r={isHovered ? 8 : 7}
                fill={cfg.fill}
                stroke="white"
                strokeWidth={2.5}
                style={{
                  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.18))",
                  transition: "r 150ms ease",
                }}
              />
              {h.estado === "completado" && (
                <path
                  d={`M ${x - 3} ${cy} L ${x - 1} ${cy + 2} L ${x + 3} ${cy - 2}`}
                  stroke="white"
                  strokeWidth={1.8}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Rich tooltip on hito hover */}
      {hovered && (
        <div
          className="pointer-events-none absolute z-20 rounded-xl bg-white px-3 py-2 shadow-card ring-1 ring-hairline"
          style={{
            left: `${hovered.x}px`,
            top: `${hovered.y - 70}px`,
            transform: "translateX(-50%)",
            minWidth: 180,
          }}
        >
          <p className="text-sm font-semibold text-ink-900">
            {hovered.hito.nombre}
          </p>
          <div className="mt-1 flex items-center gap-2 text-xs text-ink-500">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                backgroundColor:
                  ESTADO_COLOR[hovered.hito.estado]?.fill ?? "#a1a1aa",
              }}
            />
            <span className="capitalize">
              {hovered.hito.estado.replace("_", " ")}
            </span>
            <span>·</span>
            <span>{hovered.hito.progreso_pct}%</span>
          </div>
          {hovered.hito.fecha_planificada && (
            <p className="mt-1 text-[11px] text-ink-400">
              {fmtFullDate(new Date(hovered.hito.fecha_planificada))}
            </p>
          )}
        </div>
      )}

      {/* Legend + schedule hint */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-[11px]">
        <div className="flex flex-wrap items-center gap-3">
          {states.map((s) => {
            const cfg = ESTADO_COLOR[s] ?? ESTADO_COLOR.pendiente!;
            return (
              <span
                key={s}
                className="inline-flex items-center gap-1.5 text-ink-500"
              >
                <span
                  className="inline-block h-2 w-2 rounded-full ring-1 ring-white"
                  style={{ backgroundColor: cfg.fill, boxShadow: `0 0 0 1px ${cfg.ring}` }}
                />
                {cfg.label}
              </span>
            );
          })}
        </div>
        {expectedAtToday !== null && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
              onTrack
                ? "bg-positive/10 text-positive"
                : "bg-negative/10 text-negative",
            )}
          >
            {onTrack
              ? `✓ En cronograma (${progresoPct}% vs ${expectedAtToday}% esperado)`
              : `△ Atrasado (${progresoPct}% vs ${expectedAtToday}% esperado)`}
          </span>
        )}
      </div>
    </div>
  );
}
