import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton del CashflowChart con MISMA estructura visual:
 * Surface + Header (title+subtitle+tabs) + body 300px con shape de área-line.
 */
export function CashflowChartSkeleton() {
  return (
    <Surface aria-busy="true" aria-label="Cargando flujo de caja">
      <Surface.Header className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-44" />
        </div>
        <Skeleton className="h-7 w-44 rounded-xl" />
      </Surface.Header>
      <Surface.Body className="mt-4 h-[300px] relative overflow-hidden">
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 600 280"
          preserveAspectRatio="none"
          aria-hidden
          className="text-ink-100"
        >
          <defs>
            <linearGradient id="skel-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.6} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path
            d="M 0 200 L 50 180 L 100 190 L 150 150 L 200 160 L 250 120 L 300 140 L 350 100 L 400 110 L 450 80 L 500 90 L 550 60 L 600 70 L 600 280 L 0 280 Z"
            fill="url(#skel-grad)"
            className="animate-pulse"
          />
          <path
            d="M 0 200 L 50 180 L 100 190 L 150 150 L 200 160 L 250 120 L 300 140 L 350 100 L 400 110 L 450 80 L 500 90 L 550 60 L 600 70"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeOpacity={0.4}
            className="animate-pulse"
          />
        </svg>
      </Surface.Body>
    </Surface>
  );
}
