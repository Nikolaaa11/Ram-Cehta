import { Wallet, TrendingUp, Building2, Banknote } from "lucide-react";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { toCLP, toPct } from "@/lib/format";
import type { CEOConsolidatedReport } from "@/lib/api/schema";

/**
 * Hero KPIs del Dashboard CEO — 4 cards grandes con AUM consolidado, AUM Cehta,
 * AUM CORFO y flujo neto 30d. Mostramos deltas vs 30d/90d en la primer card.
 *
 * Server-component: no hooks, no client interactivity. Renderizado estático.
 */
export function HeroKpis({ data }: { data: CEOConsolidatedReport }) {
  const flujoNeto = Number(data.flujo_neto_30d);
  const flujoDir: "up" | "down" | "flat" =
    flujoNeto > 0 ? "up" : flujoNeto < 0 ? "down" : "flat";

  return (
    <section
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="Indicadores principales del portafolio"
    >
      <KpiCard
        label="AUM total"
        value={toCLP(data.aum_total)}
        subtitle={`90d: ${toPct(data.delta_90d, { signed: true })}`}
        icon={Wallet}
        tone="default"
        delta={{
          value: toPct(data.delta_30d, { signed: true }),
          label: "vs. 30 días",
          direction:
            data.delta_30d > 0 ? "up" : data.delta_30d < 0 ? "down" : "flat",
        }}
      />

      <KpiCard
        label="AUM Cehta"
        value={toCLP(data.aum_cehta)}
        subtitle="cuentas operativas"
        icon={Building2}
        tone="default"
      />

      <KpiCard
        label="AUM CORFO"
        value={toCLP(data.aum_corfo)}
        subtitle="cuentas crédito CORFO"
        icon={Banknote}
        tone="default"
      />

      <KpiCard
        label="Flujo neto 30d"
        value={toCLP(data.flujo_neto_30d)}
        subtitle="abonos − egresos últimos 30 días"
        icon={TrendingUp}
        tone={
          flujoDir === "up"
            ? "positive"
            : flujoDir === "down"
              ? "negative"
              : "default"
        }
      />
    </section>
  );
}
