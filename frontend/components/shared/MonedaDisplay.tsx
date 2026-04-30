"use client";

/**
 * MonedaDisplay — V4 fase 1.
 *
 * Componente atómico para mostrar un monto con moneda explícita y
 * tooltip de equivalencias on-hover. Reemplaza usos sueltos de `toCLP`
 * / `toUF` cuando el contexto lo amerita (KPIs hero, contratos legales,
 * suscripciones FIP — todo donde el CEO quiere "ver al toque" la
 * equivalencia en la otra moneda).
 *
 * Ejemplo:
 *   <MonedaDisplay amount={1500} currency="UF" />
 *     → "UF 1.500,00"  (tooltip on-hover: $59.250.000 CLP / $63 USD)
 *
 *   <MonedaDisplay amount={59250000} currency="CLP" showAlt />
 *     → "$59.250.000"
 *       "≈ UF 1.500,00"   (alt currency inline en gris)
 */
import * as React from "react";
import { CurrencyTooltip } from "@/components/shared/CurrencyTooltip";
import {
  convertWithRates,
  ratesToNumbers,
  useLatestRates,
} from "@/hooks/use-currency-rates";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/api/schema";

function formatByCurrency(amount: number, currency: CurrencyCode): string {
  if (!Number.isFinite(amount)) return "—";
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
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Devuelve la moneda alternativa "natural" para mostrar inline.
 *  CLP → UF (operativo chileno, muestra el reference financiero)
 *  UF  → CLP (contrato grande, muestra valor en pesos hoy)
 *  USD → CLP
 */
function altCurrency(c: CurrencyCode): CurrencyCode {
  if (c === "UF") return "CLP";
  if (c === "USD") return "CLP";
  return "UF";
}

export interface MonedaDisplayProps {
  amount: number | string | null | undefined;
  currency: CurrencyCode;
  className?: string;
  /** Si true, muestra la moneda alternativa inline en texto chico abajo. */
  showAlt?: boolean;
  /** Si true, no envuelve en tooltip (caso edge: dentro de otro tooltip). */
  noTooltip?: boolean;
}

export function MonedaDisplay({
  amount,
  currency,
  className,
  showAlt = false,
  noTooltip = false,
}: MonedaDisplayProps) {
  const { data: rates } = useLatestRates();
  const norm = ratesToNumbers(rates);

  const num = typeof amount === "string" ? Number(amount) : amount;
  if (num == null || Number.isNaN(num)) {
    return <span className={cn("tabular-nums", className)}>—</span>;
  }

  const main = formatByCurrency(num, currency);
  const alt = showAlt
    ? convertWithRates(num, currency, altCurrency(currency), norm)
    : null;

  const inner = (
    <span className={cn("inline-flex flex-col tabular-nums", className)}>
      <span>{main}</span>
      {showAlt && alt != null && (
        <span className="text-[11px] text-ink-500">
          ≈ {formatByCurrency(alt, altCurrency(currency))}
        </span>
      )}
    </span>
  );

  if (noTooltip) return inner;

  return (
    <CurrencyTooltip amount={num} currency={currency}>
      {inner}
    </CurrencyTooltip>
  );
}
