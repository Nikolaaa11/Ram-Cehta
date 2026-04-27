"use client";

import { useMemo, useState } from "react";
import { saveAs } from "file-saver";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { ReportShell } from "@/components/reportes/ReportShell";
import { ReportActionsBar } from "@/components/reportes/ReportActionsBar";
import { fmtCLP, fmtDate, fmtFileTimestamp, fmtInt } from "@/lib/reportes/format";
import { cn } from "@/lib/utils";
import type {
  CashflowResponse,
  DashboardKPIs,
  SaldoEmpresaDetalle,
} from "@/lib/api/schema";

// react-pdf es ~200KB y depende de browser APIs — lazy load + ssr:false.
const renderFondoPdf = () =>
  import("@/components/reportes/pdf/FondoPDF").then((m) => m.renderFondoPdf);

interface Props {
  kpis: DashboardKPIs | null;
  saldos: SaldoEmpresaDetalle[];
  cashflow: CashflowResponse;
  meses: number;
}

export function FondoReportView({ kpis, saldos, cashflow, meses }: Props) {
  const [loading, setLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const aumTotal = useMemo(() => {
    if (kpis) return Number(kpis.saldo_total_consolidado);
    return saldos.reduce((acc, s) => acc + Number(s.saldo_contable ?? 0), 0);
  }, [kpis, saldos]);

  const totalCehta = useMemo(() => {
    if (kpis) return Number(kpis.saldo_total_cehta);
    return saldos.reduce((acc, s) => acc + Number(s.saldo_cehta ?? 0), 0);
  }, [kpis, saldos]);

  const totalCorfo = useMemo(() => {
    if (kpis) return Number(kpis.saldo_total_corfo);
    return saldos.reduce((acc, s) => acc + Number(s.saldo_corfo ?? 0), 0);
  }, [kpis, saldos]);

  const flujoNeto = kpis ? Number(kpis.flujo_neto_mes) : 0;

  const today = new Date();

  async function handleDownload() {
    try {
      setLoading(true);
      setPdfError(null);
      const render = await renderFondoPdf();
      const blob = await render({ kpis, saldos, cashflow, generatedAt: new Date() });
      saveAs(blob, `cehta-reporte-fondo-${fmtFileTimestamp()}.pdf`);
    } catch (err) {
      setPdfError(
        err instanceof Error ? err.message : "No se pudo generar el PDF.",
      );
    } finally {
      setLoading(false);
    }
  }

  const etlStatus = kpis?.etl_status ?? "unknown";
  const etlOk = etlStatus === "success";
  const etlNeverRan = !kpis || kpis.ultimo_etl_run === null;

  return (
    <ReportShell
      title="Estado del Fondo"
      subtitle={`Vista consolidada · últimos ${meses} meses · FIP CEHTA ESG`}
      actions={
        <ReportActionsBar
          onDownloadPdf={handleDownload}
          pdfLoading={loading}
          pdfError={pdfError}
        />
      }
    >
      {/* ETL status */}
      <Surface padding="compact" variant="glass" className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              etlOk ? "bg-positive" : etlNeverRan ? "bg-ink-300" : "bg-warning",
            )}
            aria-hidden="true"
          />
          <span className="text-sm text-ink-700">
            {etlNeverRan
              ? "El ETL contable aún no ha corrido. El reporte se generará con datos vacíos."
              : `Último ETL: ${fmtDate(kpis!.ultimo_etl_run)} · Estado ${etlStatus}`}
          </span>
        </div>
        <Badge variant={etlOk ? "success" : etlNeverRan ? "neutral" : "warning"}>
          {etlOk ? "Datos al día" : etlNeverRan ? "Sin datos" : "Atención"}
        </Badge>
      </Surface>

      {/* KPI hero */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiHeroCard label="AUM Consolidado" value={fmtCLP(aumTotal)} hint="Suma saldos contables actuales" />
        <KpiHeroCard label="Saldo Cehta" value={fmtCLP(totalCehta)} hint="Aporte del fondo" />
        <KpiHeroCard label="Saldo CORFO" value={fmtCLP(totalCorfo)} hint="Aporte CORFO" />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiSmall label="Egreso mes" value={kpis ? fmtCLP(kpis.egreso_mes_actual) : "—"} delta={kpis?.egreso_delta_pct ?? null} invertColor />
        <KpiSmall label="Abono mes" value={kpis ? fmtCLP(kpis.abono_mes_actual) : "—"} delta={kpis?.abono_delta_pct ?? null} />
        <KpiSmall label="Flujo neto mes" value={fmtCLP(flujoNeto)} />
        <KpiSmall label="OC pendientes" value={kpis ? fmtInt(kpis.oc_emitidas_pendientes) : "—"} hint={kpis ? fmtCLP(kpis.monto_oc_pendiente) : undefined} />
      </div>

      {/* Saldos por empresa */}
      <Surface padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-ink-900">Saldos por empresa</h3>
            <p className="text-xs text-ink-500">Composición consolidada del portafolio</p>
          </div>
          <span className="text-xs text-ink-500">{saldos.length} compañías</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-hairline text-sm">
            <thead className="bg-ink-100/40">
              <tr>
                <Th>Empresa</Th>
                <Th>Razón social</Th>
                <Th align="right">Saldo contable</Th>
                <Th align="right">Saldo Cehta</Th>
                <Th align="right">Saldo CORFO</Th>
                <Th>Última actualización</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {saldos.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-ink-500">
                    Sin saldos para mostrar. Espera al próximo ciclo del ETL contable.
                  </td>
                </tr>
              ) : (
                saldos.map((s) => (
                  <tr key={s.empresa_codigo} className="transition-colors duration-150 hover:bg-ink-100/30">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-ink-900">{s.empresa_codigo}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-700">{s.razon_social}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-900">{fmtCLP(s.saldo_contable)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-700">{fmtCLP(s.saldo_cehta)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-700">{fmtCLP(s.saldo_corfo)}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-500">{fmtDate(s.ultima_actualizacion)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Surface>

      {/* Cashflow consolidado */}
      <Surface padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-ink-900">Cashflow consolidado</h3>
            <p className="text-xs text-ink-500">Últimos {meses} meses · valores reales</p>
          </div>
        </div>
        <CashflowMiniBars points={cashflow.points} />
      </Surface>

      <p className="text-center text-xs text-ink-500 tabular-nums">
        Generado el {today.toLocaleString("es-CL")} · Cehta Capital — Confidencial · No distribuir
      </p>
    </ReportShell>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
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

function KpiHeroCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Surface className="flex flex-col gap-1.5 p-6">
      <span className="text-xs uppercase tracking-wide text-ink-500 font-medium">{label}</span>
      <span className="text-kpi-lg tabular-nums text-ink-900">{value}</span>
      {hint ? <span className="text-xs text-ink-500">{hint}</span> : null}
    </Surface>
  );
}

function KpiSmall({
  label,
  value,
  hint,
  delta,
  invertColor = false,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  invertColor?: boolean;
}) {
  let deltaIcon = <Minus className="h-3 w-3" strokeWidth={1.5} />;
  let deltaColor = "text-ink-500";
  let deltaText: string | null = null;
  if (delta !== null && delta !== undefined && Number.isFinite(delta)) {
    deltaText = `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`;
    if (delta > 0) {
      deltaIcon = <TrendingUp className="h-3 w-3" strokeWidth={1.5} />;
      deltaColor = invertColor ? "text-negative" : "text-positive";
    } else if (delta < 0) {
      deltaIcon = <TrendingDown className="h-3 w-3" strokeWidth={1.5} />;
      deltaColor = invertColor ? "text-positive" : "text-negative";
    }
  }
  return (
    <Surface padding="compact" className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wide text-ink-500 font-medium">{label}</span>
      <span className="text-kpi-sm tabular-nums text-ink-900">{value}</span>
      {deltaText ? (
        <span className={cn("inline-flex items-center gap-1 text-xs tabular-nums", deltaColor)}>
          {deltaIcon}
          {deltaText} vs mes anterior
        </span>
      ) : hint ? (
        <span className="text-xs text-ink-500">{hint}</span>
      ) : null}
    </Surface>
  );
}

function CashflowMiniBars({ points }: { points: CashflowResponse["points"] }) {
  if (points.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-ink-500">
        Sin datos de cashflow para el período seleccionado.
      </div>
    );
  }
  const max = Math.max(
    1,
    ...points.map((p) => Math.max(Number(p.abono_real), Number(p.egreso_real))),
  );
  return (
    <div className="px-6 py-6">
      <div className="flex items-end gap-2 overflow-x-auto pb-2">
        {points.map((p) => {
          const abono = Number(p.abono_real);
          const egreso = Number(p.egreso_real);
          const flujo = Number(p.flujo_neto_real);
          return (
            <div key={p.periodo} className="flex min-w-[56px] flex-col items-center gap-1.5">
              <div className="flex h-32 items-end gap-1">
                <div
                  className="w-3 rounded-t bg-positive/70"
                  style={{ height: `${(abono / max) * 100}%` }}
                  title={`Abono: ${fmtCLP(abono)}`}
                />
                <div
                  className="w-3 rounded-t bg-negative/70"
                  style={{ height: `${(egreso / max) * 100}%` }}
                  title={`Egreso: ${fmtCLP(egreso)}`}
                />
              </div>
              <span className="text-[10px] tabular-nums text-ink-500">{p.periodo}</span>
              <span
                className={cn(
                  "text-[10px] tabular-nums",
                  flujo >= 0 ? "text-positive" : "text-negative",
                )}
              >
                {flujo >= 0 ? "+" : ""}
                {(flujo / 1_000_000).toFixed(1)}M
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-positive/70" /> Abono real
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-negative/70" /> Egreso real
        </span>
      </div>
    </div>
  );
}

