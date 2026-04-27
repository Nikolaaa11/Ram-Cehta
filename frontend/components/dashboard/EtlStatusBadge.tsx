"use client";

import { useMemo } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";
import { Database, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { toDateTime } from "@/lib/format";

interface EtlStatusBadgeProps {
  lastEtlRun: Date | string | null | undefined;
  status?: string | null;
}

/**
 * Badge de frescura del ETL. Conmuta entre:
 *  - null/never        → danger "ETL no ejecutado"
 *  - status=failed     → danger "ETL fallido"
 *  - status=stale      → warning "ETL desactualizado"
 *  - >6h ago           → warning
 *  - 1-6h ago          → neutral
 *  - <1h ago           → success con dot pulsante
 *
 * El frontend NO calcula nada del backend — solo renderiza tono+texto.
 */
export function EtlStatusBadge({ lastEtlRun, status }: EtlStatusBadgeProps) {
  const computed = useMemo(() => {
    if (!lastEtlRun) {
      return {
        variant: "danger" as const,
        text: "ETL no ejecutado",
        Icon: XCircle,
        pulse: false,
        tooltip: "El ETL nunca se ha ejecutado.",
      };
    }
    if (status === "failed") {
      return {
        variant: "danger" as const,
        text: "ETL fallido",
        Icon: XCircle,
        pulse: false,
        tooltip: `Última ejecución: ${toDateTime(lastEtlRun)}`,
      };
    }

    const date = typeof lastEtlRun === "string" ? new Date(lastEtlRun) : lastEtlRun;
    const ageMin = (Date.now() - date.getTime()) / 60_000;
    const relative = formatDistanceToNowStrict(date, { locale: es, addSuffix: false });

    if (status === "stale" || ageMin > 360) {
      return {
        variant: "warning" as const,
        text: `ETL hace ${relative}`,
        Icon: AlertTriangle,
        pulse: false,
        tooltip: `Última ejecución: ${toDateTime(lastEtlRun)}`,
      };
    }
    if (ageMin > 60) {
      return {
        variant: "neutral" as const,
        text: `ETL hace ${relative}`,
        Icon: Database,
        pulse: false,
        tooltip: `Última ejecución: ${toDateTime(lastEtlRun)}`,
      };
    }
    return {
      variant: "success" as const,
      text: `ETL hace ${relative}`,
      Icon: CheckCircle2,
      pulse: true,
      tooltip: `Última ejecución: ${toDateTime(lastEtlRun)}`,
    };
  }, [lastEtlRun, status]);

  return (
    <SimpleTooltip content={computed.tooltip}>
      <Badge variant={computed.variant} className="gap-1.5">
        {computed.pulse ? (
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-positive animate-pulse-dot" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
          </span>
        ) : (
          <computed.Icon className="h-3 w-3" strokeWidth={1.75} />
        )}
        <span className="tabular-nums">{computed.text}</span>
      </Badge>
    </SimpleTooltip>
  );
}
