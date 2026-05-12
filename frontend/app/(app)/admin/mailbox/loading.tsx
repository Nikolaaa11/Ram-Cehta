import { Skeleton, SkeletonList } from "@/components/ui/skeleton";

/**
 * Loading state mientras Next.js hace SSR del Server Component.
 *
 * Aparece instantáneamente al click — el user ve la estructura final
 * sin layout shift. Cuando llegan los datos, React reemplaza con el
 * contenido real sin re-render del shell.
 *
 * V5++ ola CA: usa SkeletonList con shimmer Apple-style.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-6 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-80" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-9 w-36 rounded-lg" />
          <Skeleton className="h-9 w-44 rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-12 w-full rounded-2xl" />
      <SkeletonList items={6} />
    </div>
  );
}
