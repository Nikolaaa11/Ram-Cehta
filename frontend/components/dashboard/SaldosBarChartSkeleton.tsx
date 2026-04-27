import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton del SaldosBarChart. Mantiene la altura para evitar layout shift.
 */
export function SaldosBarChartSkeleton() {
  const widths = [95, 78, 70, 62, 55, 48, 40, 32, 25];
  return (
    <Surface aria-busy="true" aria-label="Cargando saldos por empresa">
      <Surface.Header>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-2 h-4 w-72" />
      </Surface.Header>
      <Surface.Body className="mt-4 h-[300px] flex flex-col justify-around gap-2 py-2">
        {widths.map((w, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 rounded" style={{ width: `${w}%` }} />
          </div>
        ))}
      </Surface.Body>
    </Surface>
  );
}
