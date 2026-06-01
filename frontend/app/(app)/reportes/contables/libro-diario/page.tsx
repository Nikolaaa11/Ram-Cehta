"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ReportShell } from "@/components/reportes/ReportShell";
import { ContableFilters, fmtCLP } from "@/components/reportes/ContableFilters";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { LibroDiarioRow } from "@/lib/api/schema";

export default function LibroDiarioPage() {
  const { session } = useSession();
  const params = useSearchParams();
  const empresa = params.get("empresa") ?? "";
  const fechaDesde = params.get("fecha_desde") ?? "";
  const fechaHasta = params.get("fecha_hasta") ?? "";

  const { data, isLoading } = useQuery<LibroDiarioRow[]>({
    queryKey: ["libro-diario", empresa, fechaDesde, fechaHasta],
    queryFn: () => {
      const qs = new URLSearchParams({ empresa, fecha_desde: fechaDesde, fecha_hasta: fechaHasta });
      return apiClient.get<LibroDiarioRow[]>(
        `/reportes/contables/libro-diario?${qs}`,
        session,
      );
    },
    enabled: !!session && !!empresa && !!fechaDesde && !!fechaHasta,
  });

  // Agrupa filas por voucher para el render
  const grouped: { voucher_codigo: string; voucher_tipo: string; fecha_contable: string; glosa: string; contraparte: string | null; lines: LibroDiarioRow[] }[] = [];
  (data ?? []).forEach((row) => {
    const last = grouped[grouped.length - 1];
    if (last && last.voucher_codigo === row.voucher_codigo) {
      last.lines.push(row);
    } else {
      grouped.push({
        voucher_codigo: row.voucher_codigo,
        voucher_tipo: row.voucher_tipo,
        fecha_contable: row.fecha_contable,
        glosa: row.glosa,
        contraparte: row.contraparte_nombre,
        lines: [row],
      });
    }
  });

  const totalDebe = (data ?? []).reduce((s, r) => s + Number(r.debit), 0);
  const totalHaber = (data ?? []).reduce((s, r) => s + Number(r.credit), 0);

  return (
    <ReportShell
      eyebrow="Reporte contable formal"
      title="Libro Diario"
      subtitle={
        empresa
          ? `Asientos de ${empresa} entre ${fechaDesde} y ${fechaHasta} (status APPROVED+).`
          : "Elige empresa y rango de fechas para generar el libro."
      }
      filters={<ContableFilters />}
    >
      {isLoading ? (
        <p className="text-sm text-ink-500">Cargando libro diario…</p>
      ) : !data || data.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-ink-500">
          Sin asientos en este período.
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card print:rounded-none print:border-0 print:shadow-none">
            <table className="w-full text-xs">
              <thead className="bg-ink-50/60 text-left text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-500 print:bg-white">
                <tr>
                  <th className="px-3 py-2">Voucher · Fecha</th>
                  <th className="px-3 py-2">Cuenta</th>
                  <th className="px-3 py-2">Proyecto · Área</th>
                  <th className="px-3 py-2">Glosa</th>
                  <th className="px-3 py-2 text-right">Debe</th>
                  <th className="px-3 py-2 text-right">Haber</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {grouped.map((g) => (
                  <>
                    {g.lines.map((r, lineIdx) => (
                      <tr
                        key={`${g.voucher_codigo}-${r.line_number}`}
                        className={lineIdx === 0 ? "border-t-2 border-ink-100 print:border-t" : ""}
                      >
                        <td className="px-3 py-2 align-top">
                          {lineIdx === 0 ? (
                            <>
                              <p className="font-mono font-semibold tabular-nums text-ink-700">
                                {g.voucher_codigo}
                              </p>
                              <p className="font-mono text-[10px] tabular-nums text-ink-400">
                                {g.fecha_contable}
                              </p>
                              <p className="text-[10px] uppercase tracking-wider text-ink-500">
                                {g.voucher_tipo}
                              </p>
                            </>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <p className="font-mono text-[10px] tabular-nums">
                            {r.cuenta_codigo}
                          </p>
                          <p className="text-[11px] text-ink-700">
                            {r.cuenta_nombre}
                          </p>
                        </td>
                        <td className="px-3 py-2 align-top font-mono text-[10px] tabular-nums text-ink-500">
                          {r.proyecto_codigo ?? "—"}
                          <br />
                          <span className="text-ink-400">{r.area_codigo ?? "—"}</span>
                        </td>
                        <td className="px-3 py-2 align-top text-[11px]">
                          {lineIdx === 0 ? (
                            <p className="text-ink-700">{g.glosa}</p>
                          ) : null}
                          {r.linea_descripcion && (
                            <p className="text-[10px] italic text-ink-500">
                              {r.linea_descripcion}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {Number(r.debit) > 0 ? fmtCLP(Number(r.debit)) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {Number(r.credit) > 0 ? fmtCLP(Number(r.credit)) : "—"}
                        </td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-900/20 bg-ink-50/40 font-semibold">
                  <td colSpan={4} className="px-3 py-2 text-right text-[10px] uppercase tracking-wider text-ink-500">
                    Totales del período
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {fmtCLP(totalDebe)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {fmtCLP(totalHaber)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-[11px] italic text-ink-500">
            {grouped.length} asientos · {(data ?? []).length} líneas · Σ debe = Σ haber
            {totalDebe === totalHaber ? " ✓" : " ⚠ descuadrado"}
          </p>
        </>
      )}
    </ReportShell>
  );
}
