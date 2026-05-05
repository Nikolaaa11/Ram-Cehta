"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { ReportShell } from "@/components/reportes/ReportShell";
import { ContableFilters, fmtCLP } from "@/components/reportes/ContableFilters";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type {
  ProyectoContable,
  RendicionCorfoReport,
} from "@/lib/api/schema";

export default function RendicionCorfoPage() {
  const { session } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const empresa = params.get("empresa") ?? "";
  const proyecto = params.get("proyecto") ?? "";
  const fechaDesde = params.get("fecha_desde") ?? "";
  const fechaHasta = params.get("fecha_hasta") ?? "";

  // Proyectos CORFO de la empresa
  const { data: proyectos } = useQuery<ProyectoContable[]>({
    queryKey: ["proyectos-corfo", empresa],
    queryFn: () =>
      apiClient.get<ProyectoContable[]>(
        `/proyectos-contables?empresa_codigo=${empresa}&tipo_financiamiento=CORFO`,
        session,
      ),
    enabled: !!session && !!empresa,
  });

  const { data, isLoading } = useQuery<RendicionCorfoReport>({
    queryKey: ["rendicion-corfo", proyecto, fechaDesde, fechaHasta],
    queryFn: () => {
      const qs = new URLSearchParams({
        proyecto,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
      });
      return apiClient.get<RendicionCorfoReport>(
        `/reportes/contables/rendicion-corfo?${qs}`,
        session,
      );
    },
    enabled: !!session && !!proyecto && !!fechaDesde && !!fechaHasta,
  });

  const proyectoSelector = (
    <select
      value={proyecto}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        next.set("proyecto", e.target.value);
        router.replace(`${pathname}?${next}` as any);
      }}
      className="rounded-lg border-0 bg-yellow-50 px-3 py-1.5 text-xs font-medium ring-1 ring-yellow-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-yellow-500 min-w-[260px]"
    >
      <option value="">— Proyecto CORFO —</option>
      {(proyectos ?? []).map((p) => (
        <option key={p.codigo} value={p.codigo}>
          {p.codigo} · {p.nombre}
        </option>
      ))}
    </select>
  );

  return (
    <ReportShell
      eyebrow="Rendición CORFO"
      title="Rendición de gastos a CORFO"
      subtitle={
        proyecto
          ? `Proyecto ${proyecto} · ${fechaDesde} → ${fechaHasta}.`
          : "Elegí proyecto CORFO + rango para generar la rendición."
      }
      filters={<ContableFilters extra={proyectoSelector} />}
    >
      {!proyecto ? (
        <p className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-ink-500">
          Elegí un proyecto CORFO del selector arriba.
        </p>
      ) : isLoading ? (
        <p className="text-sm text-ink-500">Cargando rendición…</p>
      ) : !data || !data.proyecto ? (
        <p className="text-sm text-ink-500">Proyecto no encontrado.</p>
      ) : (
        <>
          {/* Header del proyecto */}
          <div className="rounded-2xl border border-yellow-200 bg-yellow-50/40 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="font-mono text-xs tabular-nums text-ink-700">
                  {data.proyecto.codigo}
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold tracking-tight">
                  {data.proyecto.nombre}
                </h2>
                {data.proyecto.programa && (
                  <p className="mt-1 text-[11px] uppercase tracking-wider text-yellow-800">
                    Programa {data.proyecto.programa}
                  </p>
                )}
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-yellow-800 ring-1 ring-yellow-200">
                <Sparkles className="h-3 w-3" strokeWidth={2.5} />
                CORFO
              </span>
            </div>
          </div>

          {/* Desglose por tipo de gasto */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.desglose_por_tipo_gasto.map((d) => (
              <div
                key={d.tipo_gasto}
                className="rounded-2xl border border-hairline bg-white p-4 shadow-card"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-yellow-800">
                  {d.tipo_gasto}
                </p>
                <p className="mt-1 font-display text-xl font-semibold tabular-nums text-ink-900">
                  {fmtCLP(Number(d.monto))}
                </p>
              </div>
            ))}
            <div className="rounded-2xl border border-cehta-green/30 bg-cehta-green/5 p-4 shadow-card">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cehta-green">
                Total rendición
              </p>
              <p className="mt-1 font-display text-xl font-semibold tabular-nums text-cehta-green">
                {fmtCLP(Number(data.total))}
              </p>
            </div>
          </div>

          {/* Detalle de líneas */}
          <div className="mt-6 overflow-hidden rounded-2xl border border-hairline bg-white shadow-card print:rounded-none print:border-0 print:shadow-none">
            <header className="border-b border-hairline bg-ink-50/40 px-4 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
                Detalle de gastos elegibles ({data.lineas.length})
              </p>
            </header>
            <table className="w-full text-xs">
              <thead className="text-left text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-3 py-2">Fecha · Voucher</th>
                  <th className="px-3 py-2">Documento</th>
                  <th className="px-3 py-2">Proveedor</th>
                  <th className="px-3 py-2">Cuenta</th>
                  <th className="px-3 py-2">Tipo gasto</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {data.lineas.map((l) => (
                  <tr key={`${l.voucher_codigo}-${l.line_number}`} className="hover:bg-ink-50/40">
                    <td className="px-3 py-2 align-top">
                      <p className="font-mono font-semibold tabular-nums">
                        {l.fecha_contable}
                      </p>
                      <p className="font-mono text-[10px] tabular-nums text-ink-500">
                        {l.voucher_codigo}
                      </p>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {l.doc_tributario_tipo && (
                        <p className="text-[10px] uppercase tracking-wider text-ink-600">
                          {l.doc_tributario_tipo}
                        </p>
                      )}
                      {l.doc_tributario_folio && (
                        <p className="font-mono text-[10px] tabular-nums text-ink-700">
                          #{l.doc_tributario_folio}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <p className="text-[11px] text-ink-700">
                        {l.contraparte_nombre ?? "—"}
                      </p>
                      {l.contraparte_rut && (
                        <p className="font-mono text-[10px] tabular-nums text-ink-400">
                          {l.contraparte_rut}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <p className="font-mono text-[10px] tabular-nums">
                        {l.cuenta_codigo}
                      </p>
                      <p className="text-[11px] text-ink-700">
                        {l.cuenta_nombre}
                      </p>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {l.tipo_gasto_corfo && (
                        <span className="inline-flex rounded-full bg-yellow-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-yellow-800">
                          {l.tipo_gasto_corfo}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                      {fmtCLP(Number(l.debit))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ReportShell>
  );
}
