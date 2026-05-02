"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Surface } from "@/components/ui/surface";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { cn } from "@/lib/utils";
import type { HeatmapCell } from "@/lib/api/schema";

const KPI_DESCRIPTION: Record<string, string> = {
  saldo: "Saldo contable consolidado de la empresa. Refleja liquidez disponible.",
  flujo: "Flujo neto últimos 30 días (abonos − egresos). Indica salud operativa.",
  oc: "OCs pendientes de pago. Score baja con OCs estancadas >30 días.",
  f29: "F29 (IVA + PPM) próximos a vencer o vencidos. Score baja por vencimientos.",
  etl: "Última sincronización ETL. Score baja si datos están stale (>24h).",
  audit: "Auditoría: cambios sospechosos, accesos sin 2FA, anomalías recientes.",
};

const KPI_LABELS: Record<string, string> = {
  saldo: "Saldo",
  flujo: "Flujo",
  oc: "OCs",
  f29: "F29",
  etl: "ETL",
  audit: "Audit",
};

const KPI_ORDER = ["saldo", "flujo", "oc", "f29", "etl", "audit"];

function colorClasses(color: string) {
  // Contrast WCAG AA — subimos opacity de fill + bold del text
  if (color === "green") return "bg-positive/25 text-positive ring-1 ring-positive/30";
  if (color === "yellow") return "bg-warning/25 text-warning ring-1 ring-warning/30";
  if (color === "red") return "bg-negative/25 text-negative ring-1 ring-negative/30";
  return "bg-ink-100 text-ink-500 ring-1 ring-hairline";
}

interface Props {
  heatmap: HeatmapCell[];
}

/**
 * Heatmap empresas × KPIs. Renderizado server-component (puro), sin estado.
 *
 * Layout: una fila por empresa, una columna por KPI. Cada celda muestra el
 * valor 0-100 con tono semaforo (green ≥80, yellow 60-79, red <60).
 */
export function Heatmap({ heatmap }: Props) {
  const [selected, setSelected] = useState<{
    empresa: string;
    kpi: string;
    cell: HeatmapCell;
  } | null>(null);
  const empresas = Array.from(
    new Set(heatmap.map((c) => c.empresa_codigo)),
  ).sort();

  // Index por (empresa, kpi) para acceso O(1)
  const cellMap = new Map<string, HeatmapCell>();
  for (const c of heatmap) {
    cellMap.set(`${c.empresa_codigo}::${c.kpi}`, c);
  }

  const closeModal = () => setSelected(null);

  return (
    <Surface padding="none">
      <Surface.Header className="border-b border-hairline px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Surface.Title>Heatmap del portafolio</Surface.Title>
            <Surface.Subtitle>
              Salud por empresa × KPI (0-100)
            </Surface.Subtitle>
          </div>
          {/* Leyenda visual con swatches en lugar de texto */}
          <div className="flex items-center gap-2 text-[10px] text-ink-500">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-positive/25 ring-1 ring-positive/30" />
              ≥80
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-warning/25 ring-1 ring-warning/30" />
              60–79
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded bg-negative/25 ring-1 ring-negative/30" />
              {"<"}60
            </span>
          </div>
        </div>
      </Surface.Header>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-hairline text-sm">
          <thead className="sticky top-0 z-10 bg-ink-100/60 text-xs uppercase tracking-wide text-ink-500 backdrop-blur">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Empresa</th>
              {KPI_ORDER.map((k) => (
                <th key={k} className="px-3 py-3 text-center font-medium">
                  {KPI_LABELS[k] ?? k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {empresas.map((emp, idx) => (
              <tr
                key={emp}
                className={cn(
                  "transition-colors duration-150 hover:bg-cehta-green/5",
                  idx % 2 === 1 && "bg-ink-50/30",
                )}
              >
                <td className="px-4 py-3 font-medium tabular-nums text-ink-900">
                  <div className="flex items-center gap-2">
                    <EmpresaLogo empresaCodigo={emp} size={22} />
                    <span>{emp}</span>
                  </div>
                </td>
                {KPI_ORDER.map((k) => {
                  const cell = cellMap.get(`${emp}::${k}`);
                  return (
                    <td key={k} className="px-2 py-2 text-center">
                      {cell ? (
                        <button
                          type="button"
                          onClick={() =>
                            setSelected({ empresa: emp, kpi: k, cell })
                          }
                          className={cn(
                            "inline-flex h-10 w-14 items-center justify-center rounded-lg text-sm font-bold tabular-nums transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                            colorClasses(cell.color),
                          )}
                          aria-label={`Ver detalle ${emp} ${KPI_LABELS[k] ?? k}: ${cell.value} de 100`}
                        >
                          {cell.value}
                        </button>
                      ) : (
                        <span
                          className="text-ink-300"
                          aria-label="Sin datos"
                        >
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Drill-down modal */}
      <Dialog open={selected !== null} onOpenChange={closeModal}>
        <DialogContent className="max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <EmpresaLogo empresaCodigo={selected.empresa} size={32} />
                  <span>
                    {selected.empresa} ·{" "}
                    {KPI_LABELS[selected.kpi] ?? selected.kpi}
                  </span>
                </DialogTitle>
                <DialogDescription>
                  {KPI_DESCRIPTION[selected.kpi] ?? "Indicador de salud."}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 space-y-3">
                {/* Big score */}
                <div
                  className={cn(
                    "rounded-2xl p-6 text-center ring-1",
                    colorClasses(selected.cell.color),
                  )}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
                    Score salud
                  </p>
                  <p className="mt-1 font-display text-5xl font-bold tabular-nums">
                    {selected.cell.value}
                  </p>
                  <p className="mt-1 text-[10px] opacity-80">de 100</p>
                </div>

                {/* Interpretation */}
                <div className="rounded-xl border border-hairline bg-white p-3 text-sm text-ink-700">
                  <p className="font-medium">Interpretación:</p>
                  <p className="mt-1 text-xs leading-relaxed">
                    {selected.cell.value >= 80
                      ? "✓ Indicador en estado óptimo. Sin acción requerida."
                      : selected.cell.value >= 60
                        ? "⚠ Atención recomendada. Revisar tendencia y causas."
                        : "✗ Riesgo activo. Requiere intervención operativa."}
                  </p>
                </div>

                {/* CTA empresa */}
                <a
                  href={`/empresa/${selected.empresa}`}
                  className="block rounded-xl bg-cehta-green px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-cehta-green-700"
                >
                  Ver dashboard completo de {selected.empresa} →
                </a>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Surface>
  );
}
