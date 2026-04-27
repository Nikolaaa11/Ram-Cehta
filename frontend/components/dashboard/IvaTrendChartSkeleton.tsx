import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton del IvaTrendChart con grupos de 3 barras simulando el bar chart.
 */
export function IvaTrendChartSkeleton() {
  const heights = [70, 50, 60, 80, 55, 65, 90, 75, 60, 85, 70, 95];
  return (
    <Surface aria-busy="true" aria-label="Cargando IVA crédito vs débito">
      <Surface.Header>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-2 h-4 w-56" />
      </Surface.Header>
      <Surface.Body className="mt-4 h-[300px] flex flex-col">
        <div className="flex-1 flex items-end gap-3 px-2">
          {heights.map((h, i) => (
            <div
              key={i}
              className="flex-1 flex items-end gap-0.5"
              style={{ height: "100%" }}
            >
              <div
                className="flex-1 rounded-t bg-ink-100/60 animate-pulse"
                style={{ height: `${h * 0.85}%` }}
              />
              <div
                className="flex-1 rounded-t bg-ink-100/45 animate-pulse"
                style={{ height: `${h * 0.7}%` }}
              />
              <div
                className="flex-1 rounded-t bg-ink-100/30 animate-pulse"
                style={{ height: `${h * 0.5}%` }}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-center gap-4 pt-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-20" />
        </div>
      </Surface.Body>
    </Surface>
  );
}
