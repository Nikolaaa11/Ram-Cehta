import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton del EgresosDonut. Mantiene el mismo layout flex (donut + leyenda).
 */
export function EgresosDonutSkeleton() {
  return (
    <Surface aria-busy="true" aria-label="Cargando egresos por concepto">
      <Surface.Header>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-2 h-4 w-56" />
      </Surface.Header>
      <Surface.Body className="mt-4 h-[300px] flex flex-row items-center gap-4">
        <div
          className="relative h-full flex-shrink-0 flex items-center justify-center"
          style={{ width: 240 }}
        >
          <div className="relative h-[220px] w-[220px]">
            <div className="absolute inset-0 rounded-full bg-ink-100/50 animate-pulse" />
            <div className="absolute inset-[28%] rounded-full bg-white" />
          </div>
        </div>
        <ul className="flex-1 min-w-0 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex items-center gap-2">
              <Skeleton className="h-2 w-2 rounded-full" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-12" />
            </li>
          ))}
        </ul>
      </Surface.Body>
    </Surface>
  );
}
