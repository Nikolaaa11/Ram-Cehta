/**
 * Reporte 4 — Compliance Tributario.
 *
 * Server Component. Fetch all F29 de los últimos 12 meses y arma el reporte
 * con counters por empresa (vencidas / próximas / pagadas).
 */
import { serverApiGet } from "@/lib/api/server";
import { TributarioReportView } from "@/components/reportes/TributarioReportView";
import type { F29Read, Page as ApiPage, EmpresaCatalogo } from "@/lib/api/schema";

export const metadata = {
  title: "Compliance Tributario — Reportes Cehta Capital",
};

interface PageProps {
  searchParams: Promise<{ empresa?: string }>;
}

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await serverApiGet<T>(path);
  } catch {
    return null;
  }
}

async function fetchAllF29(empresa?: string): Promise<F29Read[]> {
  const items: F29Read[] = [];
  let page = 1;
  const MAX_PAGES = 30;
  while (page <= MAX_PAGES) {
    const params = new URLSearchParams({ page: String(page), size: "100" });
    if (empresa) params.set("empresa_codigo", empresa);
    const res = await safeGet<ApiPage<F29Read>>(`/f29?${params.toString()}`);
    if (!res || res.items.length === 0) break;
    items.push(...res.items);
    if (page >= res.pages) break;
    page += 1;
  }
  return items;
}

export default async function ReporteTributarioPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const [items, empresas] = await Promise.all([
    fetchAllF29(sp.empresa),
    safeGet<EmpresaCatalogo[]>("/catalogos/empresas"),
  ]);

  // Filtrar últimos 12 meses para no inflar el reporte.
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  const recent = items.filter((f) => new Date(f.fecha_vencimiento) >= cutoff);

  return (
    <TributarioReportView
      items={recent}
      empresas={empresas ?? []}
      filters={{ empresa: sp.empresa }}
    />
  );
}
