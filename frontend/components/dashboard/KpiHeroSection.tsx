"use client";

import { Wallet, TrendingUp, FileText, Calendar } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { KpiCard } from "./KpiCard";
import { StaggerReveal } from "./StaggerReveal";
import { dashboardKeys, filtersToQueryString } from "@/lib/dashboard/queries";
import { useDashboardFilters } from "@/lib/dashboard/use-dashboard-filters";
import { toCLP, toPct } from "@/lib/format";
import type { DashboardKPIs } from "@/lib/api/schema";

interface Props {
  initialData: DashboardKPIs;
}

export function KpiHeroSection({ initialData }: Props) {
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

  const flujoNeto = Number(data.flujo_neto_mes);
  const flujoDir: "up" | "down" | "flat" =
    flujoNeto > 0 ? "up" : flujoNeto < 0 ? "down" : "flat";

  // F29 tone: si hay vencidas → danger; si solo hay próximas → warning; sino default.
  const f29Tone =
    data.f29_vencidas > 0
      ? "negative"
      : data.f29_proximas_30d > 0
        ? "warning"
        : "default";

  return (
    <section
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="Indicadores principales"
    >
      <StaggerReveal index={0}>
        <KpiCard
          label="Saldo consolidado"
          value={toCLP(data.saldo_total_consolidado)}
          icon={Wallet}
          tone="default"
        />
      </StaggerReveal>

      <StaggerReveal index={1}>
        <KpiCard
          label="Flujo neto del mes"
          value={toCLP(data.flujo_neto_mes)}
          icon={TrendingUp}
          tone={
            flujoDir === "up"
              ? "positive"
              : flujoDir === "down"
                ? "negative"
                : "default"
          }
          delta={{
            value: toPct(data.abono_delta_pct, { signed: true }),
            label: "abonos vs. mes anterior",
            direction:
              data.abono_delta_pct > 0
                ? "up"
                : data.abono_delta_pct < 0
                  ? "down"
                  : "flat",
          }}
        />
      </StaggerReveal>

      <StaggerReveal index={2}>
        <KpiCard
          label="OCs pendientes"
          value={String(data.oc_emitidas_pendientes)}
          subtitle={toCLP(data.monto_oc_pendiente)}
          icon={FileText}
          href="/ordenes-compra"
          tone="default"
        />
      </StaggerReveal>

      <StaggerReveal index={3}>
        <KpiCard
          label="F29 próximas"
          value={String(data.f29_proximas_30d)}
          subtitle={
            data.f29_vencidas > 0
              ? `${data.f29_vencidas} vencidas`
              : "próximos 30 días"
          }
          icon={Calendar}
          href="/f29"
          tone={f29Tone}
        />
      </StaggerReveal>
    </section>
  );
}
