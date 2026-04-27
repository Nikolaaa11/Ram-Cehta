import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton de `ProyectosRanking` — match exacto de la grilla del componente
 * real para que no haya layout shift cuando llegue la data.
 */
export function ProyectosRankingSkeleton() {
  return (
    <Surface>
      <Surface.Header divider>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-1 h-3.5 w-48" />
      </Surface.Header>
      <Surface.Body>
        <div className="space-y-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="grid grid-cols-[24px_1fr_auto] items-center gap-3"
            >
              <Skeleton className="h-6 w-6 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-1.5 w-full" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </Surface.Body>
    </Surface>
  );
}
