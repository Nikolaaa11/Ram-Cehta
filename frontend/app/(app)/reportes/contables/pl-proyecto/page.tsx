"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ReportShell } from "@/components/reportes/ReportShell";
import { ContableFilters, fmtCLP } from "@/components/reportes/ContableFilters";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { PLProyectoRow } from "@/lib/api/schema";

export default function PLProyectoPage() {
  const { session } = useSession();
  const params = useSearchParams();
  const empresa = params.get("empresa") ?? "";
  const fechaDesde = params.get("fecha_desde") ?? "";
  const fechaHasta = params.get("fecha_hasta") ?? "";

  const { data, isLoading } = useQuery<PLProyectoRow[]>({
    queryKey: ["pl-proyecto", empresa, fechaDesde, fechaHasta],
    queryFn: () => {
      const qs = new URLSearchParams({ empresa, fecha_desde: fechaDesde, fecha_hasta: fechaHasta });
      return apiClient.get<PLProyectoRow[]>(
        `/reportes/contables/pl-proyecto?${qs}`,
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
      title="P&L por Proyecto"
      subtitle={`Ingresos vs gastos agrupados por código de proyecto. ${empresa || "Elegí empresa"}.`}
      filters={<ContableFilters />}
    >
      {isLoading ? (
        <p className="text-sm text-ink-500">Cargando…</p>
      ) : !data || data.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-ink-500">
          Sin movimientos imputados a proyectos en este período.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card print:rounded-none print:border-0 print:shadow-none">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              <tr>
                <th className="px-4 py-2">Proyecto</th>
                <th className="px-4 py-2">Tipo</th>
                <th className="px-4 py-2 text-right">Ingresos</th>
                <th className="px-4 py-2 text-right">Gastos</th>
                <th className="px-4 py-2 text-right">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {data.map((r) => {
                const resultado = Number(r.resultado);
                return (
                  <tr key={r.proyecto_codigo} className="hover:bg-ink-50/40">
                    <td className="px-4 py-2">
                      <p className="font-mono text-xs tabular-nums text-ink-700">
                        {r.proyecto_codigo}
                      </p>
                      <p className="text-[11px] text-ink-500">{r.proyecto_nombre}</p>
                    </td>
                    <td className="px-4 py-2">
                      {r.tipo_financiamiento && (
                        <span className="inline-flex rounded-full bg-cehta-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cehta-green">
                          {r.tipo_financiamiento}
                        </span>
                      )}
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
                <td colSpan={2} className="px-4 py-2 text-[10px] uppercase tracking-wider text-cehta-green">
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
