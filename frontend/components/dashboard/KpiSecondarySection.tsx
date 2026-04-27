"use client";

import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Building2, Landmark, Receipt, DatabaseZap } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { KpiCardSmall } from "./KpiCardSmall";
import { dashboardKeys, filtersToQueryString } from "@/lib/dashboard/queries";
import { useDashboardFilters } from "@/lib/dashboard/use-dashboard-filters";
import { toCLP, toRelative } from "@/lib/format";
import type { DashboardKPIs } from "@/lib/api/schema";

interface Props {
  initialData: DashboardKPIs;
}

const container = {
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.18 },
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
    <motion.section
      variants={container}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="Indicadores secundarios"
    >
      <motion.div variants={item}>
        <KpiCardSmall
          label="Saldo Cehta"
          value={toCLP(data.saldo_total_cehta)}
          icon={Building2}
        />
      </motion.div>
      <motion.div variants={item}>
        <KpiCardSmall
          label="Saldo CORFO"
          value={toCLP(data.saldo_total_corfo)}
          icon={Landmark}
        />
      </motion.div>
      <motion.div variants={item}>
        <KpiCardSmall
          label="IVA del mes"
          value={toCLP(data.iva_a_pagar_mes)}
          icon={Receipt}
        />
      </motion.div>
      <motion.div variants={item}>
        <KpiCardSmall
          label="Última actualización"
          value={toRelative(data.ultimo_etl_run)}
          icon={DatabaseZap}
          dot={etlDot}
        />
      </motion.div>
    </motion.section>
  );
}
