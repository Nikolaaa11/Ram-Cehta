"use client";

/**
 * Página /compliance — V4 fase 7.11.
 *
 * Vista ejecutiva del estado de compliance del portfolio. Combina:
 *   1. KPIs globales (promedio, mejor/peor empresa, total entregables)
 *   2. Compliance Leaderboard (ranking interactivo)
 *   3. Drill-down per empresa (click → detalle con breakdown)
 *
 * Pensado para review trimestral / anual con el Comité.
 */
import { useMemo, useState } from "react";
import {
  Award,
  ClipboardCheck,
  Printer,
  TrendingUp,
  TrendingDown,
  Trophy,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { ComplianceLeaderboard } from "@/components/dashboard/ComplianceLeaderboard";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import {
  type ComplianceGradeEmpresa,
  useComplianceGradeReport,
} from "@/hooks/use-entregables";
import { cn } from "@/lib/utils";

const GRADE_BG: Record<string, string> = {
  A: "bg-positive/15 text-positive ring-positive/30",
  B: "bg-cehta-green/15 text-cehta-green ring-cehta-green/30",
  C: "bg-info/15 text-info ring-info/30",
  D: "bg-warning/15 text-warning ring-warning/30",
  F: "bg-negative/15 text-negative ring-negative/30",
};

export default function CompliancePage() {
  const { data, isLoading } = useComplianceGradeReport();
  const [selectedEmpresa, setSelectedEmpresa] =
    useState<ComplianceGradeEmpresa | null>(null);

  const stats = useMemo(() => {
    if (!data || data.empresas.length === 0) {
      return {
        promedio: 0,
        mejor: null as ComplianceGradeEmpresa | null,
        peor: null as ComplianceGradeEmpresa | null,
        totalEntregables: 0,
        totalATiempo: 0,
        empresasConRiesgo: 0,
      };
    }
    const totalEntregables = data.empresas.reduce(
      (acc, e) => acc + e.total,
      0,
    );
    const totalATiempo = data.empresas.reduce(
      (acc, e) => acc + e.entregados_a_tiempo,
      0,
    );
    const empresasConRiesgo = data.empresas.filter(
      (e) => e.grade === "D" || e.grade === "F",
    ).length;
    return {
      promedio: data.promedio_cumplimiento,
      mejor: data.empresas[0] ?? null, // already sorted desc
      peor: data.empresas[data.empresas.length - 1] ?? null,
      totalEntregables,
      totalATiempo,
      empresasConRiesgo,
    };
  }, [data]);

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 px-6 py-6 lg:px-10 print:max-w-full print:px-0 print:py-0">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Gobernanza · Comité de Vigilancia
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink-900">
            Compliance Portfolio
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Estado YTD del cumplimiento regulatorio cross-empresa. Ranking,
            drill-down y comparación.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40"
        >
          <Printer className="h-4 w-4" strokeWidth={1.5} />
          Imprimir / Exportar PDF
        </button>
      </div>

      {/* Print-only header */}
      <div className="hidden print:block">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Compliance Portfolio · FIP CEHTA ESG · AFIS S.A.
        </p>
        <p className="text-xs text-ink-700">
          Generado el{" "}
          {new Date().toLocaleString("es-CL", {
            day: "2-digit",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>

      {/* KPIs globales */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi
            label="Promedio portfolio"
            value={`${stats.promedio.toFixed(1)}%`}
            sub="Cumplimiento YTD ponderado"
            tone={
              stats.promedio >= 95
                ? "positive"
                : stats.promedio >= 85
                  ? "info"
                  : stats.promedio >= 70
                    ? "warning"
                    : "negative"
            }
            Icon={ClipboardCheck}
          />
          <Kpi
            label="Mejor empresa"
            value={stats.mejor?.empresa_codigo ?? "—"}
            sub={
              stats.mejor
                ? `Grade ${stats.mejor.grade} · ${stats.mejor.tasa_a_tiempo.toFixed(0)}%`
                : "Sin datos"
            }
            tone="positive"
            Icon={Trophy}
          />
          <Kpi
            label="Peor empresa"
            value={stats.peor?.empresa_codigo ?? "—"}
            sub={
              stats.peor
                ? `Grade ${stats.peor.grade} · ${stats.peor.tasa_a_tiempo.toFixed(0)}%`
                : "Sin datos"
            }
            tone={
              stats.peor && (stats.peor.grade === "F" || stats.peor.grade === "D")
                ? "negative"
                : "warning"
            }
            Icon={TrendingDown}
          />
          <Kpi
            label="Empresas con riesgo"
            value={String(stats.empresasConRiesgo)}
            sub={`Grade D o F · de ${data?.empresas.length ?? 0} totales`}
            tone={stats.empresasConRiesgo > 0 ? "warning" : "positive"}
            Icon={TrendingUp}
          />
        </div>
      )}

      {/* Leaderboard */}
      <ComplianceLeaderboard />

      {/* Detalle drill-down */}
      {data && data.empresas.length > 0 && (
        <Surface>
          <Surface.Header className="border-b border-hairline pb-3">
            <Surface.Title>Detalle por empresa</Surface.Title>
            <Surface.Subtitle>
              Click en una empresa para ver el desglose completo de su
              cumplimiento YTD.
            </Surface.Subtitle>
          </Surface.Header>

          <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {data.empresas.map((emp) => {
              const isSelected =
                selectedEmpresa?.empresa_codigo === emp.empresa_codigo;
              return (
                <button
                  key={emp.empresa_codigo}
                  type="button"
                  onClick={() =>
                    setSelectedEmpresa(isSelected ? null : emp)
                  }
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                    isSelected
                      ? "border-cehta-green/50 bg-cehta-green/5 ring-1 ring-cehta-green/30"
                      : "border-hairline bg-white hover:bg-ink-50",
                  )}
                >
                  <EmpresaLogo empresaCodigo={emp.empresa_codigo} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {emp.empresa_codigo}
                    </p>
                    <p className="text-[11px] text-ink-500">
                      {emp.entregados_a_tiempo} a tiempo · {emp.total} total
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base font-bold ring-1",
                      GRADE_BG[emp.grade] ?? "bg-ink-100",
                    )}
                  >
                    {emp.grade}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedEmpresa && (
            <DrillDownPanel empresa={selectedEmpresa} />
          )}
        </Surface>
      )}

      {/* Footer compliance note */}
      <p className="border-t border-ink-300 pt-4 text-[10px] text-ink-500 print:border-ink-900">
        <strong>Nota de compliance.</strong> Compliance grade se calcula como
        70% tasa de entrega a tiempo + 30% tasa de cumplimiento general.
        Empresas sin entregables vencidos en el período aún se muestran con
        100% (sin entregables a evaluar). YTD = del 1 de enero al día actual.
      </p>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  Icon,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "positive" | "negative" | "warning" | "info";
  Icon: typeof Award;
}) {
  const toneClass =
    tone === "positive"
      ? "border-positive/30 bg-positive/5"
      : tone === "negative"
        ? "border-negative/30 bg-negative/5"
        : tone === "warning"
          ? "border-warning/30 bg-warning/5"
          : "border-info/30 bg-info/5";
  const accentText =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
        ? "text-negative"
        : tone === "warning"
          ? "text-warning"
          : "text-info";

  return (
    <div className={cn("rounded-2xl border p-4", toneClass)}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        {label}
      </div>
      <p className={cn("mt-1.5 text-2xl font-bold tabular-nums", accentText)}>
        {value}
      </p>
      <p className="text-[11px] text-ink-500">{sub}</p>
    </div>
  );
}

function DrillDownPanel({ empresa }: { empresa: ComplianceGradeEmpresa }) {
  const totalProcesados =
    empresa.entregados_a_tiempo +
    empresa.entregados_atrasados +
    empresa.no_entregados;

  return (
    <div className="mt-4 rounded-2xl border border-cehta-green/30 bg-cehta-green/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <EmpresaLogo empresaCodigo={empresa.empresa_codigo} size={48} />
          <div>
            <h3 className="text-lg font-semibold text-ink-900">
              {empresa.empresa_codigo}
            </h3>
            <p className="text-xs text-ink-500">Detalle YTD del compliance</p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex h-12 w-12 items-center justify-center rounded-xl text-2xl font-bold ring-1",
            GRADE_BG[empresa.grade] ?? "bg-ink-100",
          )}
        >
          {empresa.grade}
        </span>
      </div>

      {/* Progress bar split */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-[11px] font-medium text-ink-700">
          <span>Distribución de {totalProcesados} entregables vencidos</span>
          <span className="text-ink-500">
            {empresa.tasa_a_tiempo.toFixed(1)}% a tiempo ·{" "}
            {empresa.tasa_cumplimiento.toFixed(1)}% cumplidos
          </span>
        </div>
        <div className="mt-1.5 flex h-3 overflow-hidden rounded-full bg-ink-100">
          {totalProcesados > 0 && (
            <>
              <div
                className="bg-positive transition-all"
                style={{
                  width: `${(empresa.entregados_a_tiempo / totalProcesados) * 100}%`,
                }}
                title={`${empresa.entregados_a_tiempo} a tiempo`}
              />
              <div
                className="bg-warning transition-all"
                style={{
                  width: `${(empresa.entregados_atrasados / totalProcesados) * 100}%`,
                }}
                title={`${empresa.entregados_atrasados} atrasados`}
              />
              <div
                className="bg-negative transition-all"
                style={{
                  width: `${(empresa.no_entregados / totalProcesados) * 100}%`,
                }}
                title={`${empresa.no_entregados} no entregados`}
              />
            </>
          )}
        </div>
      </div>

      {/* Breakdown grid */}
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <BreakdownTile
          label="A tiempo"
          value={empresa.entregados_a_tiempo}
          tone="positive"
        />
        <BreakdownTile
          label="Atrasados"
          value={empresa.entregados_atrasados}
          tone="warning"
        />
        <BreakdownTile
          label="No entregados"
          value={empresa.no_entregados}
          tone="negative"
        />
        <BreakdownTile
          label="Aún pendientes"
          value={empresa.pendientes}
          tone="info"
          sub="(no vencidos aún)"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-ink-500">
          Score: 70% tasa a tiempo + 30% tasa cumplimiento ={" "}
          <strong className="text-ink-700">
            {(
              empresa.tasa_a_tiempo * 0.7 +
              empresa.tasa_cumplimiento * 0.3
            ).toFixed(1)}
          </strong>
        </p>
        <a
          href={`/empresa/${empresa.empresa_codigo}`}
          className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:bg-cehta-green-700"
        >
          Ver empresa completa →
        </a>
      </div>
    </div>
  );
}

function BreakdownTile({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: number;
  tone: "positive" | "warning" | "negative" | "info";
  sub?: string;
}) {
  const accentText =
    tone === "positive"
      ? "text-positive"
      : tone === "warning"
        ? "text-warning"
        : tone === "negative"
          ? "text-negative"
          : "text-info";
  return (
    <div className="rounded-xl border border-hairline bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <p className={cn("mt-0.5 text-2xl font-bold tabular-nums", accentText)}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-ink-400">{sub}</p>}
    </div>
  );
}
