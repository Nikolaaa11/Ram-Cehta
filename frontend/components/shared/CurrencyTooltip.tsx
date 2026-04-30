"use client";

/**
 * CurrencyTooltip — V4 fase 1.
 *
 * Wrapper que muestra un tooltip on-hover con las equivalencias del monto
 * en las otras dos monedas (CLP/UF/USD). Usa `useLatestRates()` y hace
 * los cálculos client-side (sin trip al backend por cada hover).
 *
 * Soft-fail: si las tasas no están disponibles (API down o sin cache),
 * el tooltip simplemente no aparece — el children sigue visible normal.
 *
 * Ejemplo:
 *   <CurrencyTooltip amount={1500} currency="UF">
 *     <span>1.500 UF</span>
 *   </CurrencyTooltip>
 */
import * as React from "react";
import { SimpleTooltip } from "@/components/ui/tooltip";
import {
  convertWithRates,
  ratesToNumbers,
  useLatestRates,
} from "@/hooks/use-currency-rates";
import type { CurrencyCode } from "@/lib/api/schema";

const ALL_CURRENCIES: CurrencyCode[] = ["CLP", "UF", "USD"];

function formatByCurrency(amount: number, currency: CurrencyCode): string {
  if (currency === "CLP") {
    return new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency: "CLP",
      maximumFractionDigits: 0,
    }).format(amount);
  }
  if (currency === "UF") {
    return `UF ${new Intl.NumberFormat("es-CL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)}`;
  }
  // USD
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

export interface CurrencyTooltipProps {
  amount: number;
  currency: CurrencyCode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export function CurrencyTooltip({
  amount,
  currency,
  children,
  side = "top",
}: CurrencyTooltipProps) {
  const { data: rates } = useLatestRates();
  const norm = ratesToNumbers(rates);

  // Convertir a las otras 2 monedas.
  const others = ALL_CURRENCIES.filter((c) => c !== currency)
    .map((c) => ({
      code: c,
      converted: convertWithRates(amount, currency, c, norm),
    }))
    .filter((x) => x.converted != null) as {
    code: CurrencyCode;
    converted: number;
  }[];

  // Si no hay tasas o la conversión falló para todas, no mostramos tooltip.
  if (others.length === 0) {
    return <>{children}</>;
  }

  const content = (
    <div className="flex flex-col gap-0.5 tabular-nums">
      <span className="text-[11px] font-medium text-white/70">
        Equivalencias
      </span>
      {others.map(({ code, converted }) => (
        <span key={code} className="text-xs">
          {formatByCurrency(converted, code)}
        </span>
      ))}
      {rates?.date && (
        <span className="mt-1 text-[10px] text-white/50">
          @ {rates.date}
        </span>
      )}
    </div>
  );

  return (
    <SimpleTooltip content={content} side={side}>
      <span className="cursor-help">{children}</span>
    </SimpleTooltip>
  );
}
