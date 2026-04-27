"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { saveAs } from "file-saver";
import { ExternalLink, Users } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { ReportShell } from "@/components/reportes/ReportShell";
import { ReportActionsBar } from "@/components/reportes/ReportActionsBar";
import { fmtCLP, fmtDate, fmtFileTimestamp, fmtInt, fmtUF } from "@/lib/reportes/format";
import { cn } from "@/lib/utils";
import type { SuscripcionAccion, SuscripcionTotals } from "@/lib/reportes/types";

const renderSuscripcionesPdf = () =>
  import("@/components/reportes/pdf/SuscripcionesPDF").then((m) => m.renderSuscripcionesPdf);

const EMPRESA_TODAS = "__todas__";
const ANIO_TODOS = "__todos__";

interface Props {
  initialItems: SuscripcionAccion[];
  initialTotals: SuscripcionTotals | null;
  filters: { empresa?: string; anio?: string };
}

export function SuscripcionesReportView({ initialItems, initialTotals, filters }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const { data: empresas = [] } = useCatalogoEmpresas();

  const empresaItems = useMemo<ComboboxItem[]>(() => {
    const list: ComboboxItem[] = [{ value: EMPRESA_TODAS, label: "Todas las empresas" }];
    for (const e of empresas) list.push({ value: e.codigo, label: `${e.codigo} — ${e.razon_social}` });
    return list;
  }, [empresas]);

  const aniosFromData = useMemo(() => {
    const set = new Set<string>();
    for (const it of initialItems) {
      if (it.fecha_recibo) set.add(new Date(it.fecha_recibo).getFullYear().toString());
    }
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= currentYear - 4; y--) set.add(String(y));
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [initialItems]);

  const anioItems = useMemo<ComboboxItem[]>(
    () => [{ value: ANIO_TODOS, label: "Todos los años" }, ...aniosFromData.map((a) => ({ value: a, label: a }))],
    [aniosFromData],
  );

  // Totals: si el endpoint dedicado falló, calcular en client desde items.
  const totals = useMemo<SuscripcionTotals>(() => {
    if (initialTotals) return initialTotals;
    let acciones = 0;
    let clp = 0;
    let uf = 0;
    const contratos = new Set<string>();
    for (const it of initialItems) {
      acciones += it.acciones_pagadas;
      clp += Number(it.monto_clp ?? 0);
      uf += Number(it.monto_uf ?? 0);
      if (it.contrato_ref) contratos.add(it.contrato_ref);
    }
    return {
      total_acciones: acciones,
      total_clp: String(clp),
      total_uf: String(uf),
      total_contratos: contratos.size,
    };
  }, [initialItems, initialTotals]);

  function updateFilter(key: "empresa" | "anio", value: string | null) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    if (!value || value === EMPRESA_TODAS || value === ANIO_TODOS) params.delete(key);
    else params.set(key, value);
    startTransition(() => {
      const qs = params.toString();
      router.replace(
        (qs ? `/reportes/suscripciones?${qs}` : "/reportes/suscripciones") as Route,
      );
    });
  }

  async function handleDownload() {
    try {
      setLoading(true);
      setPdfError(null);
      const render = await renderSuscripcionesPdf();
      const blob = await render({ items: initialItems, totals, filters, generatedAt: new Date() });
      saveAs(blob, `cehta-reporte-suscripciones-${fmtFileTimestamp()}.pdf`);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "No se pudo generar el PDF.");
    } finally {
      setLoading(false);
    }
  }

  const empresaValue = filters.empresa ?? EMPRESA_TODAS;
  const anioValue = filters.anio ?? ANIO_TODOS;

  return (
    <ReportShell
      title="Suscripciones de Acciones"
      subtitle="Acciones FIP CEHTA ESG suscritas por inversionistas"
      actions={<ReportActionsBar onDownloadPdf={handleDownload} pdfLoading={loading} pdfError={pdfError} />}
      filters={
        <Surface variant="glass" padding="compact">
          <div className={cn("flex flex-wrap items-end gap-3", pending && "opacity-70")}>
            <FilterField label="Empresa">
              <Combobox
                items={empresaItems}
                value={empresaValue}
                onValueChange={(v) => updateFilter("empresa", v)}
                placeholder="Todas las empresas"
                searchPlaceholder="Buscar empresa…"
                emptyText="Sin empresas."
                triggerClassName="w-64"
              />
            </FilterField>
            <FilterField label="Año">
              <Combobox
                items={anioItems}
                value={anioValue}
                onValueChange={(v) => updateFilter("anio", v)}
                placeholder="Todos los años"
                searchPlaceholder="Buscar año…"
                emptyText="Sin años."
                triggerClassName="w-40"
              />
            </FilterField>
          </div>
        </Surface>
      }
    >
      {/* Totales */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <RollupCard label="Acciones suscritas" value={fmtInt(totals.total_acciones)} />
        <RollupCard label="Total CLP" value={fmtCLP(totals.total_clp)} />
        <RollupCard label="Total UF" value={fmtUF(Number(totals.total_uf))} />
        <RollupCard label="Contratos" value={fmtInt(totals.total_contratos)} />
      </div>

      {/* Tabla */}
      {initialItems.length === 0 ? (
        <Surface className="py-16 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
            <Users className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
          </div>
          <p className="text-base font-semibold text-ink-900">Sin suscripciones registradas</p>
          <p className="mt-1 text-sm text-ink-500">
            Aún no hay acciones FIP CEHTA ESG suscritas para el filtro seleccionado.
          </p>
        </Surface>
      ) : (
        <Surface padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-hairline text-sm">
              <thead className="bg-ink-100/40">
                <tr>
                  <Th>Fecha recibo</Th>
                  <Th>Empresa</Th>
                  <Th align="right">Acciones</Th>
                  <Th align="right">UF</Th>
                  <Th align="right">CLP</Th>
                  <Th>Contrato</Th>
                  <Th>Firmado</Th>
                  <Th>Recibo</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {initialItems.map((it) => (
                  <tr key={it.suscripcion_id} className="transition-colors duration-150 hover:bg-ink-100/30">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-700">{fmtDate(it.fecha_recibo)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-ink-900">{it.empresa_codigo}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-900">{fmtInt(it.acciones_pagadas)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-700">{fmtUF(Number(it.monto_uf ?? 0))}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-ink-900">{fmtCLP(it.monto_clp)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-700">{it.contrato_ref ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge variant={it.firmado ? "success" : "warning"}>{it.firmado ? "Firmado" : "Pendiente"}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {it.recibo_url ? (
                        <a
                          href={it.recibo_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-cehta-green hover:underline"
                        >
                          Ver recibo
                          <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                        </a>
                      ) : (
                        <span className="text-xs text-ink-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}
    </ReportShell>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wide text-ink-500 font-medium">{label}</span>
      {children}
    </div>
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

function RollupCard({ label, value }: { label: string; value: string }) {
  return (
    <Surface padding="compact" className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wide text-ink-500 font-medium">{label}</span>
      <span className="text-kpi-sm tabular-nums text-ink-900">{value}</span>
    </Surface>
  );
}
