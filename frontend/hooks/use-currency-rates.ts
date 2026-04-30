"use client";

/**
 * Currency rates — V4 fase 1.
 *
 * Hooks TanStack Query para obtener tasas UF/USD del día y convertir
 * montos. La cache es global (no per-empresa, no per-página) — todos
 * los componentes que muestren dinero pueden hidratarse desde el mismo
 * snapshot.
 *
 * `useLatestRates` tiene staleTime 1h: UF cambia 1x al día, USD cada
 * hora hábil; refetcheo cada hora es más que suficiente.
 *
 * Soft-fail: si el endpoint falla o devuelve null para alguna moneda,
 * los componentes siguen renderando el monto original sin conversión.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";
import type {
  ConversionRequest,
  ConversionResult,
  CurrencyCode,
  LatestRatesResponse,
} from "@/lib/api/schema";

const KEY = "currency";

export function useLatestRates() {
  const { session, loading } = useSession();
  return useQuery<LatestRatesResponse, Error>({
    queryKey: [KEY, "latest"],
    queryFn: () =>
      apiClient.get<LatestRatesResponse>("/currency/latest", session),
    enabled: !loading && !!session,
    staleTime: 60 * 60 * 1000, // 1 hora
    gcTime: 4 * 60 * 60 * 1000, // 4 horas
  });
}

/**
 * Hook one-shot para convertir un monto puntual. La mayoría de los
 * componentes prefieren usar `useLatestRates()` + cálculo local, pero
 * este hook está disponible para casos donde se necesita la tasa
 * exacta de una fecha histórica (no hoy).
 */
export function useConvert() {
  const { session } = useSession();
  return useMutation<
    ConversionResult,
    Error,
    {
      amount: number | string;
      from: CurrencyCode;
      to: CurrencyCode;
      date?: string;
    }
  >({
    mutationFn: ({ amount, from, to, date }) => {
      const body: ConversionRequest = {
        amount,
        from_currency: from,
        to_currency: to,
        date: date ?? null,
      };
      return apiClient.post<ConversionResult>(
        "/currency/convert",
        body,
        session,
      );
    },
  });
}

/**
 * Helper puro para convertir local-side usando un snapshot de
 * `useLatestRates`. Útil en componentes que no quieren disparar un POST
 * por cada hover. Devuelve null si la tasa requerida no está disponible.
 */
export function convertWithRates(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: { uf_clp?: number | null; usd_clp?: number | null },
): number | null {
  if (!Number.isFinite(amount)) return null;
  if (from === to) return amount;

  const uf = rates.uf_clp != null ? Number(rates.uf_clp) : null;
  const usd = rates.usd_clp != null ? Number(rates.usd_clp) : null;

  // X → CLP
  if (to === "CLP") {
    if (from === "UF") return uf != null ? amount * uf : null;
    if (from === "USD") return usd != null ? amount * usd : null;
  }
  // CLP → X
  if (from === "CLP") {
    if (to === "UF") return uf != null && uf > 0 ? amount / uf : null;
    if (to === "USD") return usd != null && usd > 0 ? amount / usd : null;
  }
  // UF ↔ USD via CLP
  if (from === "UF" && to === "USD") {
    return uf != null && usd != null && usd > 0 ? (amount * uf) / usd : null;
  }
  if (from === "USD" && to === "UF") {
    return uf != null && usd != null && uf > 0 ? (amount * usd) / uf : null;
  }
  return null;
}

/** Normaliza el shape `LatestRatesResponse` a `{uf_clp, usd_clp}` numéricos. */
export function ratesToNumbers(
  data: LatestRatesResponse | undefined,
): { uf_clp: number | null; usd_clp: number | null } {
  if (!data) return { uf_clp: null, usd_clp: null };
  return {
    uf_clp: data.uf_clp != null ? Number(data.uf_clp) : null,
    usd_clp: data.usd_clp != null ? Number(data.usd_clp) : null,
  };
}
