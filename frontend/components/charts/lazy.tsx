"use client";

/**
 * lazy.tsx — Versiones lazy-loaded de los componentes de charts (R152uu).
 *
 * Recharts pesa ~80 kB gzipped. Cualquier página que importa DonutKPI o
 * Sparkline arrastra todo el bundle de recharts al first-load.
 *
 * Esta capa lo separa: las páginas que tienen MUCHOS charts (dashboards,
 * pero NO above-the-fold de páginas de transacción) importan desde acá
 * y reciben las versiones con next/dynamic + ssr:false + skeleton.
 *
 * Resultado: el shell de la página llega 80kB más liviano, los charts
 * se hidratan después con un loading state.
 *
 * Para charts críticos above-the-fold (ej. /dashboard hero), usar
 * imports directos desde "./DonutKPI" para que SSR los renderice.
 *
 * AnimatedNumber se mantiene síncrono — no importa recharts, es ligero.
 */
import dynamic from "next/dynamic";

// Skeleton para donut (rounded → circle)
const DonutSkeleton = ({ size = 140 }: { size?: number }) => (
  <div
    className="animate-pulse rounded-full bg-ink-100/40"
    style={{ width: size, height: size }}
    aria-label="Cargando gráfico"
  />
);

// Skeleton para sparkline (rectángulo bajo)
const SparkSkeleton = ({ height = 32 }: { height?: number }) => (
  <div
    className="animate-pulse rounded bg-ink-100/40"
    style={{ height, width: "100%" }}
    aria-label="Cargando gráfico"
  />
);

export const LazyDonutKPI = dynamic(
  () => import("./DonutKPI").then((m) => ({ default: m.DonutKPI })),
  {
    ssr: false,
    loading: () => <DonutSkeleton />,
  },
);

export const LazySparkline = dynamic(
  () => import("./Sparkline").then((m) => ({ default: m.Sparkline })),
  {
    ssr: false,
    loading: () => <SparkSkeleton />,
  },
);

export { AnimatedNumber } from "./AnimatedNumber"; // re-export, no es lazy (no usa recharts)
export { ChartCard } from "./ChartCard"; // re-export, no usa recharts directamente
