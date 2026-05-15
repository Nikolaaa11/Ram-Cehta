"use client";

/**
 * VoucherAnomaliesCard — Etapa H
 *
 * Llama GET /vouchers/{id}/anomaly-check y muestra warnings con
 * severity HIGH/MED/LOW. Solo se renderiza si hay >= 1 warning para
 * no agregar ruido a vouchers limpios.
 *
 * Si todos los warnings son LOW, el card se renderiza colapsado.
 * HIGH severity expande el card automaticamente.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Sparkles,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { Surface } from "@/components/ui/surface";

interface Warning {
  code: string;
  severity: "HIGH" | "MED" | "LOW";
  title: string;
  detail: string;
  metric?: Record<string, unknown> | null;
}

interface AnomalyReport {
  voucher_id: number;
  codigo: string;
  score: number;
  warnings: Warning[];
  checked_at: string;
}

const SEVERITY_META = {
  HIGH: {
    icon: AlertCircle,
    bg: "bg-red-50",
    text: "text-red-700",
    ring: "ring-red-200",
    label: "Crítico",
  },
  MED: {
    icon: AlertTriangle,
    bg: "bg-amber-50",
    text: "text-amber-700",
    ring: "ring-amber-200",
    label: "Revisar",
  },
  LOW: {
    icon: Info,
    bg: "bg-ink-50",
    text: "text-ink-600",
    ring: "ring-ink-200",
    label: "Sugerencia",
  },
} as const;

export function VoucherAnomaliesCard({ voucherId }: { voucherId: number }) {
  const { session } = useSession();
  const { data, isLoading } = useQuery<AnomalyReport>({
    queryKey: ["voucher-anomalies", voucherId],
    queryFn: () =>
      apiClient.get<AnomalyReport>(
        `/vouchers/${voucherId}/anomaly-check`,
        session,
      ),
    enabled: !!session && !!voucherId,
    staleTime: 60_000,
  });

  const hasHigh = data?.warnings.some((w) => w.severity === "HIGH") ?? false;
  const [expanded, setExpanded] = useState(false);

  // Si no hay datos cargados o no hay warnings, no mostrar el card.
  if (isLoading) return null;
  if (!data || data.warnings.length === 0) return null;

  const isExpanded = expanded || hasHigh;

  return (
    <Surface
      className={`p-5 ${
        hasHigh
          ? "border-red-200 bg-red-50/30"
          : data.warnings.some((w) => w.severity === "MED")
            ? "border-amber-200 bg-amber-50/30"
            : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <div
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
              hasHigh
                ? "bg-red-100 text-red-600"
                : "bg-amber-100 text-amber-600"
            }`}
          >
            <Sparkles className="size-3.5" strokeWidth={2} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink-900">
              Análisis de anomalías
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium ring-1 ring-hairline">
                Score{" "}
                <span
                  className={
                    data.score >= 50
                      ? "text-red-600"
                      : data.score >= 20
                        ? "text-amber-600"
                        : "text-ink-500"
                  }
                >
                  {data.score}/100
                </span>
              </span>
            </h3>
            <p className="text-[10px] text-ink-500 mt-0.5">
              {data.warnings.length} aviso
              {data.warnings.length === 1 ? "" : "s"} detectado
              {data.warnings.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="size-4 text-ink-400" />
        ) : (
          <ChevronDown className="size-4 text-ink-400" />
        )}
      </button>

      {isExpanded && (
        <ul className="mt-4 space-y-2">
          {data.warnings.map((w, idx) => {
            const meta = SEVERITY_META[w.severity];
            const Icon = meta.icon;
            return (
              <li
                key={`${w.code}-${idx}`}
                className={`rounded-xl border p-3 ${meta.bg} ${meta.ring} border-transparent`}
              >
                <div className="flex items-start gap-2">
                  <Icon
                    className={`mt-0.5 size-4 shrink-0 ${meta.text}`}
                    strokeWidth={2}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[9px] font-semibold uppercase tracking-[0.14em] ${meta.text}`}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[9px] text-ink-400 font-mono">
                        {w.code}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-ink-900">
                      {w.title}
                    </p>
                    <p className="mt-1 text-xs leading-snug text-ink-700">
                      {w.detail}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!isExpanded && (
        <p className="mt-2 text-[11px] text-ink-500">
          {hasHigh
            ? "⚠ Hay avisos críticos — click para revisar"
            : "Click para revisar los avisos"}
        </p>
      )}
    </Surface>
  );
}
