import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";

export function KpiHeroSkeleton() {
  return (
    <section
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      aria-hidden
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <Surface key={i} className="flex h-[160px] flex-col justify-between">
          <div className="flex items-start justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-8 rounded-xl" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-3 w-40" />
        </Surface>
      ))}
    </section>
  );
}
