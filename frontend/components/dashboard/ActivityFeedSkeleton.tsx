import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton de `ActivityFeed`. 8 rows con dot + dos líneas de texto + monto.
 */
export function ActivityFeedSkeleton() {
  return (
    <Surface>
      <Surface.Header divider>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-1 h-3.5 w-52" />
      </Surface.Header>
      <Surface.Body>
        <ul className="space-y-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <li key={i} className="flex items-start gap-3">
              <Skeleton className="mt-1.5 h-2 w-2 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-4 w-20 shrink-0" />
            </li>
          ))}
        </ul>
      </Surface.Body>
    </Surface>
  );
}
