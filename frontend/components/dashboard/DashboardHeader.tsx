"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { EmpresaFilter } from "./EmpresaFilter";
import { PeriodoFilter } from "./PeriodoFilter";
import { EtlStatusBadge } from "./EtlStatusBadge";
import { ScopeIndicator } from "@/components/shared/ScopeIndicator";
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
  const prefersReduced = useReducedMotion();

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
    <motion.header
      initial={prefersReduced ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "sticky top-0 z-30 -mx-6 lg:-mx-10 mb-6 overflow-hidden",
        "bg-white/75 backdrop-blur-2xl",
        "border-b border-hairline",
        "",
      )}
    >
      {/* Gradient mesh decoration — sólo visible muy sutil arriba */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-50"
        style={{
          backgroundImage:
            "radial-gradient(at 12% 0%, hsla(155, 60%, 35%, 0.10) 0px, transparent 40%), radial-gradient(at 88% 0%, hsla(43, 92%, 56%, 0.06) 0px, transparent 40%)",
        }}
      />
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-6 lg:px-10">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <h1 className="font-display text-xl font-semibold tracking-tight text-ink-900">
              Dashboard
            </h1>
            <p className="text-xs text-ink-500 tabular-nums">
              {periodoSubtitle(filters.from, filters.to)}
            </p>
          </div>
          <ScopeIndicator />
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
                "group inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-ink-700 ring-1 ring-hairline shadow-glass",
                "transition-all duration-200 ease-apple",
                "hover:bg-cehta-green/5 hover:ring-cehta-green/30 hover:text-cehta-green hover:scale-105 hover:shadow-glow-green",
                "active:scale-95",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                "disabled:opacity-60",
                "",
              )}
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4 transition-transform duration-300 ease-apple",
                  refreshing && "animate-spin",
                  !refreshing && "group-hover:rotate-180",
                )}
                strokeWidth={1.75}
              />
            </button>
          </SimpleTooltip>
        </div>
      </div>
    </motion.header>
  );
}
