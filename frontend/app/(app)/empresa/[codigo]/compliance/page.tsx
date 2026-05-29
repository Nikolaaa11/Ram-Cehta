"use client";

/**
 * /empresa/[codigo]/compliance — Round 152d
 *
 * Status de compliance (OPIM, CMF, UAF, CORFO, ICMA) por empresa.
 */
import { use, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, AlertCircle, Clock, XCircle, Circle } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface ComplianceItem {
  framework: string;
  principle_or_item: string;
  status: string;
  last_review_date: string | null;
  next_review_date: string | null;
  notes: string | null;
}

type StatusCfg = { label: string; color: string; bg: string; icon: typeof CheckCircle2 };
const STATUS_CONFIG: Record<string, StatusCfg> = {
  compliant: {
    label: "Cumple",
    color: "text-emerald-700",
    bg: "bg-emerald-50 border-emerald-200",
    icon: CheckCircle2,
  },
  in_progress: {
    label: "En Proceso",
    color: "text-amber-700",
    bg: "bg-amber-50 border-amber-200",
    icon: Clock,
  },
  non_compliant: {
    label: "No Cumple",
    color: "text-red-700",
    bg: "bg-red-50 border-red-200",
    icon: XCircle,
  },
  pending: {
    label: "Pendiente",
    color: "text-blue-700",
    bg: "bg-blue-50 border-blue-200",
    icon: AlertCircle,
  },
  N_A: {
    label: "N/A",
    color: "text-ink-500",
    bg: "bg-ink-50 border-hairline",
    icon: Circle,
  },
};

// Fallback tipado fuerte (evita undefined bajo noUncheckedIndexedAccess).
const FALLBACK_CFG: StatusCfg = {
  label: "N/A",
  color: "text-ink-500",
  bg: "bg-ink-50 border-hairline",
  icon: Circle,
};

export default function CompliancePage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = use(params);
  const { session } = useSession();

  const { data, isLoading, error } = useQuery<{ items: ComplianceItem[] }>({
    queryKey: ["empresa", codigo, "compliance"],
    queryFn: () =>
      apiClient.get<{ items: ComplianceItem[] }>(
        `/empresa/${encodeURIComponent(codigo)}/compliance`,
        session,
      ),
    enabled: !!session,
  });

  const byFramework = useMemo(() => {
    const items = data?.items ?? [];
    const map = new Map<string, ComplianceItem[]>();
    for (const it of items) {
      const arr = map.get(it.framework) ?? [];
      arr.push(it);
      map.set(it.framework, arr);
    }
    return Array.from(map.entries());
  }, [data]);

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/50 p-6 text-sm text-red-900">
        <p className="font-semibold">No se pudo cargar Compliance</p>
        <p className="mt-1 text-xs text-red-700">
          {error instanceof Error ? error.message : "Error desconocido"}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return <p className="py-12 text-center text-sm text-ink-400">Cargando compliance…</p>;
  }

  if ((data?.items?.length ?? 0) === 0) {
    return (
      <div className="rounded-2xl border border-hairline bg-white p-12 text-center shadow-card">
        <p className="text-sm font-medium text-ink-700">Sin checks de compliance</p>
        <p className="mt-1 text-xs text-ink-500">
          Esta empresa no tiene items de compliance registrados aún.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {byFramework.map(([framework, items]) => (
        <section
          key={framework}
          className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card"
        >
          <header className="border-b border-hairline px-6 py-4">
            <h3 className="text-base font-semibold text-ink-900">{framework}</h3>
            <p className="mt-0.5 text-xs text-ink-500">
              {items.length} items · {items.filter((i) => i.status === "compliant").length}{" "}
              cumpliendo
            </p>
          </header>
          <ul className="divide-y divide-hairline">
            {items.map((it, i) => {
              const cfg = STATUS_CONFIG[it.status] ?? FALLBACK_CFG;
              const Icon = cfg.icon;
              return (
                <li key={i} className="px-6 py-4 hover:bg-ink-50/40">
                  <div className="flex items-start gap-3">
                    <Icon className={`size-5 shrink-0 ${cfg.color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-ink-900">
                          {it.principle_or_item}
                        </p>
                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.bg} ${cfg.color}`}
                        >
                          {cfg.label}
                        </span>
                      </div>
                      {it.notes && (
                        <p className="mt-1 text-xs text-ink-600">{it.notes}</p>
                      )}
                      <div className="mt-1.5 flex gap-4 text-[11px] text-ink-500">
                        {it.last_review_date && (
                          <span>Última revisión: {it.last_review_date}</span>
                        )}
                        {it.next_review_date && (
                          <span>Próxima: {it.next_review_date}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
