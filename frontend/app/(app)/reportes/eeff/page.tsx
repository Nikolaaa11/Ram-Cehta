/**
 * Reporte 6 — Estados Financieros del Portafolio.
 *
 * Server Component. Fetch en paralelo de los EEFF del año seleccionado
 * con filtros opcionales (empresa, tipo de EF, periodicidad) y el catálogo
 * de empresas para alimentar el select. Delega render a `<EEFFReportView />`.
 */
import { serverApiGet } from "@/lib/api/server";
import { EEFFReportView } from "@/components/reportes/EEFFReportView";
import type { EmpresaCatalogo, EstadoFinanciero } from "@/lib/api/schema";

export const metadata = {
  title: "Estados Financieros — Reportes Cehta Capital",
};

interface PageProps {
  searchParams: Promise<{
    empresa?: string;
    tipo_ef?: string;
    periodo_tipo?: string;
    año?: string;
    ano?: string;
  }>;
}

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await serverApiGet<T>(path);
  } catch {
    return null;
  }
}

function resolveYear(raw: string | undefined): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 2020 && n <= 2030) return n;
  return new Date().getFullYear();
}

export default async function ReporteEEFFPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  // Soportamos `año` (con tilde) y `ano` por compatibilidad con URLs sanitizadas.
  const year = resolveYear(sp.año ?? sp.ano);

  const params = new URLSearchParams();
  if (sp.empresa && sp.empresa !== "todas") {
    params.set("empresa_codigo", sp.empresa);
  }
  if (sp.tipo_ef && sp.tipo_ef !== "todos") {
    params.set("tipo_ef", sp.tipo_ef);
  }
  if (sp.periodo_tipo && sp.periodo_tipo !== "todos") {
    params.set("periodo_tipo", sp.periodo_tipo);
  }
  params.set("fecha_desde", `${year}-01-01`);
  params.set("fecha_hasta", `${year}-12-31`);

  const [eeff, empresas] = await Promise.all([
    safeGet<EstadoFinanciero[]>(`/estados-financieros?${params.toString()}`),
    safeGet<EmpresaCatalogo[]>("/catalogos/empresas"),
  ]);

  return (
    <EEFFReportView
      eeff={eeff ?? []}
      empresas={empresas ?? []}
      filters={{
        empresa: sp.empresa,
        tipo_ef: sp.tipo_ef,
        periodo_tipo: sp.periodo_tipo,
        año: String(year),
      }}
    />
  );
}
