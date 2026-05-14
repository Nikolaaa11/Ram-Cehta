import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";

/**
 * Loading skeleton para detalle de voucher.
 * Layout: header con status + grid de campos + sección de aprobaciones + adjuntos.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <Surface>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-3">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28 rounded-xl" />
            <Skeleton className="h-9 w-28 rounded-xl" />
          </div>
        </div>
      </Surface>

      {/* Grid de campos */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Surface key={i}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-6 w-32" />
          </Surface>
        ))}
      </div>

      {/* Aprobaciones */}
      <Surface padding="none">
        <div className="border-b border-hairline p-4">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="space-y-3 p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-7 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </Surface>

      {/* Adjuntos */}
      <Surface padding="none">
        <div className="border-b border-hairline p-4">
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </Surface>
    </div>
  );
}
