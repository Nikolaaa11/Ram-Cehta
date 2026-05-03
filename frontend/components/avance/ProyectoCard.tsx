"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Calendar,
  FileSpreadsheet,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { GanttMini } from "./GanttMini";
import { HitoChecklist } from "./HitoChecklist";
import { toDate } from "@/lib/format";
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

export function ProyectoCard({
  proyecto,
  empresaCodigo,
  canEdit,
  onAddHito,
}: Props) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Surface padding="none">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-4 rounded-2xl px-6 py-4 text-left transition-colors hover:bg-ink-100/30"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="h-5 w-5 text-ink-500" strokeWidth={1.5} />
          ) : (
            <ChevronRight className="h-5 w-5 text-ink-500" strokeWidth={1.5} />
          )}
          <div>
            <div className="flex items-center gap-2">
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
            </div>
            <p className="text-xs text-ink-500">
              {proyecto.fecha_inicio
                ? `${toDate(proyecto.fecha_inicio)} → ${
                    proyecto.fecha_fin_estimada
                      ? toDate(proyecto.fecha_fin_estimada)
                      : "—"
                  }`
                : "Sin fechas definidas"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {proyecto.riesgos_abiertos > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">
              <AlertTriangle className="h-3 w-3" strokeWidth={1.5} />
              {proyecto.riesgos_abiertos}
            </span>
          )}
          <span className="text-xs tabular-nums text-ink-700">
            {proyecto.progreso_pct}%
          </span>
          <Badge variant={ESTADO_VARIANT[proyecto.estado] ?? "neutral"}>
            {proyecto.estado.replace("_", " ")}
          </Badge>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-hairline px-6 py-4">
          {proyecto.descripcion && (
            <p className="mb-3 text-sm text-ink-700">{proyecto.descripcion}</p>
          )}

          <div className="mb-4">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">
              <Calendar className="h-3 w-3" strokeWidth={1.5} /> Timeline
            </h4>
            <GanttMini
              fechaInicio={proyecto.fecha_inicio}
              fechaFin={proyecto.fecha_fin_estimada}
              progresoPct={proyecto.progreso_pct}
              hitos={proyecto.hitos}
            />
          </div>

          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">
              Hitos ({proyecto.hitos.length})
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
            <div className="mt-4 border-t border-hairline pt-3 text-xs text-ink-500">
              Owner: {proyecto.owner_email}
            </div>
          )}
        </div>
      )}
    </Surface>
  );
}
