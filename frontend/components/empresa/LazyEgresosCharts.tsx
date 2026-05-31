"use client";

/**
 * LazyEgresosCharts — wrappers client de EgresosTipoCard + EgresosProyectoSection
 * via next/dynamic. Reduce el bundle del page server `/empresa/[codigo]`
 * (era 396 kB porque recharts venía eager por estos 2 componentes).
 *
 * R152fff — lazy con ssr:false para que el server-render de la página NO
 * incluya recharts en el HTML. Los charts aparecen below-the-fold (después
 * del hero + KPIs), así que el delay de hidratación es invisible.
 */
import dynamic from "next/dynamic";
import type { EgresoTipoItem, EgresoProyectoItem } from "@/lib/api/schema";

const CardSkeleton = ({ h = 320 }: { h?: number }) => (
  <div
    className="animate-pulse rounded-2xl bg-ink-100/40 ring-1 ring-hairline"
    style={{ height: h }}
    aria-label="Cargando gráfico"
  />
);

export const LazyEgresosTipoCard = dynamic(
  () =>
    import("./EgresosTipoCard").then((m) => ({ default: m.EgresosTipoCard })),
  { ssr: false, loading: () => <CardSkeleton h={320} /> },
);

export const LazyEgresosProyectoSection = dynamic(
  () =>
    import("./EgresosProyectoSection").then((m) => ({
      default: m.EgresosProyectoSection,
    })),
  { ssr: false, loading: () => <CardSkeleton h={360} /> },
);

// Re-export types for parent consumption (sin importar el componente).
export type { EgresoTipoItem, EgresoProyectoItem };
