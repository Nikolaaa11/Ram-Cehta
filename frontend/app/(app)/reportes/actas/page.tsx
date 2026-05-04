/**
 * Reporte 5 — Actas formales del FIP CEHTA.
 *
 * Server Component. Hace fetch de actas con filtros opcionales (tipo de
 * órgano, rango de fechas) y delega el render a `<ActasReportView />`.
 * Si el endpoint falla, mostramos el report con estado vacío sin abortar
 * la UI.
 */
import { serverApiGet } from "@/lib/api/server";
import { ActasReportView } from "@/components/reportes/ActasReportView";
import type { FondoActa } from "@/lib/api/schema";

export const metadata = {
  title: "Actas del Fondo — Reportes Cehta Capital",
};

interface PageProps {
  searchParams: Promise<{
    tipo_organo?: string;
    desde?: string;
    hasta?: string;
  }>;
}

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await serverApiGet<T>(path);
  } catch {
    return null;
  }
}

export default async function ReporteActasPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const params = new URLSearchParams();
  if (sp.tipo_organo && sp.tipo_organo !== "todos") {
    params.set("tipo_organo", sp.tipo_organo);
  }
  if (sp.desde) params.set("fecha_desde", sp.desde);
  if (sp.hasta) params.set("fecha_hasta", sp.hasta);

  const path = `/fondo-actas${params.toString() ? `?${params.toString()}` : ""}`;
  const [actas] = await Promise.all([safeGet<FondoActa[]>(path)]);

  return (
    <ActasReportView
      actas={actas ?? []}
      tipoOrgano={sp.tipo_organo}
      desde={sp.desde}
      hasta={sp.hasta}
    />
  );
}
