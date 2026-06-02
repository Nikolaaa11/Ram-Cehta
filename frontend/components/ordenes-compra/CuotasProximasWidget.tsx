"use client";

/**
 * R152DDDD · Widget de cuotas próximas a vencer.
 *
 * Lista las cuotas con vencimiento próximo + flag de vencidas en rojo.
 * Pensado para embeber en /action-center, /dashboard, o cualquier
 * página donde queramos surfacing del trabajo pendiente.
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Route } from "next";
import { Calendar, AlertCircle, FileText } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { Skeleton } from "@/components/ui/skeleton";

interface CuotaPendiente {
  cuota_id: number;
  oc_id: number;
  numero_oc: string | null;
  empresa_codigo: string;
  proveedor_nombre: string | null;
  numero_cuota: number;
  monto: string;
  fecha_vencimiento: string;
  dias_a_vencer: number;
  descripcion: string | null;
  estado: string;
  voucher_id: number | null;
  voucher_codigo: string | null;
}

const fmtCLP = (v: string | number) => {
  const n = typeof v === "string" ? Number(v) : v;
  if (!n) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${n.toLocaleString("es-CL")}`;
};

const fmtDate = (d: string) => {
  const dt = new Date(d);
  return dt.toLocaleDateString("es-CL", {
    month: "short",
    day: "numeric",
  });
};

export function CuotasProximasWidget({
  dias = 30,
  limit = 8,
}: {
  dias?: number;
  limit?: number;
}) {
  const { session } = useSession();

  const cuotas = useQuery<CuotaPendiente[]>({
    queryKey: ["cuotas-proximas", dias],
    queryFn: () =>
      apiClient.get<CuotaPendiente[]>(
        `/ordenes-compra/cuotas/proximas-a-vencer?dias=${dias}&incluir_vencidas=true`,
        session,
      ),
    enabled: !!session,
    staleTime: 60_000,
  });

  if (cuotas.isLoading) {
    return <Skeleton className="h-48 w-full rounded-2xl" />;
  }

  const items = cuotas.data ?? [];
  const vencidas = items.filter((c) => c.dias_a_vencer < 0).length;
  const display = items.slice(0, limit);

  return (
    <section className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink-900 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-cehta-green" strokeWidth={1.5} />
            Cuotas próximas a vencer
          </h2>
          <p className="text-[11px] text-ink-500 mt-0.5">
            Pendientes ≤ {dias} días{" "}
            {vencidas > 0 && (
              <span className="inline-flex items-center gap-1 ml-2 rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-[10px] font-semibold uppercase">
                <AlertCircle className="h-2.5 w-2.5" strokeWidth={2.5} />
                {vencidas} vencida{vencidas === 1 ? "" : "s"}
              </span>
            )}
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl bg-ink-50/30 p-6 text-center">
          <p className="text-sm text-ink-500">
            🎉 Sin cuotas pendientes en los próximos {dias} días.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {display.map((c) => {
            const vencida = c.dias_a_vencer < 0;
            const urgente = c.dias_a_vencer <= 3 && !vencida;
            return (
              <li key={c.cuota_id}>
                <Link
                  href={`/ordenes-compra/${c.oc_id}` as Route}
                  className={`flex items-center justify-between gap-3 rounded-xl p-3 ring-1 transition-colors ${
                    vencida
                      ? "bg-red-50 ring-red-200 hover:bg-red-100"
                      : urgente
                        ? "bg-amber-50 ring-amber-200 hover:bg-amber-100"
                        : "bg-ink-50/40 ring-hairline hover:bg-ink-100/60"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="h-3.5 w-3.5 flex-shrink-0 text-ink-500" strokeWidth={1.75} />
                      <span className="font-medium text-ink-900 truncate">
                        OC {c.numero_oc ?? `#${c.oc_id}`} · Cuota {c.numero_cuota}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.16em] text-ink-400">
                        {c.empresa_codigo}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-500">
                      {c.proveedor_nombre ?? "Sin proveedor"} ·{" "}
                      {c.descripcion ?? "Sin descripción"}
                      {c.voucher_codigo && (
                        <span className="ml-2 text-cehta-green">
                          → voucher {c.voucher_codigo}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold tabular-nums">
                      {fmtCLP(c.monto)}
                    </div>
                    <div
                      className={`text-[11px] ${
                        vencida
                          ? "text-red-700 font-medium"
                          : urgente
                            ? "text-amber-700"
                            : "text-ink-500"
                      }`}
                    >
                      {fmtDate(c.fecha_vencimiento)}
                      {" · "}
                      {vencida
                        ? `vencida ${Math.abs(c.dias_a_vencer)}d`
                        : c.dias_a_vencer === 0
                          ? "hoy"
                          : `en ${c.dias_a_vencer}d`}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
          {items.length > limit && (
            <li className="text-[11px] text-center text-ink-500 pt-1">
              + {items.length - limit} más · Ver todas en{" "}
              <Link
                href={"/ordenes-compra" as Route}
                className="underline text-cehta-green"
              >
                Órdenes de Compra
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
