"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Route } from "next";
import { useCallback, useMemo } from "react";

export interface DashboardFilters {
  empresa: string | null;
  from: string | null;
  to: string | null;
}

/**
 * Lee/escribe los filtros del dashboard desde URL params.
 *
 * Ventajas: shareable links, back/forward funciona, sin estado global.
 *
 *   ?empresa=TRONGKAI&from=2025-01&to=2026-04
 */
export function useDashboardFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const filters = useMemo<DashboardFilters>(
    () => ({
      empresa: params.get("empresa"),
      from: params.get("from"),
      to: params.get("to"),
    }),
    [params],
  );

  const update = useCallback(
    (patch: Partial<DashboardFilters>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      const url = (qs ? `${pathname}?${qs}` : pathname) as Route;
      router.replace(url, { scroll: false });
    },
    [params, pathname, router],
  );

  const setEmpresa = useCallback(
    (empresa: string | null) => update({ empresa }),
    [update],
  );

  const setPeriodo = useCallback(
    (from: string | null, to: string | null) => update({ from, to }),
    [update],
  );

  return { filters, setEmpresa, setPeriodo };
}
