import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-8 w-32 rounded-lg" />
      </div>
      <Skeleton className="h-14 w-full rounded-2xl" />
      <div className="rounded-2xl border border-hairline bg-white p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-hairline py-2 last:border-b-0"
          >
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="ml-auto h-3 w-20" />
            <Skeleton className="h-4 w-20 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
