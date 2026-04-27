"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { saveAs } from "file-saver";
import { ExternalLink, Receipt } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { ReportShell } from "@/components/reportes/ReportShell";
import { ReportActionsBar } from "@/components/reportes/ReportActionsBar";
import { fmtCLP, fmtDate, fmtFileTimestamp, fmtInt } from "@/lib/reportes/format";
import { cn } from "@/lib/utils";
import type { EmpresaCatalogo, F29Read } from "@/lib/api/schema";

const renderTributarioPdf = () =>
  import("@/components/reportes/pdf/TributarioPDF").then((m) => m.renderTributarioPdf);

const EMPRESA_TODAS = "__todas__";

const ESTADO_VARIANT: Record<string, BadgeProps["variant"]> = {
  pendiente: "warning",
  pagado: "success",
  vencido: "danger",
  exento: "neutral",
};

interface Props {
  items: F29Read[];
  empresas: EmpresaCatalogo[];
  filters: { empresa?: string };
}

interface EmpresaCounters {
  empresa: string;
  pendientes: number;
  vencidas: number;
  proximas30d: number;
  pagadas: number;
  monto_pendiente: number;
}

function isVencida(f: F29Read, today: Date): boolean {
  if (f.estado === "pagado" || f.estado === "exento") return false;
  return new Date(f.fecha_vencimiento) < today;
}
function isProxima30d(f: F29Read, today: Date): boolean {
  if (f.estado === "pagado" || f.estado === "exento") return false;
  const v = new Date(f.fecha_vencimiento);
  const diff = (v.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 30;
}

export function TributarioReportView({ items, empresas, filters }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const empresaItems = useMemo<ComboboxItem[]>(() => {
    const list: ComboboxItem[] = [{ value: EMPRESA_TODAS, label: "Todas las empresas" }];
    for (const e of empresas) list.push({ value: e.codigo, label: `${e.codigo} — ${e.razon_social}` });
    return list;
  }, [empresas]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const counters = useMemo<EmpresaCounters[]>(() => {
    const map = new Map<string, EmpresaCounters>();
    for (const f of items) {
      const c = map.get(f.empresa_codigo) ?? {
        empresa: f.empresa_codigo,
        pendientes: 0,
        vencidas: 0,
        proximas30d: 0,
        pagadas: 0,
        monto_pendiente: 0,
      };
      if (f.estado === "pagado") c.pagadas += 1;
      else if (f.estado === "pendiente" || f.estado === "vencido") c.pendientes += 1;
      if (isVencida(f, today)) c.vencidas += 1;
      if (isProxima30d(f, today)) c.proximas30d += 1;
      if (f.estado !== "pagado" && f.estado !== "exento") {
        c.monto_pendiente += Number(f.monto_a_pagar ?? 0);
      }
      map.set(f.empresa_codigo, c);
    }
    return Array.from(map.values()).sort((a, b) => b.vencidas - a.vencidas || b.pendientes - a.pendientes);
  }, [items, today]);

  const totals = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);
    let pagadasMes = 0;
    let vencidas = 0;
    let proximas30d = 0;
    for (const f of items) {
      if (f.estado === "pagado" && f.fecha_pago) {
        const fp = new Date(f.fecha_pago);
        if (fp >= monthStart && fp < monthEnd) pagadasMes += 1;
      }
      if (isVencida(f, today)) vencidas += 1;
      if (isProxima30d(f, today)) proximas30d += 1;
    }
    return { pagadasMes, vencidas, proximas30d, total: items.length };
  }, [items, today]);

  function updateEmpresa(value: string | null) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (!value || value === EMPRESA_TODAS) params.delete("empresa");
    else params.set("empresa", value);
    startTransition(() => {
      const qs = params.toString();
      router.replace(
        (qs ? `/reportes/tributario?${qs}` : "/reportes/tributario") as Route,
      );
    });
  }

  async function handleDownload() {
    try {
      setLoading(true);
      setPdfError(null);
      const render = await renderTributarioPdf();
      const blob = await render({ items, counters, totals, filters, generatedAt: new Date() });
      saveAs(blob, `cehta-reporte-tributario-${fmtFileTimestamp()}.pdf`);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "No se pudo generar el PDF.");
    } finally {
      setLoading(false);
    }
  }

  // Heatmap: empresas (filas) × últimos 12 meses (cols).
  const heatmap = useMemo(() => {
    const months: { key: string; label: string }[] = [];
    const ref = new Date();
    ref.setDate(1);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(ref);
      d.setMonth(d.getMonth() - i);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("es-CL", { month: "short" }).replace(".", ""),
      });
    }
    const empresaCodigos = Array.from(new Set(items.map((f) => f.empresa_codigo))).sort();
    const grid: Record<string, Record<string, F29Read[]>> = {};
    for (const codigo of empresaCodigos) grid[codigo] = {};
    for (const f of items) {
      const v = new Date(f.fecha_vencimiento);
      const key = `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}`;
      const empresaCell = grid[f.empresa_codigo] ?? {};
      const list = empresaCell[key] ?? [];
      list.push(f);
      empresaCell[key] = list;
      grid[f.empresa_codigo] = empresaCell;
    }
    return { months, empresas: empresaCodigos, grid };
  }, [items]);

  const empresaValue = filters.empresa ?? EMPRESA_TODAS;

  return (
    <ReportShell
      title="Compliance Tributario"
      subtitle="Estado de obligaciones F29 por empresa · últimos 12 meses"
      actions={<ReportActionsBar onDownloadPdf={handleDownload} pdfLoading={loading} pdfError={pdfError} />}
      filters={
        <Surface variant="glass" padding="compact">
          <div className={cn("flex flex-wrap items-end gap-3", pending && "opacity-70")}>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-ink-500 font-medium">Empresa</span>
              <Combobox
                items={empresaItems}
                value={empresaValue}
                onValueChange={(v) => updateEmpresa(v)}
                placeholder="Todas las empresas"
                searchPlaceholder="Buscar empresa…"
                emptyText="Sin empresas."
                triggerClassName="w-64"
              />
            </div>
          </div>
        </Surface>
      }
    >
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <RollupCard label="F29 pagadas mes" value={fmtInt(totals.pagadasMes)} tone="ok" />
        <RollupCard label="F29 vencidas" value={fmtInt(totals.vencidas)} tone={totals.vencidas > 0 ? "danger" : "ok"} />
        <RollupCard label="Próximas 30d" value={fmtInt(totals.proximas30d)} tone={totals.proximas30d > 0 ? "warn" : "ok"} />
        <RollupCard label="Total registros" value={fmtInt(totals.total)} />
      </div>

      {/* Heatmap */}
      {heatmap.empresas.length > 0 ? (
        <Surface padding="none" className="overflow-hidden">
          <div className="border-b border-hairline px-6 py-4">
            <h3 className="text-base font-semibold tracking-tight text-ink-900">Mapa de cumplimiento</h3>
            <p className="text-xs text-ink-500">Verde = pagado · ámbar = pendiente · rojo = vencido · gris = sin obligación</p>
          </div>
          <div className="overflow-x-auto p-4">
            <table className="min-w-full text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left font-medium text-ink-500">Empresa</th>
                  {heatmap.months.map((m) => (
                    <th key={m.key} className="px-1 py-1 text-center font-medium text-ink-500 capitalize tabular-nums">{m.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.empresas.map((codigo) => (
                  <tr key={codigo}>
                    <td className="px-2 py-1 font-medium text-ink-900 whitespace-nowrap">{codigo}</td>
                    {heatmap.months.map((m) => {
                      const cellList = heatmap.grid[codigo]?.[m.key] ?? [];
                      const cell = cellList[0];
                      let bg = "bg-ink-100/60";
                      let title = "Sin obligación";
                      if (cell) {
                        if (cell.estado === "pagado") {
                          bg = "bg-positive/70";
                          title = `Pagado · ${fmtCLP(cell.monto_a_pagar)}`;
                        } else if (isVencida(cell, today)) {
                          bg = "bg-negative/70";
                          title = `Vencido · ${fmtCLP(cell.monto_a_pagar)}`;
                        } else {
                          bg = "bg-warning/70";
                          title = `Pendiente · ${fmtCLP(cell.monto_a_pagar)}`;
                        }
                      }
                      return (
                        <td key={m.key} className="px-1 py-1">
                          <span
                            className={cn("block h-4 w-7 rounded", bg)}
                            title={`${codigo} ${m.label} · ${title}`}
                            aria-label={title}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      ) : null}

      {/* Counters por empresa */}
      <Surface padding="none" className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-ink-900">Resumen por empresa</h3>
            <p className="text-xs text-ink-500">Counters consolidados</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-hairline text-sm">
            <thead className="bg-ink-100/40">
              <tr>
                <Th>Empresa</Th>
                <Th align="right">Pendientes</Th>
                <Th align="right">Vencidas</Th>
                <Th align="right">Próx. 30d</Th>
                <Th align="right">Pagadas</Th>
                <Th align="right">Monto pend.</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {counters.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-ink-500">
                    Sin obligaciones tributarias registradas.
                  </td>
                </tr>
              ) : (
                counters.map((c) => (
                  <tr key={c.empresa} className="transition-colors duration-150 hover:bg-ink-100/30">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-ink-900">{c.empresa}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-700">{fmtInt(c.pendientes)}</td>
                    <td className={cn("whitespace-nowrap px-4 py-3 text-right tabular-nums", c.vencidas > 0 ? "text-negative font-semibold" : "text-ink-700")}>
                      {fmtInt(c.vencidas)}
                    </td>
                    <td className={cn("whitespace-nowrap px-4 py-3 text-right tabular-nums", c.proximas30d > 0 ? "text-warning" : "text-ink-700")}>
                      {fmtInt(c.proximas30d)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-positive">{fmtInt(c.pagadas)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-900">{fmtCLP(c.monto_pendiente)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Surface>

      {/* Tabla detalle */}
      {items.length === 0 ? (
        <Surface className="py-16 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
            <Receipt className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
          </div>
          <p className="text-base font-semibold text-ink-900">Sin obligaciones F29</p>
          <p className="mt-1 text-sm text-ink-500">Aún no hay registros en los últimos 12 meses.</p>
        </Surface>
      ) : (
        <Surface padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-hairline text-sm">
              <thead className="bg-ink-100/40">
                <tr>
                  <Th>Empresa</Th>
                  <Th>Período</Th>
                  <Th>Vencimiento</Th>
                  <Th align="right">Monto</Th>
                  <Th>Estado</Th>
                  <Th>Fecha pago</Th>
                  <Th>Comprobante</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {items.map((f) => {
                  const variant = ESTADO_VARIANT[f.estado] ?? "neutral";
                  return (
                    <tr key={f.f29_id} className="transition-colors duration-150 hover:bg-ink-100/30">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-ink-900">{f.empresa_codigo}</td>
                      <td className="whitespace-nowrap px-4 py-3"><Badge variant="info">{f.periodo_tributario}</Badge></td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-700">{fmtDate(f.fecha_vencimiento)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-900">{fmtCLP(f.monto_a_pagar)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge variant={variant}>{f.estado.charAt(0).toUpperCase() + f.estado.slice(1)}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-700">{fmtDate(f.fecha_pago)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {f.comprobante_url ? (
                          <a
                            href={f.comprobante_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-cehta-green hover:underline"
                          >
                            Ver comprobante
                            <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                          </a>
                        ) : (
                          <span className="text-xs text-ink-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Surface>
      )}
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

function RollupCard({
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
      <span className="text-xs uppercase tracking-wide text-ink-500 font-medium">{label}</span>
      <span
        className={cn("text-kpi-sm tabular-nums", {
          "text-positive": tone === "ok",
          "text-warning": tone === "warn",
          "text-negative": tone === "danger",
          "text-ink-900": tone === "neutral",
        })}
      >
        {value}
      </span>
    </Surface>
  );
}
