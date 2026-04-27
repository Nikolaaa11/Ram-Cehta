import Link from "next/link";
import type { Route } from "next";
import { DatabaseZap } from "lucide-react";

export function DashboardEmptyState() {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ink-100/40">
        <DatabaseZap className="h-8 w-8 text-ink-300" strokeWidth={1.5} />
      </div>
      <h2 className="mt-6 font-display text-xl font-semibold tracking-tight text-ink-900">
        Aún no hay datos disponibles
      </h2>
      <p className="mt-2 max-w-md text-sm text-ink-500">
        El ETL todavía no ha corrido. Cuando se ejecute por primera vez, los
        datos del dashboard aparecerán aquí.
      </p>
      <Link
        href={"/admin/etl" as Route}
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline shadow-glass transition-colors duration-150 ease-apple hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
      >
        Ver estado del ETL
      </Link>
    </div>
  );
}
