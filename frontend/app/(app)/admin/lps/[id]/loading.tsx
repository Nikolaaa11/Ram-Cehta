import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";

/**
 * Loading skeleton para detalle de LP (Limited Partner).
 * Layout: hero del LP + KPIs + secciones de actividad/comunicaciones.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <Surface variant="glass">
        <div className="flex items-start gap-4">
          <Skeleton className="h-14 w-14 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-44" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28 rounded-xl" />
            <Skeleton className="h-9 w-28 rounded-xl" />
          </div>
        </div>
      </Surface>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Surface key={i}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-28" />
            <Skeleton className="mt-1 h-3 w-32" />
          </Surface>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Surface padding="none">
          <div className="border-b border-hairline p-4">
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-xl" />
            ))}
          </div>
        </Surface>
        <Surface padding="none">
          <div className="border-b border-hairline p-4">
            <Skeleton className="h-5 w-36" />
          </div>
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-xl" />
            ))}
          </div>
        </Surface>
      </div>
    </div>
  );
}
