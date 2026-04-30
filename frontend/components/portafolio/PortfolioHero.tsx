"use client";

import { Coins, DollarSign, Wallet } from "lucide-react";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { toCLP, toDate } from "@/lib/format";
import type { PortfolioConsolidated } from "@/lib/api/schema";

/**
 * Hero KPIs del portafolio: 3 grandes números (CLP / USD / UF).
 *
 * Cada card tiene tooltip on-hover con la tasa usada y la fecha del
 * snapshot — feature pedido para trazabilidad cuando los LPs preguntan
 * "¿con qué dólar calcularon esto?".
 */
function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function formatUSD(v: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
}

function formatUF(v: number): string {
  return `UF ${new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v)}`;
}

interface Props {
  data: PortfolioConsolidated;
}

export function PortfolioHero({ data }: Props) {
  const totalClp = num(data.total_clp) ?? 0;
  const totalUsd = num(data.total_usd);
  const totalUf = num(data.total_uf);
  const ufRate = num(data.rates_used.uf_clp);
  const usdRate = num(data.rates_used.usd_clp);
  const rateDate = data.rates_used.date;

  const tooltipUsd = (
    <div className="flex flex-col gap-0.5 text-xs">
      <span className="text-white/70">Tasa USD usada</span>
      <span className="tabular-nums">
        {usdRate != null ? toCLP(usdRate) : "Sin tasa"} / USD
      </span>
      {rateDate && (
        <span className="text-white/50 text-[10px] mt-1">
          @ {toDate(rateDate)}
        </span>
      )}
    </div>
  );

  const tooltipUf = (
    <div className="flex flex-col gap-0.5 text-xs">
      <span className="text-white/70">Tasa UF usada</span>
      <span className="tabular-nums">
        {ufRate != null ? toCLP(ufRate) : "Sin tasa"} / UF
      </span>
      {rateDate && (
        <span className="text-white/50 text-[10px] mt-1">
          @ {toDate(rateDate)}
        </span>
      )}
    </div>
  );

  return (
    <section
      className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      aria-label="Total del portafolio"
    >
      <KpiCard
        label="Total CLP"
        value={toCLP(totalClp)}
        subtitle={`${data.empresas.length} empresas`}
        icon={Wallet}
        tone="default"
      />

      <SimpleTooltip content={tooltipUsd} side="bottom">
        <div className="cursor-help">
          <KpiCard
            label="Total USD"
            value={totalUsd != null ? formatUSD(totalUsd) : "Sin conversión"}
            subtitle={
              totalUsd != null
                ? "@ tasa de hoy"
                : "Tasa USD no disponible"
            }
            icon={DollarSign}
            tone={totalUsd != null ? "positive" : "warning"}
          />
        </div>
      </SimpleTooltip>

      <SimpleTooltip content={tooltipUf} side="bottom">
        <div className="cursor-help">
          <KpiCard
            label="Total UF"
            value={totalUf != null ? formatUF(totalUf) : "Sin conversión"}
            subtitle={
              totalUf != null ? "@ tasa de hoy" : "Tasa UF no disponible"
            }
            icon={Coins}
            tone={totalUf != null ? "default" : "warning"}
          />
        </div>
      </SimpleTooltip>
    </section>
  );
}
