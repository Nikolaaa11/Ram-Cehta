import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state mientras Next.js hace SSR del Server Component.
 *
 * Aparece instantáneamente al click — el user ve la estructura final
 * sin layout shift. Cuando llegan los datos, React reemplaza con el
 * contenido real sin re-render del shell.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-80" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-36 rounded-lg" />
          <Skeleton className="h-8 w-44 rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-12 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,420px)]">
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border-b border-hairline p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="mt-1 h-3.5 w-3.5 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <Skeleton className="h-4 w-16 rounded-full" />
                  <Skeleton className="h-2 w-12" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
