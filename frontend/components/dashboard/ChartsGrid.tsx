"use client";

import dynamic from "next/dynamic";
import { CashflowChartSkeleton } from "./CashflowChartSkeleton";
import { EgresosDonutSkeleton } from "./EgresosDonutSkeleton";
import { SaldosBarChartSkeleton } from "./SaldosBarChartSkeleton";
import { IvaTrendChartSkeleton } from "./IvaTrendChartSkeleton";

/**
 * Wrapper client-only para charts. Aquí podemos usar `dynamic({ ssr: false })`
 * — restringido a Client Components en Next 15 — y mantener la página
 * `app/(app)/dashboard/page.tsx` como Server Component (necesario para SSR
 * de los KPIs vía `serverApiGet`).
 *
 * El layout `grid-cols-12 gap-6` con split 7/5 en lg es responsive: en mobile
 * los 4 charts apilan vertical (col-span-12).
 */

const CashflowChart = dynamic(
  () =>
    import("./CashflowChart").then((m) => m.CashflowChart),
  { ssr: false, loading: () => <CashflowChartSkeleton /> },
);

const EgresosDonut = dynamic(
  () => import("./EgresosDonut").then((m) => m.EgresosDonut),
  { ssr: false, loading: () => <EgresosDonutSkeleton /> },
);

const SaldosBarChart = dynamic(
  () => import("./SaldosBarChart").then((m) => m.SaldosBarChart),
  { ssr: false, loading: () => <SaldosBarChartSkeleton /> },
);

const IvaTrendChart = dynamic(
  () => import("./IvaTrendChart").then((m) => m.IvaTrendChart),
  { ssr: false, loading: () => <IvaTrendChartSkeleton /> },
);

export function ChartsGrid() {
  return (
    <>
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-7">
          <CashflowChart />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <EgresosDonut />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-7">
          <SaldosBarChart />
        </div>
        <div className="col-span-12 lg:col-span-5">
          <IvaTrendChart />
        </div>
      </div>
    </>
  );
}
