import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";

/**
 * Loading skeleton para detalle de ETL run.
 * Layout: status + timing + log lines.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <Surface>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-3">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-9 w-28 rounded-xl" />
        </div>
      </Surface>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Surface key={i}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-6 w-32" />
          </Surface>
        ))}
      </div>

      <Surface padding="none">
        <div className="border-b border-hairline p-4">
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="space-y-1.5 p-4 font-mono text-xs">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
            <Skeleton
              key={i}
              className="h-4 rounded"
              style={{ width: `${50 + ((i * 13) % 50)}%` }}
            />
          ))}
        </div>
      </Surface>
    </div>
  );
}
