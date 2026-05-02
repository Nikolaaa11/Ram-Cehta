"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Award,
  Building2,
  ClipboardCheck,
  DatabaseZap,
  Landmark,
  Receipt,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { KpiCardSmall } from "./KpiCardSmall";
import { StaggerReveal } from "./StaggerReveal";
import { dashboardKeys, filtersToQueryString } from "@/lib/dashboard/queries";
import { useDashboardFilters } from "@/lib/dashboard/use-dashboard-filters";
import { toCLPCompact, toRelative } from "@/lib/format";
import {
  useComplianceGradeReport,
  useCriticalCount,
  useEntregablesCounts,
} from "@/hooks/use-entregables";
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

  // V4 fase 7.13 — Cross-data: compliance + entregables
  const { data: criticalCount } = useCriticalCount();
  const { data: entregablesCounts } = useEntregablesCounts();
  const { data: complianceReport } = useComplianceGradeReport();

  const etlDot: "positive" | "negative" | "warning" | "neutral" =
    data.etl_status === "success"
      ? "positive"
      : data.etl_status === "failed"
        ? "negative"
        : data.etl_status === "stale"
          ? "warning"
          : "neutral";

  // Compliance promedio + tone
  const promedioCompliance = complianceReport?.promedio_cumplimiento ?? 0;
  const complianceTone: "positive" | "warning" | "negative" | "default" =
    promedioCompliance >= 95
      ? "positive"
      : promedioCompliance >= 85
        ? "default"
        : promedioCompliance >= 70
          ? "warning"
          : "negative";
  const complianceLabel = complianceReport
    ? `${complianceReport.empresas.length} empresas`
    : undefined;

  // Entregables tone basado en críticos
  const criticosTotal = criticalCount?.critical ?? 0;
  const entregablesTone =
    criticosTotal > 0 ? "negative" : "default";
  const entregablesPendientes =
    (entregablesCounts?.pendiente ?? 0) +
    (entregablesCounts?.en_proceso ?? 0);

  return (
    <section
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6"
      aria-label="Indicadores secundarios"
    >
      <StaggerReveal index={0} delay={0.06 + HERO_OFFSET_MS / 4}>
        <KpiCardSmall
          label="Saldo Cehta"
          value={toCLPCompact(data.saldo_total_cehta)}
          icon={Building2}
        />
      </StaggerReveal>
      <StaggerReveal index={1} delay={0.06 + HERO_OFFSET_MS / 4}>
        <KpiCardSmall
          label="Saldo CORFO"
          value={toCLPCompact(data.saldo_total_corfo)}
          icon={Landmark}
        />
      </StaggerReveal>
      <StaggerReveal index={2} delay={0.06 + HERO_OFFSET_MS / 4}>
        <KpiCardSmall
          label="IVA del mes"
          value={toCLPCompact(data.iva_a_pagar_mes)}
          icon={Receipt}
        />
      </StaggerReveal>
      <StaggerReveal index={3} delay={0.06 + HERO_OFFSET_MS / 4}>
        <KpiCardSmall
          label="Compliance"
          value={`${promedioCompliance.toFixed(1)}%`}
          subtitle={complianceLabel ?? "promedio portfolio"}
          icon={Award}
          tone={complianceTone}
          href="/compliance"
          dot={
            complianceTone === "positive"
              ? "positive"
              : complianceTone === "warning"
                ? "warning"
                : complianceTone === "negative"
                  ? "negative"
                  : undefined
          }
        />
      </StaggerReveal>
      <StaggerReveal index={4} delay={0.06 + HERO_OFFSET_MS / 4}>
        <KpiCardSmall
          label="Entregables"
          value={String(entregablesPendientes)}
          subtitle={
            criticosTotal > 0
              ? `⚠ ${criticosTotal} crítico${criticosTotal !== 1 ? "s" : ""}`
              : "pendientes activos"
          }
          icon={ClipboardCheck}
          tone={entregablesTone}
          href="/entregables"
          dot={criticosTotal > 0 ? "negative" : "neutral"}
        />
      </StaggerReveal>
      <StaggerReveal index={5} delay={0.06 + HERO_OFFSET_MS / 4}>
        <KpiCardSmall
          label="Última actualización"
          value={toRelative(data.ultimo_etl_run)}
          subtitle={`ETL · ${data.etl_status}`}
          icon={DatabaseZap}
          dot={etlDot}
        />
      </StaggerReveal>
    </section>
  );
}
