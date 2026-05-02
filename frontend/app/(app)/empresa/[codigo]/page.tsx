import { AlertTriangle } from "lucide-react";
import { serverApiGet } from "@/lib/api/server";
import { Surface } from "@/components/ui/surface";
import { ResumenHero } from "@/components/empresa/ResumenHero";
import { KpisGrid } from "@/components/empresa/KpisGrid";
import { ComposicionTable } from "@/components/empresa/ComposicionTable";
import { EgresosTipoCard } from "@/components/empresa/EgresosTipoCard";
import { EgresosProyectoSection } from "@/components/empresa/EgresosProyectoSection";
import { EntregablesEmpresaWidget } from "@/components/empresa/EntregablesEmpresaWidget";
import type {
  EgresoProyectoItem,
  EgresoTipoItem,
  ResumenCC,
} from "@/lib/api/schema";

/**
 * Dashboard rico por empresa — V3 fase 6 (resilient).
 *
 * Server component que pre-fetch en paralelo los 3 endpoints empresa-scoped
 * que pintan la primera fold:
 *   - /empresa/{codigo}/resumen-cc           → hero + KPIs + composición
 *   - /empresa/{codigo}/egresos-por-tipo     → donut
 *   - /empresa/{codigo}/egresos-por-proyecto → treemap
 *
 * Si el backend está desactualizado o cualquier endpoint falla, capturamos
 * el error y mostramos un banner explicativo en lugar de crashear toda
 * la página. Cada sección renderea independiente con fallback.
 */
async function safeFetch<T>(path: string): Promise<T | { error: string }> {
  try {
    return await serverApiGet<T>(path);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error desconocido" };
  }
}

function isError<T>(value: T | { error: string }): value is { error: string } {
  return (
    typeof value === "object" && value !== null && "error" in (value as object)
  );
}

export default async function EmpresaResumenPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;

  const [resumen, egresosTipo, egresosProyecto] = await Promise.all([
    safeFetch<ResumenCC>(`/empresa/${codigo}/resumen-cc`),
    safeFetch<EgresoTipoItem[]>(`/empresa/${codigo}/egresos-por-tipo`),
    safeFetch<EgresoProyectoItem[]>(`/empresa/${codigo}/egresos-por-proyecto`),
  ]);

  // Si el endpoint principal falla con 404, mostramos un banner único
  // pidiendo redeploy; los otros componentes se renderean si tienen data.
  const resumenError = isError(resumen);
  const isBackendStale =
    resumenError &&
    /(not found|404|404:)/i.test((resumen as { error: string }).error);

  if (isBackendStale) {
    return (
      <div className="space-y-6">
        <Surface className="border border-warning/30 bg-warning/5 ring-1 ring-warning/30">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
              <AlertTriangle className="h-5 w-5" strokeWidth={1.5} />
            </span>
            <div className="flex-1">
              <Surface.Title className="text-warning">
                Backend desactualizado
              </Surface.Title>
              <Surface.Subtitle>
                El frontend está actualizado pero el backend en Fly.io no tiene
                los endpoints nuevos de V3 fase 6 (
                <code className="rounded bg-ink-100/60 px-1 py-0.5 text-xs">
                  /empresa/{codigo}/resumen-cc
                </code>
                ). Ejecutá <code className="rounded bg-ink-100/60 px-1 py-0.5 text-xs">flyctl deploy</code>
                {" "}desde la carpeta <code className="rounded bg-ink-100/60 px-1 py-0.5 text-xs">backend/</code>.
              </Surface.Subtitle>
              <Surface.Body className="mt-3">
                <pre className="overflow-x-auto rounded-lg bg-ink-100/40 p-3 text-xs text-ink-700">
                  {`cd C:\\Users\\DELL\\Documents\\0.11.Nikolaya\\Ram-Cehta\ngit pull\ncd backend\nflyctl deploy`}
                </pre>
              </Surface.Body>
            </div>
          </div>
        </Surface>
      </div>
    );
  }

  if (resumenError) {
    return (
      <div className="space-y-6">
        <Surface className="border border-negative/20 bg-negative/5 ring-1 ring-negative/20">
          <Surface.Title className="text-negative">
            No se pudo cargar el resumen de {codigo}
          </Surface.Title>
          <Surface.Subtitle>
            {(resumen as { error: string }).error}
          </Surface.Subtitle>
        </Surface>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ResumenHero data={resumen as ResumenCC} />
      <KpisGrid kpis={(resumen as ResumenCC).kpis} />
      {/* V4 fase 7.7 — Widget de entregables regulatorios filtrados a esta empresa */}
      <EntregablesEmpresaWidget empresaCodigo={codigo} />
      <ComposicionTable rows={(resumen as ResumenCC).composicion} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {isError(egresosTipo) ? (
          <Surface className="border border-warning/20 bg-warning/5">
            <Surface.Title className="text-warning text-sm">
              Donut Egresos por Tipo no disponible
            </Surface.Title>
            <Surface.Subtitle>
              {(egresosTipo as { error: string }).error}
            </Surface.Subtitle>
          </Surface>
        ) : (
          <EgresosTipoCard data={egresosTipo as EgresoTipoItem[]} />
        )}

        {isError(egresosProyecto) ? (
          <Surface className="border border-warning/20 bg-warning/5">
            <Surface.Title className="text-warning text-sm">
              Treemap Egresos por Proyecto no disponible
            </Surface.Title>
            <Surface.Subtitle>
              {(egresosProyecto as { error: string }).error}
            </Surface.Subtitle>
          </Surface>
        ) : (
          <EgresosProyectoSection
            empresaCodigo={codigo}
            initialData={egresosProyecto as EgresoProyectoItem[]}
          />
        )}
      </div>
    </div>
  );
}
