"use client";

import { motion } from "framer-motion";
import { Wallet, TrendingUp, FileText, Calendar } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { KpiCard } from "./KpiCard";
import { dashboardKeys, filtersToQueryString } from "@/lib/dashboard/queries";
import { useDashboardFilters } from "@/lib/dashboard/use-dashboard-filters";
import { toCLP, toPct } from "@/lib/format";
import type { DashboardKPIs } from "@/lib/api/schema";

interface Props {
  initialData: DashboardKPIs;
}

const container = {
  show: {
    transition: { staggerChildren: 0.06 },
  },
};

const item = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
  },
};

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

  // egreso_delta_pct viene como número con signo desde backend.
  // Lo presentamos como `toPct(value, {signed:true})`.
  // La direction debe entender: para flujo neto, "up" = mejor.
  // Acá usamos egreso_delta_pct como métrica acompañante: backend ya lo entrega
  // con su signo, pero la *dirección semántica* del flujo neto la tomamos del
  // valor del flujo, no del delta de egresos. Mostramos abono_delta_pct como
  // contexto secundario.

  return (
    <motion.section
      variants={container}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="Indicadores principales"
    >
      <motion.div variants={item}>
        <KpiCard
          label="Saldo consolidado"
          value={toCLP(data.saldo_total_consolidado)}
          icon={Wallet}
          tone="default"
        />
      </motion.div>

      <motion.div variants={item}>
        <KpiCard
          label="Flujo neto del mes"
          value={toCLP(data.flujo_neto_mes)}
          icon={TrendingUp}
          tone={flujoDir === "up" ? "positive" : flujoDir === "down" ? "negative" : "default"}
          delta={{
            value: toPct(data.abono_delta_pct, { signed: true }),
            label: "abonos vs. mes anterior",
            direction: data.abono_delta_pct > 0 ? "up" : data.abono_delta_pct < 0 ? "down" : "flat",
          }}
        />
      </motion.div>

      <motion.div variants={item}>
        <KpiCard
          label="OCs pendientes"
          value={String(data.oc_emitidas_pendientes)}
          subtitle={toCLP(data.monto_oc_pendiente)}
          icon={FileText}
          href="/ordenes-compra"
          tone="default"
        />
      </motion.div>

      <motion.div variants={item}>
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
      </motion.div>
    </motion.section>
  );
}
