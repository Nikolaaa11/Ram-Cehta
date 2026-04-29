import { serverApiGet } from "@/lib/api/server";
import { ResumenHero } from "@/components/empresa/ResumenHero";
import { KpisGrid } from "@/components/empresa/KpisGrid";
import { ComposicionTable } from "@/components/empresa/ComposicionTable";
import { EgresosTipoCard } from "@/components/empresa/EgresosTipoCard";
import { EgresosProyectoSection } from "@/components/empresa/EgresosProyectoSection";
import type {
  EgresoProyectoItem,
  EgresoTipoItem,
  ResumenCC,
} from "@/lib/api/schema";

/**
 * Dashboard rico por empresa — V3 fase 6.
 *
 * Server component que pre-fetch en paralelo los 3 endpoints empresa-scoped
 * que pintan la primera fold:
 *   - /empresa/{codigo}/resumen-cc           → hero + KPIs + composición
 *   - /empresa/{codigo}/egresos-por-tipo     → donut
 *   - /empresa/{codigo}/egresos-por-proyecto → treemap
 *
 * Pasa initialData a los client components para hidratación instantánea.
 * Match visual con el screenshot de referencia (rho-15-05-2026.vercel.app).
 */
export default async function EmpresaResumenPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;

  const [resumen, egresosTipo, egresosProyecto] = await Promise.all([
    serverApiGet<ResumenCC>(`/empresa/${codigo}/resumen-cc`),
    serverApiGet<EgresoTipoItem[]>(`/empresa/${codigo}/egresos-por-tipo`),
    serverApiGet<EgresoProyectoItem[]>(
      `/empresa/${codigo}/egresos-por-proyecto`,
    ),
  ]);

  return (
    <div className="space-y-6">
      <ResumenHero data={resumen} />
      <KpisGrid kpis={resumen.kpis} />
      <ComposicionTable rows={resumen.composicion} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <EgresosTipoCard data={egresosTipo} />
        <EgresosProyectoSection
          empresaCodigo={codigo}
          initialData={egresosProyecto}
        />
      </div>
    </div>
  );
}
