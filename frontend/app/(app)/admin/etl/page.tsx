import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft } from "lucide-react";
import { EtlRunsTable } from "@/components/admin/EtlRunsTable";
import { RunEtlButton } from "@/components/admin/RunEtlButton";

export default function AdminEtlPage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href={"/admin" as Route}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            Panel admin
          </Link>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
            ETL Runs
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Histórico de cargas. Click en un run para ver el detalle y filas
            rechazadas.
          </p>
        </div>
        <RunEtlButton />
      </div>

      <EtlRunsTable />
    </div>
  );
}
