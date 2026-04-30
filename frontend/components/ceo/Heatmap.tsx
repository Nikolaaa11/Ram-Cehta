import { Surface } from "@/components/ui/surface";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { cn } from "@/lib/utils";
import type { HeatmapCell } from "@/lib/api/schema";

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
  if (color === "green") return "bg-positive/15 text-positive";
  if (color === "yellow") return "bg-warning/15 text-warning";
  if (color === "red") return "bg-negative/15 text-negative";
  return "bg-ink-100 text-ink-500";
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
  const empresas = Array.from(
    new Set(heatmap.map((c) => c.empresa_codigo)),
  ).sort();

  // Index por (empresa, kpi) para acceso O(1)
  const cellMap = new Map<string, HeatmapCell>();
  for (const c of heatmap) {
    cellMap.set(`${c.empresa_codigo}::${c.kpi}`, c);
  }

  return (
    <Surface padding="none">
      <Surface.Header className="border-b border-hairline px-6 py-4">
        <Surface.Title>Heatmap del portafolio</Surface.Title>
        <Surface.Subtitle>
          Salud por empresa × KPI · verde ≥80, amarillo 60–79, rojo {"<"}60
        </Surface.Subtitle>
      </Surface.Header>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-hairline text-sm">
          <thead className="bg-ink-100/40 text-xs uppercase tracking-wide text-ink-500">
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
            {empresas.map((emp) => (
              <tr key={emp} className="transition-colors duration-150 hover:bg-ink-100/30">
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
                        <span
                          className={cn(
                            "inline-flex h-9 w-12 items-center justify-center rounded-lg text-xs font-semibold tabular-nums",
                            colorClasses(cell.color),
                          )}
                          title={`${KPI_LABELS[k] ?? k}: ${cell.value}/100`}
                        >
                          {cell.value}
                        </span>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}
