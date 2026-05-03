"use client";

/**
 * TaskCard — card individual de un hito en el Kanban.
 *
 * Layout:
 *   ┌─────────────────────────────────────┐
 *   │ [Logo] EMP · Proyecto         [...] │ ← header
 *   │ Nombre del hito                     │ ← title (truncate 2 lines)
 *   │ ▰▰▰░░ 60%                            │ ← progress bar
 *   │ 👤 Felipe Zúñiga · hace 3 días      │ ← footer
 *   └─────────────────────────────────────┘
 *
 * On hover: <TaskQuickActions> aparece flotante en top-right.
 * Click: abre detalle (opcional fase 2 — por ahora link a /empresa/{cod}/avance).
 */
import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { TaskQuickActions } from "./TaskQuickActions";
import { EMPRESA_COLOR } from "./empresa-colors";
import type { HitoConContexto } from "@/lib/api/schema";

interface Props {
  hito: HitoConContexto;
  bucket: "vencidas" | "hoy" | "esta_semana" | "proximas_2_semanas" | "sin_fecha";
}

export function TaskCard({ hito, bucket }: Props) {
  const [hover, setHover] = useState(false);

  const empColor = EMPRESA_COLOR[hito.empresa_codigo] ?? "#94a3b8";
  const fechaRelativa = formatFechaRelativa(hito.fecha_planificada, hito.dias_hasta_vencimiento);
  const isUrgent = bucket === "vencidas" && (hito.dias_hasta_vencimiento ?? 0) < -3;

  return (
    <article
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn(
        "group relative rounded-xl border bg-white px-3 py-2.5 transition-all",
        "hover:-translate-y-0.5 hover:shadow-md",
        bucket === "vencidas" && "border-negative/30 bg-negative/[0.02]",
        bucket === "hoy" && "border-cehta-green/30",
        bucket === "esta_semana" && "border-info/30",
        bucket === "proximas_2_semanas" && "border-hairline",
        bucket === "sin_fecha" && "border-hairline border-dashed",
        isUrgent && "ring-2 ring-negative/20",
      )}
    >
      {/* Quick actions flotantes on hover */}
      {hover && (
        <div className="absolute right-1.5 top-1.5 z-10">
          <TaskQuickActions hito={hito} />
        </div>
      )}

      {/* Header: empresa + proyecto */}
      <div className="flex items-center gap-1.5">
        <EmpresaLogo empresaCodigo={hito.empresa_codigo} size={16} />
        <span
          className="rounded font-mono text-[9px] font-semibold uppercase tracking-wider text-white"
          style={{ background: empColor, padding: "1px 4px" }}
        >
          {hito.empresa_codigo}
        </span>
        <Link
          href={`/empresa/${hito.empresa_codigo}/avance` as never}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 truncate text-[10px] text-ink-500 hover:text-cehta-green hover:underline"
          title={hito.proyecto_nombre}
        >
          {hito.proyecto_nombre}
        </Link>
      </div>

      {/* Título del hito */}
      <h4
        className={cn(
          "mt-1 line-clamp-2 text-sm font-medium leading-snug",
          hito.estado === "completado" && "text-ink-400 line-through",
          bucket === "vencidas" ? "text-negative" : "text-ink-900",
        )}
      >
        {hito.nombre}
      </h4>

      {/* Progress bar (sólo si > 0) */}
      {hito.progreso_pct > 0 && hito.estado !== "completado" && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full bg-cehta-green transition-all"
              style={{ width: `${hito.progreso_pct}%` }}
            />
          </div>
          <span className="font-mono text-[10px] tabular-nums text-ink-500">
            {hito.progreso_pct}%
          </span>
        </div>
      )}

      {/* Footer: encargado + fecha */}
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <div className="flex min-w-0 items-center gap-1.5 text-ink-600">
          {hito.encargado ? (
            <>
              <span
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[8px] font-bold uppercase text-ink-600"
                aria-hidden
              >
                {getInitials(hito.encargado)}
              </span>
              <span className="truncate" title={hito.encargado}>
                {hito.encargado}
              </span>
            </>
          ) : (
            <span className="text-ink-400 italic">Sin encargado</span>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 font-mono tabular-nums",
            bucket === "vencidas" && "font-bold text-negative",
            bucket === "hoy" && "text-cehta-green",
            bucket === "esta_semana" && "text-info",
            bucket === "proximas_2_semanas" && "text-ink-500",
            bucket === "sin_fecha" && "text-ink-400",
          )}
        >
          {fechaRelativa}
        </span>
      </div>
    </article>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function formatFechaRelativa(
  fecha: string | null | undefined,
  dias: number | null | undefined,
): string {
  if (!fecha) return "sin fecha";
  if (dias === null || dias === undefined) {
    return fecha; // fallback
  }
  if (dias < 0) {
    const abs = Math.abs(dias);
    if (abs === 1) return "ayer";
    if (abs < 7) return `hace ${abs}d`;
    if (abs < 30) return `hace ${Math.floor(abs / 7)}sem`;
    return `hace ${Math.floor(abs / 30)}m`;
  }
  if (dias === 0) return "HOY";
  if (dias === 1) return "mañana";
  if (dias < 7) return `en ${dias}d`;
  if (dias < 30) return `en ${Math.ceil(dias / 7)}sem`;
  return `en ${Math.ceil(dias / 30)}m`;
}
