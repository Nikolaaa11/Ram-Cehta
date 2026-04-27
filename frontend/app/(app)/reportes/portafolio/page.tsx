/**
 * Reporte 2 — Composición del Portafolio.
 *
 * Server Component. Para cada empresa del catálogo hace fetch en paralelo
 * de su saldo, OCs pendientes y F29 pendientes. Mantenemos las llamadas en
 * `Promise.allSettled` para que un endpoint caído no aborte el reporte.
 */
import { serverApiGet } from "@/lib/api/server";
import { PortafolioReportView } from "@/components/reportes/PortafolioReportView";
import type {
  EmpresaCatalogo,
  Page as ApiPage,
  OrdenCompraListItem,
  F29Read,
  SaldoEmpresaDetalle,
  ProyectoRanking,
} from "@/lib/api/schema";
import type { EmpresaPortafolioStats } from "@/lib/reportes/types";

export const metadata = {
  title: "Composición del Portafolio — Reportes Cehta Capital",
};

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await serverApiGet<T>(path);
  } catch {
    return null;
  }
}

async function buildEmpresaStats(
  empresa: EmpresaCatalogo,
  saldoMap: Map<string, SaldoEmpresaDetalle>,
): Promise<EmpresaPortafolioStats> {
  const saldo = saldoMap.get(empresa.codigo);

  const [ocs, f29] = await Promise.all([
    safeGet<ApiPage<OrdenCompraListItem>>(
      `/ordenes-compra?empresa_codigo=${encodeURIComponent(empresa.codigo)}&size=200&page=1`,
    ),
    safeGet<ApiPage<F29Read>>(
      `/f29?empresa_codigo=${encodeURIComponent(empresa.codigo)}&size=200&page=1`,
    ),
  ]);

  const ocItems = ocs?.items ?? [];
  const ocPendientes = ocItems.filter(
    (o) => o.estado === "emitida" || o.estado === "parcial",
  );
  const montoOcPendiente = ocPendientes.reduce(
    (acc, o) => acc + Number(o.total ?? 0),
    0,
  );

  const f29Items = f29?.items ?? [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const f29Pendientes = f29Items.filter((f) => f.estado === "pendiente").length;
  const f29Vencidas = f29Items.filter((f) => {
    if (f.estado === "pagado" || f.estado === "exento") return false;
    const v = new Date(f.fecha_vencimiento);
    v.setHours(0, 0, 0, 0);
    return v.getTime() < today.getTime();
  }).length;

  return {
    codigo: empresa.codigo,
    razon_social: empresa.razon_social,
    rut: empresa.rut ?? null,
    saldo_contable: saldo?.saldo_contable ?? null,
    saldo_cehta: saldo?.saldo_cehta ?? null,
    saldo_corfo: saldo?.saldo_corfo ?? null,
    ocs_pendientes: ocPendientes.length,
    monto_oc_pendiente: String(montoOcPendiente),
    f29_pendientes: f29Pendientes,
    f29_vencidas: f29Vencidas,
    ultima_actualizacion: saldo?.ultima_actualizacion ?? null,
  };
}

export default async function ReportePortafolioPage() {
  const [empresas, saldos, ranking] = await Promise.all([
    safeGet<EmpresaCatalogo[]>("/catalogos/empresas"),
    safeGet<SaldoEmpresaDetalle[]>("/dashboard/saldos-por-empresa"),
    safeGet<ProyectoRanking[]>("/dashboard/proyectos-ranking?limit=20"),
  ]);

  const saldoMap = new Map<string, SaldoEmpresaDetalle>();
  for (const s of saldos ?? []) saldoMap.set(s.empresa_codigo, s);

  const empresasList = empresas ?? [];
  const stats = await Promise.all(
    empresasList.map((e) => buildEmpresaStats(e, saldoMap)),
  );

  return (
    <PortafolioReportView empresas={stats} ranking={ranking ?? []} />
  );
}
