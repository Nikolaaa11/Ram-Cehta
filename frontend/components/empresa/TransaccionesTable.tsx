"use client";

import * as React from "react";
import { Download, ExternalLink, Filter } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { toCLP, toDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TransaccionRecienteItem } from "@/lib/api/schema";

/**
 * Tabla de últimas transacciones — feed paginado con filtros locales.
 * Apple polish: ring-hairline, tabular-nums, hover apenas perceptible.
 */
export interface TransaccionesTableProps {
  data: TransaccionRecienteItem[];
}

function uniq(values: (string | null | undefined)[]): string[] {
  return Array.from(
    new Set(values.filter((v): v is string => !!v && v.trim() !== "")),
  ).sort((a, b) => a.localeCompare(b, "es-CL"));
}

function toCsv(rows: TransaccionRecienteItem[]): string {
  const head = [
    "movimiento_id",
    "fecha",
    "descripcion",
    "abono",
    "egreso",
    "saldo_contable",
    "concepto_general",
    "concepto_detallado",
    "proyecto",
    "real_proyectado",
    "hipervinculo",
  ].join(",");
  const lines = rows.map((r) =>
    [
      r.movimiento_id,
      r.fecha,
      `"${(r.descripcion ?? "").replace(/"/g, '""')}"`,
      r.abono,
      r.egreso,
      r.saldo_contable ?? "",
      r.concepto_general ?? "",
      r.concepto_detallado ?? "",
      r.proyecto ?? "",
      r.real_proyectado ?? "",
      r.hipervinculo ?? "",
    ].join(","),
  );
  return `${head}\n${lines.join("\n")}`;
}

export function TransaccionesTable({ data }: TransaccionesTableProps) {
  const [proyecto, setProyecto] = React.useState<string>("");
  const [concepto, setConcepto] = React.useState<string>("");
  const [busqueda, setBusqueda] = React.useState<string>("");

  const proyectos = React.useMemo(
    () => uniq(data.map((t) => t.proyecto)),
    [data],
  );
  const conceptos = React.useMemo(
    () => uniq(data.map((t) => t.concepto_general)),
    [data],
  );

  const filtered = React.useMemo(() => {
    return data.filter((t) => {
      if (proyecto && t.proyecto !== proyecto) return false;
      if (concepto && t.concepto_general !== concepto) return false;
      if (busqueda) {
        const needle = busqueda.toLowerCase();
        const haystack = `${t.descripcion ?? ""} ${t.proyecto ?? ""} ${
          t.concepto_general ?? ""
        }`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [data, proyecto, concepto, busqueda]);

  const handleExport = React.useCallback(() => {
    const blob = new Blob([toCsv(filtered)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transacciones_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  return (
    <Surface aria-label="Tabla de transacciones recientes">
      <Surface.Header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-1">
          <Surface.Title>Últimas Transacciones</Surface.Title>
          <Surface.Subtitle>
            {filtered.length} de {data.length}{" "}
            {data.length === 1 ? "transacción" : "transacciones"}
          </Surface.Subtitle>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
            <Filter className="h-3.5 w-3.5" strokeWidth={1.5} />
            Filtros
          </span>
          <input
            type="text"
            placeholder="Buscar descripción..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="h-8 w-44 rounded-lg border border-hairline bg-white px-3 text-xs text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
          <select
            value={proyecto}
            onChange={(e) => setProyecto(e.target.value)}
            className="h-8 rounded-lg border border-hairline bg-white px-2 text-xs text-ink-900 focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <option value="">Todos los proyectos</option>
            {proyectos.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            className="h-8 rounded-lg border border-hairline bg-white px-2 text-xs text-ink-900 focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <option value="">Todos los conceptos</option>
            {conceptos.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-cehta-green/10 px-3 text-xs font-medium text-cehta-green transition-colors hover:bg-cehta-green/20"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
            CSV
          </button>
        </div>
      </Surface.Header>

      <Surface.Body className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-[11px] font-medium uppercase tracking-wide text-ink-500">
              <th className="py-2 pr-4 font-medium">Fecha</th>
              <th className="py-2 pr-4 font-medium">Descripción</th>
              <th className="py-2 pr-4 text-right font-medium">Abono</th>
              <th className="py-2 pr-4 text-right font-medium">Egreso</th>
              <th className="py-2 pr-4 text-right font-medium">Saldo</th>
              <th className="py-2 pr-4 font-medium">Concepto</th>
              <th className="py-2 pr-4 font-medium">Proyecto</th>
              <th className="py-2 font-medium">Doc.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {filtered.map((t) => {
              const eg = Number(t.egreso);
              const ab = Number(t.abono);
              return (
                <tr
                  key={t.movimiento_id}
                  className="transition-colors duration-150 ease-apple hover:bg-ink-100/30"
                >
                  <td className="py-3 pr-4 whitespace-nowrap tabular-nums text-ink-700">
                    {toDate(t.fecha)}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="block max-w-[280px] truncate text-ink-900">
                      {t.descripcion ?? "—"}
                    </span>
                    {t.real_proyectado && (
                      <Badge
                        variant={
                          t.real_proyectado === "Real" ? "neutral" : "info"
                        }
                        className="mt-1"
                      >
                        {t.real_proyectado}
                      </Badge>
                    )}
                  </td>
                  <td
                    className={cn(
                      "py-3 pr-4 text-right tabular-nums",
                      ab > 0 ? "text-positive" : "text-ink-300",
                    )}
                  >
                    {ab > 0 ? toCLP(ab) : "—"}
                  </td>
                  <td
                    className={cn(
                      "py-3 pr-4 text-right tabular-nums",
                      eg > 0 ? "text-negative" : "text-ink-300",
                    )}
                  >
                    {eg > 0 ? toCLP(eg) : "—"}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink-700">
                    {t.saldo_contable !== null && t.saldo_contable !== undefined
                      ? toCLP(t.saldo_contable)
                      : "—"}
                  </td>
                  <td className="py-3 pr-4 text-ink-700">
                    {t.concepto_general ?? "—"}
                  </td>
                  <td className="py-3 pr-4 text-ink-700">
                    {t.proyecto ?? "—"}
                  </td>
                  <td className="py-3">
                    {t.hipervinculo ? (
                      <a
                        href={t.hipervinculo}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100/60 hover:text-cehta-green"
                        aria-label="Abrir respaldo"
                      >
                        <ExternalLink
                          className="h-3.5 w-3.5"
                          strokeWidth={1.5}
                        />
                      </a>
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="py-8 text-center text-sm text-ink-500"
                >
                  Sin transacciones que coincidan con los filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Surface.Body>
    </Surface>
  );
}
