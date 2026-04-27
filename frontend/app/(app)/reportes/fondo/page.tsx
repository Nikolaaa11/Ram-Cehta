/**
 * Reporte 1 — Estado del Fondo.
 *
 * Server Component. Hace fetch en paralelo de KPIs, saldos por empresa y
 * cashflow consolidado. Si el ETL nunca corrió o falla un endpoint, mostramos
 * el report con estado vacío sin abortar la UI completa.
 */
import { serverApiGet } from "@/lib/api/server";
import { FondoReportView } from "@/components/reportes/FondoReportView";
import type {
  DashboardKPIs,
  SaldoEmpresaDetalle,
  CashflowResponse,
} from "@/lib/api/schema";

export const metadata = {
  title: "Estado del Fondo — Reportes Cehta Capital",
};

interface PageProps {
  searchParams: Promise<{ meses?: string }>;
}

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await serverApiGet<T>(path);
  } catch {
    return null;
  }
}

export default async function ReporteFondoPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const meses = Number(sp.meses ?? "12");
  const mesesSafe = Number.isFinite(meses) && meses >= 3 && meses <= 24 ? meses : 12;

  const [kpis, saldos, cashflow] = await Promise.all([
    safeGet<DashboardKPIs>("/dashboard/kpis"),
    safeGet<SaldoEmpresaDetalle[]>("/dashboard/saldos-por-empresa"),
    safeGet<CashflowResponse>(`/dashboard/cashflow?meses=${mesesSafe}`),
  ]);

  return (
    <FondoReportView
      kpis={kpis}
      saldos={saldos ?? []}
      cashflow={cashflow ?? { empresa_codigo: null, points: [] }}
      meses={mesesSafe}
    />
  );
}
