"use client";

/**
 * EEFFReportView — render formal de los Estados Financieros consolidados.
 *
 * Layout en dos niveles:
 *   1. Matrix: empresas (filas) × períodos (columnas) — chequeo de
 *      completitud rápido, una celda por EEFF disponible.
 *   2. Lista detallada: row por EEFF con auditoría, aprobación y link
 *      al Dropbox.
 *
 * Filtros via URL (router.replace) + window.print() para PDF.
 */
import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import {
  CheckCircle2,
  ExternalLink,
  FileBarChart,
  Printer,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { ReportShell } from "@/components/reportes/ReportShell";
import { fmtDate, fmtInt } from "@/lib/reportes/format";
import { cn } from "@/lib/utils";
import { EMPRESA_COLOR } from "@/components/cartas-gantt/empresa-colors";
import type {
  EmpresaCatalogo,
  EstadoFinanciero,
  PeriodoTipo,
  TipoEf,
} from "@/lib/api/schema";

const EMPRESA_TODAS = "todas";
const TIPO_EF_TODOS = "todos";
const PERIODO_TODOS = "todos";

const TIPO_EF_OPTIONS: { value: string; label: string }[] = [
  { value: TIPO_EF_TODOS, label: "Todos los tipos" },
  { value: "balance", label: "Balance" },
  { value: "estado_resultados", label: "Estado de Resultados" },
  { value: "flujo_caja", label: "Flujo de Caja" },
  { value: "cambios_patrimonio", label: "Cambios en Patrimonio" },
  { value: "consolidado", label: "Consolidado" },
  { value: "notas", label: "Notas" },
];

const TIPO_EF_LABEL: Record<TipoEf, string> = {
  balance: "Balance",
  estado_resultados: "Estado de Resultados",
  flujo_caja: "Flujo de Caja",
  cambios_patrimonio: "Cambios Patrimonio",
  consolidado: "Consolidado",
  notas: "Notas",
};

const PERIODO_TIPO_OPTIONS: { value: string; label: string }[] = [
  { value: PERIODO_TODOS, label: "Todas las periodicidades" },
  { value: "mensual", label: "Mensual" },
  { value: "trimestral", label: "Trimestral" },
  { value: "semestral", label: "Semestral" },
  { value: "anual", label: "Anual" },
];

const PERIODO_TIPO_LABEL: Record<PeriodoTipo, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

interface Filters {
  empresa?: string;
  tipo_ef?: string;
  periodo_tipo?: string;
  año?: string;
}

interface Props {
  eeff: EstadoFinanciero[];
  empresas: EmpresaCatalogo[];
  filters: Filters;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function EEFFReportView({ eeff, empresas, filters }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const empresaValue =
    filters.empresa && filters.empresa !== "" ? filters.empresa : EMPRESA_TODAS;
  const tipoEfValue =
    filters.tipo_ef && filters.tipo_ef !== "" ? filters.tipo_ef : TIPO_EF_TODOS;
  const periodoTipoValue =
    filters.periodo_tipo && filters.periodo_tipo !== ""
      ? filters.periodo_tipo
      : PERIODO_TODOS;
  const yearValue = filters.año ?? String(new Date().getFullYear());

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const total = eeff.length;
    const auditados = eeff.filter((e) => e.auditado).length;
    const aprobados = eeff.filter((e) => e.aprobado_directorio).length;
    let pendientesAuditoria = 0;
    for (const e of eeff) {
      if (e.auditado) continue;
      const corte = new Date(e.fecha_corte);
      if (Number.isNaN(corte.getTime())) continue;
      const days = (today.getTime() - corte.getTime()) / MS_PER_DAY;
      if (days > 90) pendientesAuditoria += 1;
    }
    return { total, auditados, aprobados, pendientesAuditoria };
  }, [eeff]);

  // Matrix: filas = empresas presentes, columnas = períodos detectados.
  // Dentro de cada celda guardamos la lista de EEFF (un mismo período puede
  // tener Balance + Estado Resultados, etc.).
  const matrix = useMemo(() => {
    const rowSet = new Set<string>();
    const colSet = new Set<string>();
    const grid: Record<string, Record<string, EstadoFinanciero[]>> = {};
    for (const e of eeff) {
      rowSet.add(e.empresa_codigo);
      colSet.add(e.periodo);
      const row = grid[e.empresa_codigo] ?? {};
      const cell = row[e.periodo] ?? [];
      cell.push(e);
      row[e.periodo] = cell;
      grid[e.empresa_codigo] = row;
    }
    const rows = Array.from(rowSet).sort();
    const cols = Array.from(colSet).sort();
    return { rows, cols, grid };
  }, [eeff]);

  const empresaRazon = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of empresas) map.set(e.codigo, e.razon_social);
    return map;
  }, [empresas]);

  const detallado = useMemo(
    () =>
      [...eeff].sort((a, b) => {
        if (a.empresa_codigo !== b.empresa_codigo) {
          return a.empresa_codigo.localeCompare(b.empresa_codigo);
        }
        const da = new Date(a.fecha_corte).getTime();
        const db = new Date(b.fecha_corte).getTime();
        return db - da;
      }),
    [eeff],
  );

  function pushParams(next: URLSearchParams) {
    const qs = next.toString();
    startTransition(() => {
      router.replace((qs ? `/reportes/eeff?${qs}` : "/reportes/eeff") as Route);
    });
  }

  function update(key: string, value: string, tombstone?: string) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (!value || (tombstone && value === tombstone)) params.delete(key);
    else params.set(key, value);
    pushParams(params);
  }

  function handlePrint() {
    if (typeof window !== "undefined") window.print();
  }

  return (
    <ReportShell
      eyebrow="Reporte formal · Estados financieros consolidados"
      title="Estados Financieros del Portafolio"
      subtitle="Balance, Estado de Resultados y Flujo de Caja por empresa y período"
      actions={
        <button
          type="button"
          onClick={handlePrint}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-apple",
            "hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2",
          )}
        >
          <Printer className="h-4 w-4" strokeWidth={1.5} />
          Imprimir / PDF
        </button>
      }
      filters={
        <div
          className={cn(
            "flex flex-wrap items-end gap-3",
            pending && "opacity-70",
          )}
        >
          <FilterField label="Empresa">
            <select
              value={empresaValue}
              onChange={(e) => update("empresa", e.target.value, EMPRESA_TODAS)}
              className="h-9 rounded-lg border border-hairline bg-white px-3 text-sm text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green min-w-[200px]"
            >
              <option value={EMPRESA_TODAS}>Todas las empresas</option>
              {empresas.map((emp) => (
                <option key={emp.codigo} value={emp.codigo}>
                  {emp.codigo} — {emp.razon_social}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Tipo de EF">
            <select
              value={tipoEfValue}
              onChange={(e) => update("tipo_ef", e.target.value, TIPO_EF_TODOS)}
              className="h-9 rounded-lg border border-hairline bg-white px-3 text-sm text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green min-w-[200px]"
            >
              {TIPO_EF_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Periodicidad">
            <select
              value={periodoTipoValue}
              onChange={(e) =>
                update("periodo_tipo", e.target.value, PERIODO_TODOS)
              }
              className="h-9 rounded-lg border border-hairline bg-white px-3 text-sm text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green min-w-[180px]"
            >
              {PERIODO_TIPO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Año">
            <input
              type="number"
              min={2020}
              max={2030}
              value={yearValue}
              onChange={(e) => update("año", e.target.value)}
              className="h-9 w-24 rounded-lg border border-hairline bg-white px-3 text-sm text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green tabular-nums"
            />
          </FilterField>
        </div>
      }
    >
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiTile label="Total EEFF" value={fmtInt(stats.total)} />
        <KpiTile
          label="Auditados"
          value={fmtInt(stats.auditados)}
          tone="ok"
        />
        <KpiTile
          label="Aprobados directorio"
          value={fmtInt(stats.aprobados)}
          tone="ok"
        />
        <KpiTile
          label="Pendientes auditoría >90d"
          value={fmtInt(stats.pendientesAuditoria)}
          tone={stats.pendientesAuditoria > 0 ? "danger" : "ok"}
        />
      </div>

      {eeff.length === 0 ? (
        <Surface className="py-16 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
            <FileBarChart
              className="h-6 w-6 text-ink-300"
              strokeWidth={1.5}
            />
          </div>
          <p className="text-base font-semibold text-ink-900">
            Sin estados financieros para los filtros aplicados
          </p>
          <p className="mt-1 max-w-md mx-auto text-sm text-ink-500">
            Probá ampliar el rango (cambiando año, periodicidad o tipo de EF) o
            cargá los EEFF faltantes desde la consola de administración.
          </p>
          <Link
            href={"/admin/estados-financieros" as Route}
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
          >
            Ir a EEFF admin
          </Link>
        </Surface>
      ) : (
        <>
          {/* Matrix view */}
          <Surface padding="none" className="overflow-hidden">
            <div className="border-b border-hairline px-6 py-4">
              <h3 className="text-base font-semibold tracking-tight text-ink-900">
                Mapa de cumplimiento · {yearValue}
              </h3>
              <p className="text-xs text-ink-500">
                Verde = EEFF cargado para ese período · gris = falta
              </p>
            </div>
            <div className="overflow-x-auto p-4">
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-ink-500">
                      Empresa
                    </th>
                    {matrix.cols.map((p) => (
                      <th
                        key={p}
                        className="px-2 py-2 text-center font-medium text-ink-500 tabular-nums whitespace-nowrap"
                      >
                        {p}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.rows.map((codigo) => {
                    const color = EMPRESA_COLOR[codigo] ?? "#94a3b8";
                    return (
                      <tr key={codigo}>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span
                            className="inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-[11px] font-medium text-white"
                            style={{ backgroundColor: color }}
                          >
                            {codigo}
                          </span>
                          <span className="ml-2 text-ink-500">
                            {empresaRazon.get(codigo) ?? ""}
                          </span>
                        </td>
                        {matrix.cols.map((periodo) => {
                          const cell =
                            matrix.grid[codigo]?.[periodo] ?? [];
                          if (cell.length === 0) {
                            return (
                              <td
                                key={periodo}
                                className="px-2 py-2 text-center"
                              >
                                <span
                                  className="inline-block h-4 w-7 rounded bg-ink-100/60"
                                  title="Sin EEFF"
                                  aria-label="Sin EEFF"
                                />
                              </td>
                            );
                          }
                          // Si todas las celdas tienen Dropbox, linkeamos
                          // a la primera; sino mostramos check sin link.
                          const withLink = cell.find((e) => e.dropbox_path);
                          const tooltip = cell
                            .map(
                              (e) =>
                                `${TIPO_EF_LABEL[e.tipo_ef]} · ${PERIODO_TIPO_LABEL[e.periodo_tipo]}`,
                            )
                            .join(" / ");
                          return (
                            <td
                              key={periodo}
                              className="px-2 py-2 text-center"
                            >
                              {withLink && withLink.dropbox_path ? (
                                <a
                                  href={withLink.dropbox_path}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={tooltip}
                                  aria-label={`EEFF ${codigo} ${periodo} — abrir Dropbox`}
                                  className="inline-flex h-5 w-7 items-center justify-center rounded bg-positive/70 text-white transition-colors hover:bg-positive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
                                >
                                  <CheckCircle2
                                    className="h-3 w-3"
                                    strokeWidth={2}
                                  />
                                </a>
                              ) : (
                                <span
                                  className="inline-flex h-5 w-7 items-center justify-center rounded bg-positive/70 text-white"
                                  title={tooltip}
                                  aria-label={tooltip}
                                >
                                  <CheckCircle2
                                    className="h-3 w-3"
                                    strokeWidth={2}
                                  />
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Surface>

          {/* Lista detallada */}
          <Surface padding="none" className="overflow-hidden">
            <div className="border-b border-hairline px-6 py-4">
              <h3 className="text-base font-semibold tracking-tight text-ink-900">
                Detalle
              </h3>
              <p className="text-xs text-ink-500">
                Por empresa y fecha de corte (más recientes primero)
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-hairline text-sm">
                <thead className="bg-ink-100/40">
                  <tr>
                    <Th>Empresa</Th>
                    <Th>Tipo EF</Th>
                    <Th>Período</Th>
                    <Th>Periodicidad</Th>
                    <Th>Fecha corte</Th>
                    <Th align="center">Auditado</Th>
                    <Th>Auditor</Th>
                    <Th align="center">Aprobado</Th>
                    <Th>Dropbox</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {detallado.map((ef) => {
                    const color = EMPRESA_COLOR[ef.empresa_codigo] ?? "#94a3b8";
                    return (
                      <tr
                        key={ef.ef_id}
                        className="transition-colors duration-150 hover:bg-ink-100/30"
                      >
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className="inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-[11px] font-medium text-white"
                            style={{ backgroundColor: color }}
                          >
                            {ef.empresa_codigo}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-900">
                          {TIPO_EF_LABEL[ef.tipo_ef]}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <Badge variant="info">{ef.periodo}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                          {PERIODO_TIPO_LABEL[ef.periodo_tipo]}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-700">
                          {fmtDate(ef.fecha_corte)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-center">
                          {ef.auditado ? (
                            <CheckCircle2
                              className="mx-auto h-4 w-4 text-positive"
                              strokeWidth={1.75}
                              aria-label="Auditado"
                            />
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                          {ef.auditor ?? (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-center">
                          {ef.aprobado_directorio ? (
                            <CheckCircle2
                              className="mx-auto h-4 w-4 text-positive"
                              strokeWidth={1.75}
                              aria-label="Aprobado por directorio"
                            />
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {ef.dropbox_path ? (
                            <a
                              href={ef.dropbox_path}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-cehta-green hover:underline"
                            >
                              Abrir
                              <ExternalLink
                                className="h-3 w-3"
                                strokeWidth={1.5}
                              />
                            </a>
                          ) : (
                            <span className="text-xs text-ink-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Surface>
        </>
      )}
    </ReportShell>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
        {label}
      </span>
      {children}
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn" | "danger";
}) {
  return (
    <Surface padding="compact" className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
        {label}
      </span>
      <span
        className={cn("font-display text-3xl font-semibold tabular-nums", {
          "text-ink-900": tone === "neutral",
          "text-positive": tone === "ok",
          "text-warning": tone === "warn",
          "text-negative": tone === "danger",
        })}
      >
        {value}
      </span>
    </Surface>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-xs uppercase tracking-wide text-ink-500 font-medium",
        align === "right"
          ? "text-right"
          : align === "center"
            ? "text-center"
            : "text-left",
      )}
    >
      {children}
    </th>
  );
}
