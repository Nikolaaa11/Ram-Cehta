/**
 * loading.tsx — skeleton del dashboard mientras el server fetch
 * de `/dashboard/kpis` resuelve (R152ggg).
 *
 * Next.js usa este componente automáticamente como fallback de Suspense
 * para todo el segment del dashboard. Resultado: el usuario ve algo
 * inmediato en lugar de pantalla en blanco.
 *
 * El skeleton replica la estructura visual del dashboard real:
 * header + 2-col widget grid + KPIs hero + KPIs secundarios.
 */
export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-[1440px] px-3 sm:px-6 lg:px-10 py-4 sm:py-6">
      {/* Header skeleton */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-64 animate-pulse rounded-lg bg-ink-100/60" />
          <div className="h-4 w-48 animate-pulse rounded bg-ink-100/40" />
        </div>
        <div className="h-10 w-32 animate-pulse rounded-xl bg-ink-100/60" />
      </div>

      {/* Widget grid 2-col en lg (Mi día + Pipeline) */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-12">
        <div className="h-48 animate-pulse rounded-2xl bg-ink-100/40 lg:col-span-7" />
        <div className="h-48 animate-pulse rounded-2xl bg-ink-100/40 lg:col-span-5" />
      </div>

      {/* KPI Hero — 4 cards grandes */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-2xl bg-ink-100/40 ring-1 ring-hairline"
          />
        ))}
      </div>

      {/* KPI Secondary — 4 cards más pequeñas */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl bg-ink-100/40 ring-1 ring-hairline"
          />
        ))}
      </div>

      {/* Chart grid below */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-72 animate-pulse rounded-2xl bg-ink-100/40 ring-1 ring-hairline"
          />
        ))}
      </div>
    </div>
  );
}
