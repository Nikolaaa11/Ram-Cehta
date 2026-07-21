"use client";

/**
 * LazyComparativoChart — wrapper client de ComparativoChart via next/dynamic.
 *
 * MEGAPROMPT PERF: /ceo importaba ComparativoChart (recharts) eager en el
 * server component → recharts entero (~100-120 kB gz) en el First Load del
 * dashboard CEO. Mismo patrón que LazyEgresosCharts (R152fff): ssr:false +
 * skeleton — el chart está below-the-fold, la hidratación tardía es invisible.
 */
import dynamic from "next/dynamic";

const ChartSkeleton = () => (
  <div
    className="animate-pulse rounded-2xl bg-ink-100/40 ring-1 ring-hairline"
    style={{ height: 360 }}
    aria-label="Cargando gráfico comparativo"
  />
);

export const LazyComparativoChart = dynamic(
  () =>
    import("./ComparativoChart").then((m) => ({
      default: m.ComparativoChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> },
);
