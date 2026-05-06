import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
          <div className="border-b border-hairline bg-ink-50/60 px-3 py-2">
            <Skeleton className="h-3 w-32" />
          </div>
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-hairline px-3 py-2"
            >
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-5 w-20 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
