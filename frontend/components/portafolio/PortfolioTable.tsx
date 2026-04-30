"use client";

import { Surface } from "@/components/ui/surface";
import { toCLP, toPct } from "@/lib/format";
import type { EmpresaPortfolioRow } from "@/lib/api/schema";

interface Props {
  empresas: EmpresaPortfolioRow[];
}

function formatNative(amount: number, currency: string): string {
  if (currency === "CLP") return toCLP(amount);
  if (currency === "UF") {
    return `UF ${new Intl.NumberFormat("es-CL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)}`;
  }
  // USD u otra
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatUSD(amount: number | null): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function PortfolioTable({ empresas }: Props) {
  // Ordenado descendente por saldo CLP.
  const sorted = [...empresas].sort(
    (a, b) => Number(b.saldo_clp) - Number(a.saldo_clp),
  );

  return (
    <Surface aria-label="Detalle de saldos por empresa">
      <Surface.Header>
        <Surface.Title>Detalle por empresa</Surface.Title>
        <Surface.Subtitle>
          Saldo en moneda nativa, equivalente CLP/USD y % del portafolio
        </Surface.Subtitle>
      </Surface.Header>
      <Surface.Body className="mt-4 -mx-6 overflow-x-auto px-6">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-[11px] uppercase tracking-wide text-ink-500">
              <th className="text-left font-medium pb-2 pr-4">Código</th>
              <th className="text-left font-medium pb-2 pr-4">Razón social</th>
              <th className="text-right font-medium pb-2 pr-4">Saldo nativo</th>
              <th className="text-right font-medium pb-2 pr-4">Saldo CLP</th>
              <th className="text-right font-medium pb-2 pr-4">Saldo USD</th>
              <th className="text-right font-medium pb-2">% portafolio</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => {
              const native = Number(e.saldo_native);
              const clp = Number(e.saldo_clp);
              const usd =
                e.saldo_usd != null ? Number(e.saldo_usd) : null;
              const pct = Number(e.percent_of_portfolio);
              return (
                <tr
                  key={e.empresa_codigo}
                  className="border-b border-hairline/60 hover:bg-cehta-green/5 transition-colors"
                >
                  <td className="py-2.5 pr-4 font-medium text-ink-900">
                    {e.empresa_codigo}
                  </td>
                  <td className="py-2.5 pr-4 text-ink-700 truncate max-w-[280px]">
                    {e.razon_social}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-ink-700">
                    {formatNative(native, e.currency_native)}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-ink-900">
                    {toCLP(clp)}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-ink-700">
                    {formatUSD(usd)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-ink-700">
                    {toPct(pct, { digits: 1 })}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="py-8 text-center text-sm text-ink-500"
                >
                  Sin empresas activas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Surface.Body>
    </Surface>
  );
}
