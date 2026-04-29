import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";

/**
 * Loading state mientras Next prefetch+streamea el resumen empresa.
 * Mantiene las dimensiones aproximadas para evitar layout shift al hidratarse.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Hero */}
      <Surface variant="glass">
        <div className="flex items-start gap-4">
          <Skeleton className="h-14 w-14 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-72" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
      </Surface>

      {/* 5 KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Surface key={i}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-8 w-32" />
            <Skeleton className="mt-2 h-3 w-40" />
          </Surface>
        ))}
      </div>

      {/* Composición */}
      <Surface padding="none">
        <div className="border-b border-hairline p-4">
          <Skeleton className="h-5 w-56" />
        </div>
        <div className="space-y-3 p-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </Surface>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Surface>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-4 h-64 w-full rounded-full" />
        </Surface>
        <Surface>
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-4 h-64 w-full rounded-xl" />
        </Surface>
      </div>
    </div>
  );
}
