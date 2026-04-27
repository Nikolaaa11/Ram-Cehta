/**
 * Reporte 3 — Suscripciones de Acciones FIP CEHTA ESG.
 *
 * Server Component. Llama a `/suscripciones-acciones` (paginado, fetch all)
 * y `/suscripciones-acciones/totals`. Si los endpoints aún no existen
 * (otro agente está construyéndolos), tolerar el fallo y mostrar empty state.
 */
import { serverApiGet } from "@/lib/api/server";
import { SuscripcionesReportView } from "@/components/reportes/SuscripcionesReportView";
import type { Page as ApiPage } from "@/lib/api/schema";
import type { SuscripcionAccion, SuscripcionTotals } from "@/lib/reportes/types";

export const metadata = {
  title: "Suscripciones de Acciones — Reportes Cehta Capital",
};

interface PageProps {
  searchParams: Promise<{ empresa?: string; anio?: string }>;
}

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await serverApiGet<T>(path);
  } catch {
    return null;
  }
}

async function fetchAllSuscripciones(filters: {
  empresa?: string;
  anio?: string;
}): Promise<SuscripcionAccion[]> {
  const items: SuscripcionAccion[] = [];
  let page = 1;
  // Tope defensivo — los inversionistas casi nunca tendrán >2000 suscripciones.
  const MAX_PAGES = 20;
  while (page <= MAX_PAGES) {
    const params = new URLSearchParams({ page: String(page), size: "100" });
    if (filters.empresa) params.set("empresa_codigo", filters.empresa);
    if (filters.anio) params.set("anio", filters.anio);
    const res = await safeGet<ApiPage<SuscripcionAccion>>(
      `/suscripciones-acciones?${params.toString()}`,
    );
    if (!res || res.items.length === 0) break;
    items.push(...res.items);
    if (page >= res.pages) break;
    page += 1;
  }
  return items;
}

export default async function ReporteSuscripcionesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filters = { empresa: sp.empresa, anio: sp.anio };

  const totalsParams = new URLSearchParams();
  if (filters.empresa) totalsParams.set("empresa_codigo", filters.empresa);
  if (filters.anio) totalsParams.set("anio", filters.anio);
  const totalsQs = totalsParams.toString();

  const [items, totals] = await Promise.all([
    fetchAllSuscripciones(filters),
    safeGet<SuscripcionTotals>(`/suscripciones-acciones/totals${totalsQs ? `?${totalsQs}` : ""}`),
  ]);

  return (
    <SuscripcionesReportView
      initialItems={items}
      initialTotals={totals}
      filters={filters}
    />
  );
}
