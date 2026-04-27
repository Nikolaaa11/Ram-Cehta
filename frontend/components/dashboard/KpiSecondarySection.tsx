"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, Landmark, Receipt, DatabaseZap } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { KpiCardSmall } from "./KpiCardSmall";
import { StaggerReveal } from "./StaggerReveal";
import { dashboardKeys, filtersToQueryString } from "@/lib/dashboard/queries";
import { useDashboardFilters } from "@/lib/dashboard/use-dashboard-filters";
import { toCLP, toRelative } from "@/lib/format";
import type { DashboardKPIs } from "@/lib/api/schema";

interface Props {
  initialData: DashboardKPIs;
}

// Ofset post-hero para que esta sección entre cuando la primera ya está casi.
const HERO_OFFSET_MS = 0.18;

export function KpiSecondarySection({ initialData }: Props) {
  const { session, loading } = useSession();
  const { filters } = useDashboardFilters();
  const qs = filtersToQueryString(filters);
  const query = useQuery<DashboardKPIs, Error>({
    queryKey: dashboardKeys.kpis(filters),
    queryFn: () => apiClient.get<DashboardKPIs>(`/dashboard/kpis${qs}`, session),
    enabled: !loading,
    initialData,
  });
  const data = query.data ?? initialData;

  const etlDot: "positive" | "negative" | "warning" | "neutral" =
    data.etl_status === "success"
      ? "positive"
      : data.etl_status === "failed"
        ? "negative"
        : data.etl_status === "stale"
          ? "warning"
          : "neutral";

  return (
    <section
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="Indicadores secundarios"
    >
      <StaggerReveal index={0} delay={0.06 + HERO_OFFSET_MS / 4}>
        <KpiCardSmall
          label="Saldo Cehta"
          value={toCLP(data.saldo_total_cehta)}
          icon={Building2}
        />
      </StaggerReveal>
      <StaggerReveal index={1} delay={0.06 + HERO_OFFSET_MS / 4}>
        <KpiCardSmall
          label="Saldo CORFO"
          value={toCLP(data.saldo_total_corfo)}
          icon={Landmark}
        />
      </StaggerReveal>
      <StaggerReveal index={2} delay={0.06 + HERO_OFFSET_MS / 4}>
        <KpiCardSmall
          label="IVA del mes"
          value={toCLP(data.iva_a_pagar_mes)}
          icon={Receipt}
        />
      </StaggerReveal>
      <StaggerReveal index={3} delay={0.06 + HERO_OFFSET_MS / 4}>
        <KpiCardSmall
          label="Última actualización"
          value={toRelative(data.ultimo_etl_run)}
          icon={DatabaseZap}
          dot={etlDot}
        />
      </StaggerReveal>
    </section>
  );
}
