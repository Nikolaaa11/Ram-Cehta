"use client";

/**
 * /admin/areas
 *
 * 10 áreas estándar (centros de costo) compartidas por las 9 entidades.
 * Vista principal: matriz Áreas × Empresas con toggles inline para
 * habilitar/deshabilitar la aplicación de cada área a cada empresa.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LayoutGrid, Layers, Minus } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import type { Area, AreaEmpresaMatrix } from "@/lib/api/schema";

interface Empresa {
  codigo: string;
  razon_social: string;
}

const AREA_DESCRIPCIONES: Record<string, string> = {
  ADM: "Back office, contabilidad, tesorería",
  COM: "Ventas, marketing, BD, originación",
  OPE: "Operación, mantención, logística",
  ING: "Diseño, cálculo, gestión técnica",
  IDI: "I+D experimental, prototipos, PTEC",
  LEG: "Asesoría jurídica, regulatorio, UAF, CMF",
  RRH: "Reclutamiento, capacitación, bienestar",
  TIC: "Software, infraestructura, ciberseguridad",
  EJE: "Gerencia general, directorio, estrategia",
  FIN: "Inversiones, valoración, FIP",
};

export default function AreasPage() {
  const { session } = useSession();
  const qc = useQueryClient();

  const areasQ = useQuery<Area[]>({
    queryKey: ["areas-all"],
    queryFn: () =>
      apiClient.get<Area[]>("/areas?only_active=false", session),
    enabled: !!session,
  });
  const areas = areasQ.data;

  const empresasQ = useQuery<Empresa[]>({
    queryKey: ["empresas"],
    queryFn: () => apiClient.get<Empresa[]>("/empresa", session),
    enabled: !!session,
  });
  const empresas = empresasQ.data;

  const matrixQ = useQuery<AreaEmpresaMatrix>({
    queryKey: ["areas-empresas-matrix"],
    queryFn: () =>
      apiClient.get<AreaEmpresaMatrix>("/areas/empresas-matrix", session),
    enabled: !!session,
  });
  const matrixData = matrixQ.data;

  const isLoading = areasQ.isLoading || empresasQ.isLoading || matrixQ.isLoading;
  const loadError =
    (areasQ.error as Error | null) ??
    (empresasQ.error as Error | null) ??
    (matrixQ.error as Error | null);
  const retryAll = () => {
    areasQ.refetch();
    empresasQ.refetch();
    matrixQ.refetch();
  };

  const matrix = matrixData?.matrix ?? {};

  const toggleMut = useMutation({
    mutationFn: async ({
      area,
      empresa,
      aplica,
    }: {
      area: string;
      empresa: string;
      aplica: boolean;
    }) =>
      apiClient.patch(
        `/areas/${encodeURIComponent(area)}/empresas/${encodeURIComponent(empresa)}`,
        { aplica },
        session,
      ),
    // Optimistic update: actualizamos la matriz local antes del response
    onMutate: async ({ area, empresa, aplica }) => {
      await qc.cancelQueries({ queryKey: ["areas-empresas-matrix"] });
      const previous = qc.getQueryData<AreaEmpresaMatrix>([
        "areas-empresas-matrix",
      ]);
      qc.setQueryData<AreaEmpresaMatrix>(
        ["areas-empresas-matrix"],
        (old) => {
          if (!old) return old;
          const next = { ...old.matrix };
          const list = next[area] ?? [];
          if (aplica && !list.includes(empresa)) {
            next[area] = [...list, empresa];
          } else if (!aplica) {
            next[area] = list.filter((e) => e !== empresa);
          }
          return { matrix: next };
        },
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(["areas-empresas-matrix"], ctx.previous);
      }
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "No se pudo actualizar el área. Reintentá.",
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["areas-empresas-matrix"] });
    },
  });

  // KPI: total pares (área × empresa) que aplican
  const totalAplicaciones = useMemo(
    () =>
      Object.values(matrix).reduce((acc, list) => acc + list.length, 0),
    [matrix],
  );

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[400px]"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 0%, rgba(35,108,79,0.05) 0%, transparent 65%)",
        }}
      />

      <div className="mx-auto max-w-[1280px] px-6 lg:px-10 pt-10 pb-20 space-y-6">
        {/* Hero */}
        <header className="max-w-3xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
            Áreas · Centros de costo
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-[40px] sm:leading-[1.1]">
            Áreas del portafolio
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-600">
            10 áreas estándar transversales: cada empresa activa el subset
            que aplica a su giro. Permiten reportar P&amp;L por área y
            consolidar control de gestión cross-empresa.
          </p>
        </header>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi
            label="Áreas estándar"
            value={String((areas ?? []).length)}
            hint="Códigos de 3 letras"
          />
          <Kpi
            label="Áreas activas"
            value={String((areas ?? []).filter((a) => a.activa).length)}
            hint="Disponibles para asignar"
            tone="cehta"
          />
          <Kpi
            label="Pares aplica"
            value={String(totalAplicaciones)}
            hint="Área × empresa habilitados"
          />
        </div>

        {/* Leyenda */}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-hairline bg-ink-50/40 px-4 py-2 text-[11px] text-ink-600">
          <span className="font-semibold">Click en una celda para toggle:</span>
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-cehta-green" strokeWidth={2} />
            Aplica
          </span>
          <span className="inline-flex items-center gap-1">
            <Minus className="h-3.5 w-3.5 text-ink-300" strokeWidth={2} />
            No aplica
          </span>
        </div>

        {/* Matriz */}
        {loadError ? (
          <ErrorState
            title="No se pudo cargar la matriz de áreas"
            error={loadError}
            onRetry={retryAll}
          />
        ) : isLoading || !areas || !empresas ? (
          <div className="space-y-2">
            <Skeleton className="h-10 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </div>
        ) : areas.length === 0 ? (
          <EmptyState
            icon={LayoutGrid}
            title="Sin áreas"
            description="No hay áreas configuradas todavía. Importá el plan de cuentas para crear las áreas estándar."
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-hairline bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="sticky left-0 bg-ink-50/60 px-4 py-3 backdrop-blur-sm">
                    Área
                  </th>
                  {empresas.map((e) => (
                    <th
                      key={e.codigo}
                      className="px-3 py-3 text-center"
                      title={e.razon_social}
                    >
                      {e.codigo === "FIP_CEHTA" ? "FIP" : e.codigo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {areas.map((area) => {
                  const empresasQueAplican = matrix[area.codigo] ?? [];
                  return (
                    <tr key={area.codigo} className={!area.activa ? "opacity-50" : ""}>
                      <td className="sticky left-0 bg-white px-4 py-3 align-top">
                        <div className="flex items-start gap-2">
                          <div className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cehta-green/8 text-[10px] font-bold tabular-nums text-cehta-green ring-1 ring-cehta-green/20">
                            {area.codigo}
                          </div>
                          <div>
                            <p className="font-medium text-ink-900">
                              {area.nombre}
                            </p>
                            <p className="mt-0.5 text-[11px] leading-tight text-ink-500">
                              {area.descripcion ??
                                AREA_DESCRIPCIONES[area.codigo] ??
                                ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      {empresas.map((emp) => {
                        const aplica = empresasQueAplican.includes(emp.codigo);
                        return (
                          <td
                            key={emp.codigo}
                            className="px-3 py-3 text-center"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                toggleMut.mutate({
                                  area: area.codigo,
                                  empresa: emp.codigo,
                                  aplica: !aplica,
                                })
                              }
                              disabled={!area.activa || toggleMut.isPending}
                              aria-label={`${area.codigo} aplica a ${emp.codigo}: ${aplica}`}
                              className={`group inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 transition-all duration-150 ease-apple ${
                                aplica
                                  ? "bg-cehta-green/10 text-cehta-green ring-cehta-green/30 hover:bg-cehta-green/20"
                                  : "bg-white text-ink-300 ring-hairline hover:bg-ink-50 hover:text-ink-500"
                              } disabled:cursor-not-allowed disabled:opacity-40`}
                            >
                              {aplica ? (
                                <CheckCircle2
                                  className="h-4 w-4"
                                  strokeWidth={2.25}
                                />
                              ) : (
                                <Minus
                                  className="h-3 w-3"
                                  strokeWidth={2.5}
                                />
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Hint */}
        <p className="text-[11px] italic text-ink-500">
          Tip: las áreas se importan automáticamente cuando subís el{" "}
          <code className="rounded bg-ink-100 px-1 py-0.5 text-[10px]">
            Plan_de_cuentas_v2.xlsx
          </code>{" "}
          (hoja Areas con flags Aplica_X por empresa). Los cambios manuales
          se respetan: el importer hace UPSERT, no sobreescribe lo que vos
          ya hayas tocado.
        </p>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "ink" | "cehta";
}) {
  const accent =
    tone === "cehta"
      ? "border-cehta-green/30 bg-cehta-green/5"
      : "border-hairline bg-white";
  return (
    <div className={`rounded-2xl border ${accent} p-4 shadow-card`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
        {label}
      </p>
      <p
        className={`mt-1 font-display text-2xl font-semibold tabular-nums ${tone === "cehta" ? "text-cehta-green" : "text-ink-900"}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-ink-500">{hint}</p>
      <Layers className="hidden" />
    </div>
  );
}
