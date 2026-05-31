"use client";

/**
 * TransferenciasSkeleton — R152ii
 *
 * Skeleton que reproduce la estructura visual real de /transferencias:
 *   - 4 KPI cards
 *   - chips por empresa
 *   - tabla con header + 6 rows con columnas (checkbox, código, empresa,
 *     fecha, proveedor, glosa, monto, datos bancarios, wa)
 *
 * Reemplaza al spinner simple. Apple-style shimmer (no spinner).
 */
import { Surface } from "@/components/ui/surface";

function Bar({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-gradient-to-r from-ink-100 via-ink-200/70 to-ink-100 bg-[length:200%_100%] ${className}`}
      style={{
        animation: "tx-shimmer 1.6s linear infinite",
      }}
    />
  );
}

export function TransferenciasSkeleton() {
  return (
    <>
      {/* Inline keyframes — el global stylesheet no tiene tx-shimmer aún
          y queremos que este skeleton sea drop-in sin tocar tailwind.config. */}
      <style jsx>{`
        @keyframes tx-shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
      `}</style>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Surface key={i} padding="none" className="overflow-hidden">
            <div className="p-4 space-y-2.5">
              <div className="flex items-center gap-2">
                <Bar className="size-7 rounded-lg" />
                <Bar className="h-2.5 w-24" />
              </div>
              <Bar className="h-7 w-32" />
              <Bar className="h-2 w-28" />
            </div>
          </Surface>
        ))}
      </div>

      {/* Chips empresa */}
      <div className="flex flex-wrap gap-2">
        <Bar className="h-7 w-20 rounded-full" />
        <Bar className="h-7 w-28 rounded-full" />
        <Bar className="h-7 w-24 rounded-full" />
        <Bar className="h-7 w-32 rounded-full" />
      </div>

      {/* Tabla */}
      <Surface padding="none" className="overflow-hidden">
        {/* Header */}
        <div className="border-b border-hairline bg-ink-50/70 px-4 py-3 grid grid-cols-[24px_90px_70px_80px_1fr_1.4fr_110px_110px_60px] gap-3 items-center">
          <Bar className="h-3 w-3 rounded-sm" />
          <Bar className="h-2.5 w-12" />
          <Bar className="h-2.5 w-12" />
          <Bar className="h-2.5 w-10" />
          <Bar className="h-2.5 w-16" />
          <Bar className="h-2.5 w-10" />
          <Bar className="h-2.5 w-12 justify-self-end" />
          <Bar className="h-2.5 w-20" />
          <Bar className="h-2.5 w-6 justify-self-center" />
        </div>
        {/* Rows */}
        <div className="divide-y divide-hairline">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="px-4 py-3.5 grid grid-cols-[24px_90px_70px_80px_1fr_1.4fr_110px_110px_60px] gap-3 items-center"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <Bar className="h-3.5 w-3.5 rounded-sm" />
              <Bar className="h-3 w-16" />
              <Bar className="h-5 w-14 rounded" />
              <Bar className="h-3 w-16" />
              <div className="space-y-1.5">
                <Bar className="h-3 w-36" />
                <Bar className="h-2 w-24" />
              </div>
              <Bar className="h-3 w-full max-w-[260px]" />
              <Bar className="h-3.5 w-20 justify-self-end" />
              <Bar className="h-5 w-20 rounded-full" />
              <Bar className="h-5 w-14 rounded-md justify-self-center" />
            </div>
          ))}
        </div>
      </Surface>
    </>
  );
}
