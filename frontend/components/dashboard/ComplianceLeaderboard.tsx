"use client";

/**
 * ComplianceLeaderboard — V4 fase 7.10.
 *
 * Ranking cross-empresa de compliance grade YTD. Cada empresa muestra:
 *   - Logo + código
 *   - Letra A/B/C/D/F
 *   - % a tiempo + barra de progreso visual
 *   - Detalle: X de Y entregados a tiempo
 *
 * Posición #1 = mejor compliance YTD.
 *
 * Uso: dashboard, /compliance/page, o widget en /admin.
 */
import { Award, Medal, Trophy } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { useComplianceGradeReport } from "@/hooks/use-entregables";
import { cn } from "@/lib/utils";

const GRADE_COLOR: Record<string, string> = {
  A: "bg-positive text-white",
  B: "bg-cehta-green text-white",
  C: "bg-info text-white",
  D: "bg-warning text-white",
  F: "bg-negative text-white",
};

const GRADE_BAR: Record<string, string> = {
  A: "bg-positive",
  B: "bg-cehta-green",
  C: "bg-info",
  D: "bg-warning",
  F: "bg-negative",
};

export function ComplianceLeaderboard() {
  const { data, isLoading, isError } = useComplianceGradeReport();

  if (isLoading) {
    return (
      <Surface>
        <Surface.Header>
          <Surface.Title>Compliance Leaderboard YTD</Surface.Title>
          <Surface.Subtitle>Cargando…</Surface.Subtitle>
        </Surface.Header>
        <div className="mt-3 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      </Surface>
    );
  }

  if (isError || !data) {
    return (
      <Surface className="border border-negative/20 bg-negative/5">
        <p className="text-sm text-negative">
          No se pudo cargar el ranking de compliance.
        </p>
      </Surface>
    );
  }

  if (data.empresas.length === 0) {
    return (
      <Surface>
        <Surface.Header>
          <Surface.Title>Compliance Leaderboard YTD</Surface.Title>
        </Surface.Header>
        <p className="mt-3 text-sm italic text-ink-500">
          Aún no hay entregables asignados a empresas específicas. Cargá vía
          import CSV o asigná desde la UI para ver el ranking.
        </p>
      </Surface>
    );
  }

  return (
    <Surface>
      <Surface.Header className="border-b border-hairline pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cehta-green/15 text-cehta-green">
              <Trophy className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <Surface.Title>Compliance Leaderboard YTD</Surface.Title>
              <Surface.Subtitle>
                Ranking de empresas por entregas a tiempo · promedio
                portfolio:{" "}
                <strong>{data.promedio_cumplimiento.toFixed(1)}%</strong>
              </Surface.Subtitle>
            </div>
          </div>
          <span className="text-[10px] text-ink-500">
            {data.empresas.length} empresa
            {data.empresas.length !== 1 ? "s" : ""} · YTD{" "}
            {new Date(data.generado_at).toLocaleDateString("es-CL")}
          </span>
        </div>
      </Surface.Header>

      <div className="mt-3 space-y-1.5">
        {data.empresas.map((emp, idx) => {
          const pos = idx + 1;
          const PosIcon = pos === 1 ? Trophy : pos === 2 || pos === 3 ? Medal : Award;
          const posColor =
            pos === 1
              ? "text-yellow-600"
              : pos === 2
                ? "text-slate-500"
                : pos === 3
                  ? "text-orange-600"
                  : "text-ink-400";
          return (
            <a
              key={emp.empresa_codigo}
              href={`/empresa/${emp.empresa_codigo}`}
              className={cn(
                "flex items-center gap-3 rounded-xl border border-hairline bg-white px-3 py-2.5 transition-colors hover:border-cehta-green/40 hover:bg-cehta-green/5",
                pos === 1 && "ring-1 ring-yellow-400/30",
              )}
            >
              {/* Posición */}
              <div className="flex w-12 shrink-0 items-center gap-1">
                <PosIcon
                  className={cn("h-4 w-4", posColor)}
                  strokeWidth={1.75}
                />
                <span className="text-base font-bold tabular-nums text-ink-700">
                  {pos}
                </span>
              </div>

              {/* Logo + código */}
              <EmpresaLogo empresaCodigo={emp.empresa_codigo} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-900">
                  {emp.empresa_codigo}
                </p>
                <div className="mt-0.5 flex items-center gap-2">
                  <div className="relative h-1.5 flex-1 max-w-[180px] overflow-hidden rounded-full bg-ink-100">
                    <div
                      className={cn(
                        "absolute inset-y-0 left-0 transition-all",
                        GRADE_BAR[emp.grade] ?? "bg-ink-300",
                      )}
                      style={{
                        width: `${Math.min(100, emp.tasa_a_tiempo)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-medium tabular-nums text-ink-500">
                    {emp.tasa_a_tiempo.toFixed(0)}% a tiempo
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-ink-400">
                  {emp.entregados_a_tiempo} a tiempo · {emp.entregados_atrasados}{" "}
                  atrasados · {emp.no_entregados} no entregados · de{" "}
                  {emp.total} vencidos
                </p>
              </div>

              {/* Grade */}
              <div
                className={cn(
                  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold tabular-nums",
                  GRADE_COLOR[emp.grade] ?? "bg-ink-200 text-ink-700",
                )}
                title={`Compliance grade ${emp.grade}`}
              >
                {emp.grade}
              </div>
            </a>
          );
        })}
      </div>
    </Surface>
  );
}
