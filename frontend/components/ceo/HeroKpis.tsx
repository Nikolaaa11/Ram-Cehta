"use client";

import { Wallet, TrendingUp, Building2, Banknote } from "lucide-react";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { CurrencyTooltip } from "@/components/shared/CurrencyTooltip";
import { toCLPCompact, toPct } from "@/lib/format";
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

  // AUM Total tone — refleja tendencia 30d (positive/negative/default)
  const aumDir: "up" | "down" | "flat" =
    data.delta_30d > 0 ? "up" : data.delta_30d < 0 ? "down" : "flat";
  const aumTone =
    aumDir === "up" ? "positive" : aumDir === "down" ? "negative" : "default";

  // CORFO tone — si tiene saldo activo, marcar como positive (operación viva)
  const corfoNum = Number(data.aum_corfo);
  const corfoTone = corfoNum > 0 ? "positive" : "default";

  return (
    <section
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="Indicadores principales del portafolio"
    >
      <CurrencyTooltip amount={Number(data.aum_total)} currency="CLP">
        <div className="h-full">
          <KpiCard
            label="AUM total"
            value={toCLPCompact(data.aum_total)}
            subtitle={`90d: ${toPct(data.delta_90d, { signed: true })}`}
            icon={Wallet}
            tone={aumTone}
            // AUM Total es el "hero del hero" — destacar con ring sutil
            className="ring-1 ring-cehta-green/20"
            delta={{
              value: toPct(data.delta_30d, { signed: true }),
              label: "vs. 30 días",
              direction: aumDir,
            }}
          />
        </div>
      </CurrencyTooltip>

      <CurrencyTooltip amount={Number(data.aum_cehta)} currency="CLP">
        <div className="h-full">
          <KpiCard
            label="AUM Cehta"
            value={toCLPCompact(data.aum_cehta)}
            subtitle={
              Number(data.aum_cehta) > 0
                ? "cuentas operativas"
                : "Sin saldo registrado"
            }
            icon={Building2}
            tone={Number(data.aum_cehta) > 0 ? "default" : "warning"}
          />
        </div>
      </CurrencyTooltip>

      <CurrencyTooltip amount={Number(data.aum_corfo)} currency="CLP">
        <div className="h-full">
          <KpiCard
            label="AUM CORFO"
            value={toCLPCompact(data.aum_corfo)}
            subtitle="cuentas crédito CORFO"
            icon={Banknote}
            tone={corfoTone}
          />
        </div>
      </CurrencyTooltip>

      <CurrencyTooltip amount={Number(data.flujo_neto_30d)} currency="CLP">
        <div className="h-full">
          <KpiCard
            label="Flujo neto 30d"
            value={toCLPCompact(data.flujo_neto_30d)}
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
        </div>
      </CurrencyTooltip>
    </section>
  );
}
