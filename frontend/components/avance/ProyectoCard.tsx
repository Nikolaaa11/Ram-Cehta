"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Calendar,
  FileSpreadsheet,
  User,
  Clock,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { GanttMini } from "./GanttMini";
import { HitoChecklist } from "./HitoChecklist";
import { toDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProyectoListItem } from "@/lib/api/schema";

const ESTADO_VARIANT: Record<
  string,
  "success" | "warning" | "danger" | "neutral" | "info"
> = {
  planificado: "neutral",
  en_progreso: "info",
  completado: "success",
  pausado: "warning",
  cancelado: "danger",
};

const FORMATO_LABEL: Record<string, string> = {
  classic: "Gantt clásico",
  ee: "Gantt EE",
  revtech: "Gantt REVTECH",
};

interface Props {
  proyecto: ProyectoListItem;
  empresaCodigo: string;
  canEdit: boolean;
  onAddHito: (proyectoId: number) => void;
}

function getInitials(email: string | null | undefined): string {
  if (!email) return "?";
  const local = email.split("@")[0] ?? "";
  if (!local) return "?";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return ((parts[0][0] ?? "") + (parts[1][0] ?? "")).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function getDaysRemaining(fechaFin: string | null | undefined): {
  days: number | null;
  label: string;
  tone: "positive" | "warning" | "negative" | "neutral";
} {
  if (!fechaFin) return { days: null, label: "Sin fecha fin", tone: "neutral" };
  const end = new Date(fechaFin);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return { days, label: `Vencido hace ${-days}d`, tone: "negative" };
  if (days === 0) return { days, label: "Vence hoy", tone: "warning" };
  if (days <= 7) return { days, label: `Faltan ${days}d`, tone: "warning" };
  if (days <= 30) return { days, label: `Faltan ${days}d`, tone: "neutral" };
  return { days, label: `Faltan ${days}d`, tone: "positive" };
}

export function ProyectoCard({
  proyecto,
  empresaCodigo,
  canEdit,
  onAddHito,
}: Props) {
  const [expanded, setExpanded] = useState(true);

  const initials = getInitials(proyecto.owner_email);
  const daysInfo = getDaysRemaining(proyecto.fecha_fin_estimada);
  const completedHitos = proyecto.hitos.filter((h) => h.estado === "completado").length;

  const toneClasses = {
    positive: "bg-positive/10 text-positive",
    warning: "bg-warning/10 text-warning",
    negative: "bg-negative/10 text-negative",
    neutral: "bg-ink-100 text-ink-500",
  };

  return (
    <Surface padding="none" className="overflow-hidden transition-shadow hover:shadow-card-hover">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-4 rounded-2xl px-6 py-4 text-left transition-colors hover:bg-ink-50/40"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <ChevronRight
            className={cn(
              "mt-0.5 h-5 w-5 shrink-0 text-ink-400 transition-transform duration-200",
              expanded && "rotate-90",
            )}
            strokeWidth={1.75}
          />

          <div className="min-w-0 flex-1">
            {/* Header line */}
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-base font-semibold text-ink-900">
                {proyecto.nombre}
              </h3>
              {proyecto.metadata_?.codigo_excel && (
                <span
                  title={`Importado desde ${
                    FORMATO_LABEL[proyecto.metadata_.imported_format ?? ""] ??
                    "Excel"
                  } · código original: ${proyecto.metadata_.codigo_excel}`}
                  className="inline-flex items-center gap-1 rounded-md bg-cehta-green/10 px-1.5 py-0.5 font-mono text-[10px] text-cehta-green"
                >
                  <FileSpreadsheet className="h-3 w-3" strokeWidth={1.75} />
                  {proyecto.metadata_.codigo_excel}
                </span>
              )}
              <Badge variant={ESTADO_VARIANT[proyecto.estado] ?? "neutral"}>
                {proyecto.estado.replace("_", " ")}
              </Badge>
            </div>

            {/* Meta line: dates + days remaining + owner */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" strokeWidth={1.5} />
                {proyecto.fecha_inicio
                  ? `${toDate(proyecto.fecha_inicio)} → ${
                      proyecto.fecha_fin_estimada
                        ? toDate(proyecto.fecha_fin_estimada)
                        : "—"
                    }`
                  : "Sin fechas definidas"}
              </span>
              {daysInfo.days !== null && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
                    toneClasses[daysInfo.tone],
                  )}
                >
                  <Clock className="h-3 w-3" strokeWidth={1.75} />
                  {daysInfo.label}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                ✓ {completedHitos}/{proyecto.hitos.length} hitos
              </span>
              {proyecto.riesgos_abiertos > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-warning">
                  <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
                  {proyecto.riesgos_abiertos}{" "}
                  {proyecto.riesgos_abiertos === 1 ? "riesgo" : "riesgos"}
                </span>
              )}
            </div>

            {/* Always-visible progress bar */}
            <div className="mt-2.5 flex items-center gap-2">
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cehta-green-700 via-cehta-green to-positive transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, proyecto.progreso_pct))}%` }}
                />
              </div>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-700">
                {proyecto.progreso_pct}%
              </span>
            </div>
          </div>
        </div>

        {/* Owner avatar */}
        {proyecto.owner_email && (
          <div
            title={`Owner: ${proyecto.owner_email}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cehta-green to-cehta-green-700 text-xs font-bold text-white shadow-sm"
          >
            {initials}
          </div>
        )}
      </button>

      {expanded && (
        <div className="border-t border-hairline px-6 py-5 animate-in fade-in slide-in-from-top-1 duration-200">
          {proyecto.descripcion && (
            <p className="mb-4 text-sm text-ink-700">{proyecto.descripcion}</p>
          )}

          <div className="mb-5">
            <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">
              <Calendar className="h-3 w-3" strokeWidth={1.75} /> Timeline
            </h4>
            <GanttMini
              fechaInicio={proyecto.fecha_inicio}
              fechaFin={proyecto.fecha_fin_estimada}
              progresoPct={proyecto.progreso_pct}
              hitos={proyecto.hitos}
            />
          </div>

          <div>
            <h4 className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">
              <span>Hitos ({proyecto.hitos.length})</span>
              {canEdit && proyecto.hitos.length > 1 && (
                <span className="text-[10px] font-normal normal-case tracking-normal text-ink-400">
                  Arrastra para reordenar
                </span>
              )}
            </h4>
            <HitoChecklist
              proyectoId={proyecto.proyecto_id}
              hitos={proyecto.hitos}
              empresaCodigo={empresaCodigo}
              canEdit={canEdit}
              onAddHito={() => onAddHito(proyecto.proyecto_id)}
            />
          </div>

          {proyecto.owner_email && (
            <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3 text-xs text-ink-500">
              <User className="h-3.5 w-3.5" strokeWidth={1.5} />
              Owner:{" "}
              <span className="font-medium text-ink-700">{proyecto.owner_email}</span>
            </div>
          )}
        </div>
      )}
    </Surface>
  );
}
