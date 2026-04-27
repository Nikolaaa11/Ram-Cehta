"use client";

import { useMemo, useState } from "react";
import { saveAs } from "file-saver";
import { Building2 } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { ReportShell } from "@/components/reportes/ReportShell";
import { ReportActionsBar } from "@/components/reportes/ReportActionsBar";
import { fmtCLP, fmtFileTimestamp, fmtInt } from "@/lib/reportes/format";
import { cn } from "@/lib/utils";
import type { ProyectoRanking } from "@/lib/api/schema";
import type { EmpresaPortafolioStats } from "@/lib/reportes/types";

const renderPortafolioPdf = () =>
  import("@/components/reportes/pdf/PortafolioPDF").then((m) => m.renderPortafolioPdf);

interface Props {
  empresas: EmpresaPortafolioStats[];
  ranking: ProyectoRanking[];
}

function statusDot(e: EmpresaPortafolioStats): { color: string; label: string; tone: "ok" | "warn" | "danger" } {
  if (e.f29_vencidas > 0) return { color: "bg-negative", label: "F29 vencidas", tone: "danger" };
  if (e.ocs_pendientes > 5) return { color: "bg-warning", label: "OCs altas", tone: "warn" };
  if (e.f29_pendientes > 0) return { color: "bg-warning", label: "Compliance pendiente", tone: "warn" };
  return { color: "bg-positive", label: "Al día", tone: "ok" };
}

export function PortafolioReportView({ empresas, ranking }: Props) {
  const [loading, setLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const totalAum = useMemo(
    () => empresas.reduce((acc, e) => acc + Number(e.saldo_contable ?? 0), 0),
    [empresas],
  );
  const totalOcs = empresas.reduce((acc, e) => acc + e.ocs_pendientes, 0);
  const totalF29Vencidas = empresas.reduce((acc, e) => acc + e.f29_vencidas, 0);

  async function handleDownload() {
    try {
      setLoading(true);
      setPdfError(null);
      const render = await renderPortafolioPdf();
      const blob = await render({ empresas, ranking, generatedAt: new Date() });
      saveAs(blob, `cehta-reporte-portafolio-${fmtFileTimestamp()}.pdf`);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "No se pudo generar el PDF.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ReportShell
      title="Composición del Portafolio"
      subtitle={`${empresas.length} compañías · AUM total ${fmtCLP(totalAum)}`}
      actions={<ReportActionsBar onDownloadPdf={handleDownload} pdfLoading={loading} pdfError={pdfError} />}
    >
      {/* Roll-up KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <RollupCard label="Compañías" value={fmtInt(empresas.length)} />
        <RollupCard label="AUM total" value={fmtCLP(totalAum)} />
        <RollupCard label="OCs pendientes" value={fmtInt(totalOcs)} />
        <RollupCard label="F29 vencidas" value={fmtInt(totalF29Vencidas)} tone={totalF29Vencidas > 0 ? "danger" : "neutral"} />
      </div>

      {/* Empresa grid */}
      {empresas.length === 0 ? (
        <Surface className="py-16 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
            <Building2 className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
          </div>
          <p className="text-base font-semibold text-ink-900">Sin empresas en el catálogo</p>
          <p className="mt-1 text-sm text-ink-500">Espera al próximo ciclo del ETL para poblar el portafolio.</p>
        </Surface>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {empresas.map((e) => {
            const status = statusDot(e);
            return (
              <Surface key={e.codigo} className="flex flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold tracking-tight text-ink-900">{e.codigo}</p>
                    <p className="text-xs text-ink-500">{e.razon_social}</p>
                    {e.rut ? <p className="text-[11px] text-ink-500 tabular-nums">RUT {e.rut}</p> : null}
                  </div>
                  <span
                    className={cn("mt-1 inline-flex items-center gap-1.5 text-xs", {
                      "text-positive": status.tone === "ok",
                      "text-warning": status.tone === "warn",
                      "text-negative": status.tone === "danger",
                    })}
                  >
                    <span className={cn("inline-block h-2 w-2 rounded-full", status.color)} aria-hidden="true" />
                    {status.label}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 border-t border-hairline pt-3">
                  <Stat label="Saldo contable" value={fmtCLP(e.saldo_contable)} />
                  <Stat label="Saldo Cehta" value={fmtCLP(e.saldo_cehta)} muted />
                  <Stat label="OCs pendientes" value={fmtInt(e.ocs_pendientes)} />
                  <Stat label="Monto OC pend." value={fmtCLP(e.monto_oc_pendiente)} muted />
                  <Stat label="F29 pendientes" value={fmtInt(e.f29_pendientes)} />
                  <Stat label="F29 vencidas" value={fmtInt(e.f29_vencidas)} tone={e.f29_vencidas > 0 ? "danger" : undefined} />
                </div>
              </Surface>
            );
          })}
        </div>
      )}

      {/* Ranking proyectos */}
      <Surface padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-ink-900">Ranking de proyectos</h3>
            <p className="text-xs text-ink-500">Top {ranking.length} por gasto consolidado</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-hairline text-sm">
            <thead className="bg-ink-100/40">
              <tr>
                <Th>#</Th>
                <Th>Proyecto</Th>
                <Th align="right">Total egresos</Th>
                <Th align="right">Movimientos</Th>
                <Th>Empresas</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {ranking.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-ink-500">
                    Sin datos de ranking para mostrar.
                  </td>
                </tr>
              ) : (
                ranking.map((p, idx) => (
                  <tr key={p.proyecto} className="transition-colors duration-150 hover:bg-ink-100/30">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-500">{idx + 1}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-ink-900">{p.proyecto}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-900">{fmtCLP(p.total_egreso)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-700">{fmtInt(p.num_movimientos)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-500">{p.empresas.join(", ") || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Surface>
    </ReportShell>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-xs uppercase tracking-wide text-ink-500 font-medium",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function RollupCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "danger" }) {
  return (
    <Surface padding="compact" className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wide text-ink-500 font-medium">{label}</span>
      <span className={cn("text-kpi-sm tabular-nums", tone === "danger" ? "text-negative" : "text-ink-900")}>{value}</span>
    </Surface>
  );
}

function Stat({ label, value, muted, tone }: { label: string; value: string; muted?: boolean; tone?: "danger" }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={cn(
          "tabular-nums",
          tone === "danger" ? "text-negative font-semibold" : muted ? "text-ink-700 text-sm" : "text-ink-900 text-sm font-medium",
        )}
      >
        {value}
      </p>
    </div>
  );
}
