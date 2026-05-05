"use client";

/**
 * VouchersKpiStrip — KPIs del módulo Vouchers para mostrar en el
 * dashboard principal o CEO Dashboard.
 *
 * Linkea a las páginas correspondientes para que click en el KPI
 * lleve directamente a la lista filtrada.
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Banknote,
  CheckCircle2,
  FileSignature,
  Send,
  Sparkles,
  Wallet,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { VouchersKpis } from "@/lib/api/schema";

const fmtCLP = (v: number) => {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v).toLocaleString("es-CL")}`;
};

export function VouchersKpiStrip() {
  const { session } = useSession();

  const { data } = useQuery<VouchersKpis>({
    queryKey: ["vouchers-kpis"],
    queryFn: () =>
      apiClient.get<VouchersKpis>("/dashboard/vouchers-kpis", session),
    enabled: !!session,
    refetchInterval: 60_000, // refresh cada minuto
  });

  if (!data) return null;

  const items: {
    label: string;
    value: string;
    sub?: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    href: string;
    tone: "ink" | "warning" | "negative" | "cehta" | "positive";
    badge?: string;
  }[] = [
    {
      label: "Pendientes firma",
      value: String(data.pendientes_firma),
      sub: data.pendientes_firma > 0 ? fmtCLP(data.pendientes_firma_monto) : undefined,
      icon: FileSignature,
      href: "/vouchers?status=PENDING",
      tone: data.pendientes_firma > 0 ? "warning" : "ink",
      badge: data.vouchers_reforzados_pendientes > 0
        ? `${data.vouchers_reforzados_pendientes} reforzado${data.vouchers_reforzados_pendientes > 1 ? "s" : ""}`
        : undefined,
    },
    {
      label: "Aprobados sin ejecutar",
      value: String(data.aprobados_sin_ejecutar),
      sub: "Listos para pagar",
      icon: Send,
      href: "/vouchers?status=APPROVED",
      tone: data.aprobados_sin_ejecutar > 0 ? "cehta" : "ink",
    },
    {
      label: "No conciliados",
      value: String(data.no_conciliados),
      sub: data.no_conciliados > 0 ? fmtCLP(data.no_conciliados_monto) : "Todo conciliado",
      icon: data.no_conciliados > 0 ? AlertCircle : CheckCircle2,
      href: "/admin/conciliacion",
      tone: data.no_conciliados > 0 ? "negative" : "positive",
    },
    {
      label: "Batches Nubox",
      value: String(data.batches_nubox_pendientes),
      sub: data.batches_nubox_pendientes > 0
        ? "Pendientes de cargar"
        : "Sin batches abiertos",
      icon: Wallet,
      href: "/admin/nubox-exports",
      tone: data.batches_nubox_pendientes > 0 ? "warning" : "ink",
    },
  ];

  const TONES = {
    ink: "border-hairline bg-white text-ink-900",
    warning: "border-warning/30 bg-warning/5 text-warning",
    negative: "border-negative/30 bg-negative/5 text-negative",
    cehta: "border-cehta-green/30 bg-cehta-green/5 text-cehta-green",
    positive: "border-positive/30 bg-positive/5 text-positive",
  } as const;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
          Vouchers contables · V5
        </p>
        {data.last_voucher_fecha && (
          <p className="text-[10px] text-ink-400">
            Último voucher:{" "}
            <span className="font-mono tabular-nums">
              {data.last_voucher_fecha}
            </span>
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href as any}
              className={`group rounded-2xl border ${TONES[item.tone]} p-4 transition-all duration-200 ease-apple hover:-translate-y-0.5 hover:shadow-card`}
            >
              <div className="flex items-start justify-between">
                <Icon
                  className="h-4 w-4 opacity-70"
                  strokeWidth={1.75}
                />
                {item.badge && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-yellow-800 ring-1 ring-yellow-200">
                    <Sparkles className="h-2.5 w-2.5" strokeWidth={2.5} />
                    {item.badge}
                  </span>
                )}
              </div>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                {item.label}
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
                {item.value}
              </p>
              {item.sub && (
                <p className="mt-0.5 text-[11px] text-ink-500">{item.sub}</p>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
