import {
  ArrowDownCircle,
  ArrowUpCircle,
  Briefcase,
  Landmark,
  Gauge,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { toCLP, toPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ResumenCCKpis } from "@/lib/api/schema";

/**
 * 5 KPIs apple-style: label uppercase + value display tabular-nums + subtitle.
 * Match con el screenshot del user (dashboard tipo Rho).
 *
 * El orden refleja la jerarquía visual: Egresos → Abonos → Operacionales →
 * Presupuesto → Ejecución (la "salud" de la cuenta).
 */
interface KpiTile {
  label: string;
  value: string;
  subtitle?: string;
  Icon: typeof ArrowDownCircle;
  tone: "default" | "negative" | "positive" | "warning";
}

function ejecucionTone(pct: number): KpiTile["tone"] {
  if (pct >= 100) return "negative"; // sobre-ejecutado
  if (pct >= 85) return "warning"; // cerca del techo
  if (pct >= 50) return "positive";
  return "default";
}

const toneIconBg: Record<KpiTile["tone"], string> = {
  default: "bg-ink-100/60 text-ink-700",
  positive: "bg-positive/10 text-positive",
  negative: "bg-negative/10 text-negative",
  warning: "bg-warning/10 text-warning",
};

export function KpisGrid({ kpis }: { kpis: ResumenCCKpis }) {
  const ejecucion = Number(kpis.ejecucion_pcto ?? 0);
  const tiles: KpiTile[] = [
    {
      label: "Egresos Totales CC",
      value: toCLP(kpis.egresos_totales_cc),
      Icon: ArrowDownCircle,
      tone: "negative",
    },
    {
      label: "Abonos Totales CC",
      value: toCLP(kpis.abonos_totales_cc),
      Icon: ArrowUpCircle,
      tone: "positive",
    },
    {
      label: "Egresos Operacionales",
      value: toCLP(kpis.egresos_operacionales),
      subtitle: "Excluye capital y reversas",
      Icon: Briefcase,
      tone: "warning",
    },
    {
      label: "Presupuesto CORFO",
      value: toCLP(kpis.presupuesto_corfo),
      subtitle: "Saldo disponible",
      Icon: Landmark,
      tone: "default",
    },
    {
      label: "Ejecución Ppto",
      value: toPct(ejecucion, { digits: 1 }),
      subtitle:
        Number(kpis.presupuesto_corfo) > 0
          ? `${toCLP(kpis.egresos_operacionales)} de ${toCLP(kpis.presupuesto_corfo)}`
          : "Sin presupuesto registrado",
      Icon: Gauge,
      tone: ejecucionTone(ejecucion),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {tiles.map((tile) => {
        const Icon = tile.Icon;
        return (
          <Surface
            key={tile.label}
            className="flex h-[160px] flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                {tile.label}
              </p>
              <span
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-xl",
                  toneIconBg[tile.tone],
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.5} />
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <p className="font-display text-kpi-lg tabular-nums text-ink-900">
                {tile.value}
              </p>
              {tile.subtitle && (
                <p className="truncate text-xs tabular-nums text-ink-500">
                  {tile.subtitle}
                </p>
              )}
            </div>
          </Surface>
        );
      })}
    </div>
  );
}
