"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ReportShell } from "@/components/reportes/ReportShell";
import { ContableFilters, fmtCLP } from "@/components/reportes/ContableFilters";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { Skeleton } from "@/components/ui/skeleton";
import type { PLAreaRow } from "@/lib/api/schema";

export default function PLAreaPage() {
  const { session } = useSession();
  const params = useSearchParams();
  const empresa = params.get("empresa") ?? "";
  const fechaDesde = params.get("fecha_desde") ?? "";
  const fechaHasta = params.get("fecha_hasta") ?? "";

  const { data, isLoading } = useQuery<PLAreaRow[]>({
    queryKey: ["pl-area", empresa, fechaDesde, fechaHasta],
    queryFn: () => {
      const qs = new URLSearchParams({ empresa, fecha_desde: fechaDesde, fecha_hasta: fechaHasta });
      return apiClient.get<PLAreaRow[]>(
        `/reportes/contables/pl-area?${qs}`,
        session,
      );
    },
    enabled: !!session && !!empresa && !!fechaDesde && !!fechaHasta,
  });

  const totalIngresos = (data ?? []).reduce((s, r) => s + Number(r.ingresos), 0);
  const totalGastos = (data ?? []).reduce((s, r) => s + Number(r.gastos), 0);
  const totalResultado = totalIngresos - totalGastos;

  return (
    <ReportShell
      eyebrow="Reporte contable formal"
      title="P&L por Área"
      subtitle={`Ingresos vs gastos agrupados por centro de costo. ${empresa || "Elegí empresa"}.`}
      filters={<ContableFilters />}
    >
      {isLoading ? (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60">
              <tr>
                <th className="px-4 py-2 text-left">
                  <Skeleton className="h-3 w-16" />
                </th>
                <th className="px-4 py-2 text-right">
                  <Skeleton className="ml-auto h-3 w-20" />
                </th>
                <th className="px-4 py-2 text-right">
                  <Skeleton className="ml-auto h-3 w-20" />
                </th>
                <th className="px-4 py-2 text-right">
                  <Skeleton className="ml-auto h-3 w-20" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {[1, 2, 3, 4, 5].map((i) => (
                <tr key={i}>
                  <td className="px-4 py-2">
                    <Skeleton className="h-3 w-32" />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Skeleton className="ml-auto h-3 w-24" />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Skeleton className="ml-auto h-3 w-24" />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Skeleton className="ml-auto h-3 w-24" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !data || data.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-ink-500">
          Sin movimientos imputados a áreas en este período.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card print:rounded-none print:border-0 print:shadow-none">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              <tr>
                <th className="px-4 py-2">Área</th>
                <th className="px-4 py-2 text-right">Ingresos</th>
                <th className="px-4 py-2 text-right">Gastos</th>
                <th className="px-4 py-2 text-right">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {data.map((r) => {
                const resultado = Number(r.resultado);
                return (
                  <tr key={r.area_codigo} className="hover:bg-ink-50/40">
                    <td className="px-4 py-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-cehta-green/8 text-[10px] font-bold tabular-nums text-cehta-green ring-1 ring-cehta-green/20">
                        {r.area_codigo}
                      </span>
                      <span className="ml-2 text-sm text-ink-700">
                        {r.area_nombre}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-positive">
                      {fmtCLP(Number(r.ingresos))}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-warning">
                      {fmtCLP(Number(r.gastos))}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono font-semibold tabular-nums ${
                        resultado >= 0 ? "text-positive" : "text-negative"
                      }`}
                    >
                      {fmtCLP(resultado)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-900/20 bg-cehta-green/5 font-semibold">
                <td className="px-4 py-2 text-[10px] uppercase tracking-wider text-cehta-green">
                  Total
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-cehta-green">
                  {fmtCLP(totalIngresos)}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-cehta-green">
                  {fmtCLP(totalGastos)}
                </td>
                <td
                  className={`px-4 py-2 text-right font-mono font-semibold tabular-nums ${
                    totalResultado >= 0 ? "text-positive" : "text-negative"
                  }`}
                >
                  {fmtCLP(totalResultado)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ReportShell>
  );
}
