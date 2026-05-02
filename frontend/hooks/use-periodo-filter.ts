"use client";

/**
 * usePeriodoFilter — V5.6.
 *
 * Hook global para período seleccionado en CEO Dashboard. Persiste en URL
 * via useSearchParams para que se pueda compartir vista exacta y sobreviva
 * al refresh.
 *
 * Período afecta deltas comparativos en KPIs y rangos de queries.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export type Periodo = "30d" | "90d" | "ytd";

const VALID_PERIODOS: Periodo[] = ["30d", "90d", "ytd"];

export function usePeriodoFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams.get("periodo");
  const periodo: Periodo =
    raw && VALID_PERIODOS.includes(raw as Periodo) ? (raw as Periodo) : "30d";

  const setPeriodo = useCallback(
    (next: Periodo) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "30d") {
        params.delete("periodo"); // 30d es default, no ensucia URL
      } else {
        params.set("periodo", next);
      }
      const qs = params.toString();
      const url = `${pathname}${qs ? `?${qs}` : ""}`;
      // Cast a `as never` para sortear el typed-routes strict mode de Next 15.
      router.replace(url as never, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return { periodo, setPeriodo };
}
