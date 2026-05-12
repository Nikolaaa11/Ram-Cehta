import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-6 lg:px-10">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <SkeletonTable rows={9} columns={5} />
    </div>
  );
}
