"use client";

import * as React from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import { LayoutGrid } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { ChartTooltipShell } from "@/components/dashboard/ChartTooltip";
import { formatM } from "@/lib/dashboard/format-chart";
import { toCLP, toPct } from "@/lib/format";
import type { EgresoProyectoItem } from "@/lib/api/schema";

/**
 * Treemap "Egresos por Proyecto" — bloques verdes con tamaño proporcional
 * al egreso. Inspirado en el screenshot de Rho. Usamos shades de cehta-green
 * para mantener una sola identidad cromática (gradient por intensidad).
 */
interface TreemapNode {
  name: string;
  size: number;
  value: number;
  porcentaje: number;
  transaction_count: number;
}

const GREEN_SHADES = [
  "#1d6f42", // base cehta-green
  "#2a8550",
  "#3a9c63",
  "#52b27a",
  "#6dc795",
  "#8ed3a7",
  "#aedfb8",
  "#cae9c9",
  "#dcf0e3",
  "#ecf6ed",
];

function shadeFor(idx: number): string {
  return GREEN_SHADES[idx % GREEN_SHADES.length] ?? GREEN_SHADES[0]!;
}

function toNodes(items: EgresoProyectoItem[]): TreemapNode[] {
  return items.map((it) => {
    const value = Number(it.total_egreso);
    return {
      name: it.proyecto,
      size: value,
      value,
      porcentaje: it.porcentaje,
      transaction_count: it.transaction_count,
    };
  });
}

/** Render custom para cada bloque del treemap. */
interface ContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  name?: string;
  value?: number;
}

function CustomTreemapContent(props: ContentProps) {
  const x = props.x ?? 0;
  const y = props.y ?? 0;
  const width = props.width ?? 0;
  const height = props.height ?? 0;
  const idx = props.index ?? 0;
  const name = props.name ?? "";
  const value = props.value ?? 0;

  const fill = shadeFor(idx);
  const showLabel = width > 80 && height > 36;
  const showValue = width > 110 && height > 56;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke="#fff"
        strokeWidth={2}
        rx={4}
        ry={4}
      />
      {showLabel && (
        <text
          x={x + 10}
          y={y + 20}
          fill="#fff"
          fontSize={12}
          fontWeight={600}
          style={{ pointerEvents: "none" }}
        >
          {name.length > 22 ? `${name.slice(0, 21)}…` : name}
        </text>
      )}
      {showValue && (
        <text
          x={x + 10}
          y={y + 38}
          fill="rgba(255,255,255,0.85)"
          fontSize={11}
          style={{
            pointerEvents: "none",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatM(value)}
        </text>
      )}
    </g>
  );
}

interface RechartsTooltipPayload {
  active?: boolean;
  payload?: Array<{ payload: TreemapNode }>;
}

function TreemapTooltip({ active, payload }: RechartsTooltipPayload) {
  if (!active || !payload || payload.length === 0) return null;
  const node = payload[0]?.payload;
  if (!node) return null;
  return (
    <ChartTooltipShell
      title={node.name}
      rows={[
        {
          label: "Egreso",
          value: toCLP(node.value),
          color: "#1d6f42",
          emphasis: true,
        },
        { label: "% del total", value: toPct(node.porcentaje, { digits: 1 }) },
        { label: "Movimientos", value: String(node.transaction_count) },
      ]}
    />
  );
}

export interface EgresosProyectoCardProps {
  data: EgresoProyectoItem[];
  /**
   * Si está activo, no aplica el filtro default (Oficina/Reversa). En la UI
   * del dashboard aparece como un toggle.
   */
  showAll?: boolean;
  onToggleShowAll?: (value: boolean) => void;
}

export function EgresosProyectoCard({
  data,
  showAll,
  onToggleShowAll,
}: EgresosProyectoCardProps) {
  if (data.length === 0) {
    return (
      <Surface aria-label="Egresos por proyecto — sin datos">
        <Surface.Header>
          <Surface.Title>Egresos por Proyecto</Surface.Title>
          <Surface.Subtitle>Sin proyectos con egresos.</Surface.Subtitle>
        </Surface.Header>
        <Surface.Body className="flex h-[300px] flex-col items-center justify-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/40">
            <LayoutGrid className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
          </div>
          <p className="text-sm text-ink-500">Sin movimientos.</p>
        </Surface.Body>
      </Surface>
    );
  }

  const nodes = toNodes(data);
  const total = nodes.reduce((acc, n) => acc + n.value, 0);

  return (
    <Surface aria-label={`Egresos por proyecto — total ${toCLP(total)}`}>
      <Surface.Header className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Surface.Title>Egresos por Proyecto</Surface.Title>
          <Surface.Subtitle>
            {toCLP(total)} · {data.length}{" "}
            {data.length === 1 ? "proyecto" : "proyectos"}
          </Surface.Subtitle>
        </div>
        {onToggleShowAll && (
          <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-xs text-ink-500">
            <input
              type="checkbox"
              checked={!!showAll}
              onChange={(e) => onToggleShowAll(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-hairline text-cehta-green focus:ring-cehta-green"
            />
            Incluir Oficina y Reversa
          </label>
        )}
      </Surface.Header>
      <Surface.Body className="mt-4 h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={nodes}
            dataKey="size"
            nameKey="name"
            stroke="#fff"
            fill="#1d6f42"
            isAnimationActive
            animationDuration={400}
            content={<CustomTreemapContent />}
          >
            <Tooltip content={<TreemapTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </Surface.Body>
    </Surface>
  );
}
