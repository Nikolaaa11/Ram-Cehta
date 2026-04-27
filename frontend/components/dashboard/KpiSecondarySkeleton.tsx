import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";

export function KpiSecondarySkeleton() {
  return (
    <section
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      aria-hidden
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <Surface
          key={i}
          padding="compact"
          className="flex h-[88px] items-center gap-3"
        >
          <Skeleton className="h-9 w-9 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-24" />
          </div>
        </Surface>
      ))}
    </section>
  );
}
