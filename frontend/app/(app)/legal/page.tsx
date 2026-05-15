"use client";

/**
 * Legal vault — vista cross-empresa del portafolio.
 *
 * Aggregator del endpoint `GET /legal` (sin filtrar por empresa) con KPIs y
 * filtros para navegar al detalle por-empresa (`/empresa/{cod}/legal/{id}`).
 *
 * Apple-tier estético:
 *  - Hero editorial con eyebrow + display title + subtítulo
 *  - KPI strip (total · vigentes · vencen <30d · categorías)
 *  - Filtros minimalistas, tabla con badge de empresa coloreada
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Inbox, Search, Scale } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { AlertBadge } from "@/components/legal/AlertBadge";
import { ScopeIndicator } from "@/components/shared/ScopeIndicator";
import { RecentActivityFeed } from "@/components/shared/RecentActivityFeed";
import { EMPRESA_COLOR } from "@/components/cartas-gantt/empresa-colors";
import { toDate } from "@/lib/format";
import type { LegalDocumentListItem, Page } from "@/lib/api/schema";

const CATEGORIA_ITEMS: ComboboxItem[] = [
  { value: "", label: "Todas las categorías" },
  { value: "contrato", label: "Contrato" },
  { value: "acta", label: "Acta" },
  { value: "declaracion_sii", label: "Declaración SII" },
  { value: "regulatorio", label: "Regulatorio" },
  { value: "permiso", label: "Permiso" },
  { value: "poliza", label: "Póliza" },
  { value: "estatuto", label: "Estatuto" },
  { value: "otro", label: "Otro" },
];

const ESTADO_ITEMS: ComboboxItem[] = [
  { value: "", label: "Todos los estados" },
  { value: "vigente", label: "Vigente" },
  { value: "vencido", label: "Vencido" },
  { value: "archivado", label: "Archivado" },
];

const CATEGORIA_LABEL: Record<string, string> = {
  contrato: "Contrato",
  acta: "Acta",
  declaracion_sii: "Declaración SII",
  regulatorio: "Regulatorio",
  permiso: "Permiso",
  poliza: "Póliza",
  estatuto: "Estatuto",
  otro: "Otro",
};

const ESTADO_VARIANT: Record<
  string,
  "success" | "warning" | "danger" | "neutral"
> = {
  vigente: "success",
  vencido: "danger",
  archivado: "neutral",
  renovado: "neutral",
  cancelado: "neutral",
  borrador: "warning",
};

function colorFor(codigo: string): string {
  return EMPRESA_COLOR[codigo.toUpperCase()] ?? "#94a3b8";
}

export default function LegalPortafolioPage() {
  const { session } = useSession();
  const { data: empresas = [] } = useCatalogoEmpresas();

  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [categoria, setCategoria] = useState("");
  const [estado, setEstado] = useState("");
  const [search, setSearch] = useState("");

  const empresaItems: ComboboxItem[] = useMemo(
    () => [
      { value: "", label: "Todas las empresas" },
      ...[...empresas]
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
        .map((e) => ({
          value: e.codigo,
          label: `${e.codigo}${e.razon_social ? ` · ${e.razon_social}` : ""}`,
        })),
    ],
    [empresas],
  );

  const params = new URLSearchParams({ size: "200" });
  if (empresaCodigo) params.set("empresa_codigo", empresaCodigo);
  if (categoria) params.set("categoria", categoria);
  if (estado) params.set("estado", estado);
  if (search.trim()) params.set("search", search.trim());

  const queryKey = [
    "legal",
    "portfolio",
    empresaCodigo,
    categoria,
    estado,
    search,
  ];

  const { data, isLoading, error } = useQuery<Page<LegalDocumentListItem>>({
    queryKey,
    queryFn: () =>
      apiClient.get<Page<LegalDocumentListItem>>(
        `/legal?${params.toString()}`,
        session,
      ),
    enabled: !!session,
  });

  const items = data?.items ?? [];

  const kpis = useMemo(() => {
    const total = data?.total ?? items.length;
    const vigentes = items.filter((i) => i.estado === "vigente").length;
    const venceProx = items.filter(
      (i) => i.dias_para_vencer != null && i.dias_para_vencer >= 0 && i.dias_para_vencer <= 30,
    ).length;
    const cats = new Set(items.map((i) => i.categoria));
    return { total, vigentes, venceProx, categorias: cats.size };
  }, [items, data?.total]);

  const hasFilters = !!(empresaCodigo || categoria || estado || search.trim());

  return (
    <div className="mx-auto max-w-[1440px] space-y-8 px-6 py-6 lg:px-10">
      {/* Hero editorial */}
      <header className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
          Legal vault · Portafolio
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
            Documentos legales del portafolio
          </h1>
          <ScopeIndicator />
        </div>
        <p className="max-w-2xl text-base text-ink-500">
          Contratos, actas, pólizas y permisos de todas las empresas del portafolio
          con alertas de vencimiento y trazabilidad por categoría.
        </p>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total documentos" value={kpis.total} />
        <KpiCard label="Vigentes" value={kpis.vigentes} accent="positive" />
        <KpiCard
          label="Vencen en 30d"
          value={kpis.venceProx}
          accent={kpis.venceProx > 0 ? "warning" : "neutral"}
        />
        <KpiCard label="Categorías" value={kpis.categorias} />
      </div>

      {/* Filters */}
      <Surface>
        <div className="flex flex-wrap items-center gap-3">
          <Combobox
            items={empresaItems}
            value={empresaCodigo}
            onValueChange={setEmpresaCodigo}
            placeholder="Empresa"
            triggerClassName="min-w-[220px]"
          />
          <Combobox
            items={CATEGORIA_ITEMS}
            value={categoria}
            onValueChange={setCategoria}
            placeholder="Categoría"
            triggerClassName="min-w-[200px]"
          />
          <Combobox
            items={ESTADO_ITEMS}
            value={estado}
            onValueChange={setEstado}
            placeholder="Estado"
            triggerClassName="min-w-[180px]"
          />
          <div className="relative ml-auto min-w-[220px] max-w-sm flex-1">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-500"
              strokeWidth={1.5}
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre…"
              className="h-9 w-full rounded-xl border-0 bg-white pl-9 pr-3 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
        </div>
      </Surface>

      {/* Body */}
      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <Surface className="text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-negative/10 text-negative">
            <Scale className="h-6 w-6" strokeWidth={1.5} />
          </span>
          <p className="mt-3 text-base font-medium text-ink-900">
            No se pudieron cargar los documentos legales
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
        </Surface>
      )}

      {!isLoading && !error && items.length === 0 && (
        <Surface className="text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60 text-ink-500">
            <Inbox className="h-6 w-6" strokeWidth={1.5} />
          </span>
          <p className="mt-3 text-base font-medium text-ink-900">
            {hasFilters
              ? "Sin documentos que coincidan con los filtros"
              : "Aún no hay documentos legales cargados"}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {hasFilters
              ? "Probá ajustar empresa, categoría o estado."
              : "Cargá contratos, actas o pólizas desde la vista por empresa."}
          </p>
        </Surface>
      )}

      {!isLoading && !error && items.length > 0 && (
        <Surface padding="none">
          <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-hairline text-sm">
            <thead className="bg-ink-100/40 text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Empresa</th>
                <th className="px-4 py-3 text-left font-medium">Nombre</th>
                <th className="px-4 py-3 text-left font-medium">Categoría</th>
                <th className="px-4 py-3 text-left font-medium">Vigencia</th>
                <th className="px-4 py-3 text-left font-medium">Estado</th>
                <th className="px-4 py-3 text-right font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {items.map((d) => {
                const empColor = colorFor(d.empresa_codigo);
                const venceProx =
                  d.dias_para_vencer != null &&
                  d.dias_para_vencer >= 0 &&
                  d.dias_para_vencer <= 30;
                return (
                  <tr
                    key={d.documento_id}
                    className="group transition-colors duration-150 hover:bg-ink-100/30"
                  >
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium tracking-tight"
                        style={{
                          backgroundColor: `${empColor}1A`,
                          color: empColor,
                        }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: empColor }}
                        />
                        {d.empresa_codigo}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-ink-900">
                      {d.nombre}
                    </td>
                    <td className="px-4 py-3 text-ink-700">
                      {CATEGORIA_LABEL[d.categoria] ?? d.categoria}
                      {d.subcategoria && (
                        <span className="ml-1 text-xs text-ink-500">
                          · {d.subcategoria}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {d.fecha_vigencia_hasta ? (
                        <div className="flex flex-col gap-1">
                          <span
                            className={
                              venceProx
                                ? "tabular-nums text-xs font-semibold text-warning"
                                : "tabular-nums text-xs text-ink-500"
                            }
                          >
                            {toDate(d.fecha_vigencia_hasta)}
                          </span>
                          <AlertBadge
                            nivel={d.alerta_nivel}
                            diasParaVencer={d.dias_para_vencer}
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-ink-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={ESTADO_VARIANT[d.estado] ?? "neutral"}>
                        {d.estado}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/empresa/${d.empresa_codigo}/legal`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
                      >
                        Ver
                        <ChevronRight
                          className="h-3.5 w-3.5"
                          strokeWidth={1.75}
                        />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Surface>
      )}

      {/* V5++ ola CD: bitácora de cambios en documentos legales */}
      <RecentActivityFeed
        entityType="legal_document"
        title="Actividad reciente · Documentos legales"
        limit={15}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent = "neutral",
}: {
  label: string;
  value: number;
  accent?: "neutral" | "positive" | "warning";
}) {
  const accentClass =
    accent === "positive"
      ? "text-positive"
      : accent === "warning"
        ? "text-warning"
        : "text-ink-900";
  return (
    <Surface padding="compact">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
        {label}
      </p>
      <p
        className={`mt-2 font-display text-2xl font-semibold tabular-nums tracking-tight ${accentClass}`}
      >
        {value}
      </p>
    </Surface>
  );
}
