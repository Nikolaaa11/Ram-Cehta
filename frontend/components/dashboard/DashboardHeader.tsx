"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { EmpresaFilter } from "./EmpresaFilter";
import { PeriodoFilter } from "./PeriodoFilter";
import { EtlStatusBadge } from "./EtlStatusBadge";
import { dashboardKeys } from "@/lib/dashboard/queries";
import { useDashboardFilters } from "@/lib/dashboard/use-dashboard-filters";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface DashboardHeaderProps {
  lastEtlRun: string | null;
  etlStatus?: string | null;
}

function periodoSubtitle(from: string | null, to: string | null): string {
  if (!from && !to) return "Últimos 12 meses";
  if (from && to) return `${from} → ${to}`;
  return from ?? to ?? "";
}

export function DashboardHeader({ lastEtlRun, etlStatus }: DashboardHeaderProps) {
  const queryClient = useQueryClient();
  const { filters } = useDashboardFilters();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    } finally {
      // breve delay para feedback visual de la animación
      setTimeout(() => setRefreshing(false), 400);
    }
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-30 -mx-6 lg:-mx-10 mb-6",
        "bg-white/70 backdrop-blur-xl",
        "border-b border-hairline",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-6 lg:px-10">
        <div className="flex flex-col">
          <h1 className="font-display text-xl font-semibold tracking-tight text-ink-900">
            Dashboard
          </h1>
          <p className="text-xs text-ink-500">{periodoSubtitle(filters.from, filters.to)}</p>
        </div>
        <div className="flex items-center gap-2">
          <EmpresaFilter />
          <PeriodoFilter />
          <EtlStatusBadge lastEtlRun={lastEtlRun} status={etlStatus ?? undefined} />
          <SimpleTooltip content="Refrescar datos">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refrescar datos"
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-ink-700 ring-1 ring-hairline shadow-glass",
                "transition-colors duration-150 ease-apple hover:bg-surface-muted",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                "disabled:opacity-60",
              )}
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
                strokeWidth={1.5}
              />
            </button>
          </SimpleTooltip>
        </div>
      </div>
    </header>
  );
}
