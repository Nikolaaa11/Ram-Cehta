"use client";

/**
 * /admin/proyectos — Round 92 — Listado de proyectos contables
 *
 * Index navegable de todos los proyectos. Útil para ver:
 *   - Cuáles tienen subsidio asociado
 *   - El reparto default y si está completamente configurado
 *   - Cuánto se ejecutó vs el presupuesto (sin abrir cada uno)
 */
import { useState, useMemo } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import type { ProyectoContable } from "@/lib/api/schema";

const fmtCLP = (n: number | null) =>
  n != null ? `$${Math.round(n).toLocaleString("es-CL")}` : "—";

export default function ProyectosAdminListPage() {
  const { session } = useSession();
  const [empresaFilter, setEmpresaFilter] = useState<string>("");

  const { data, isLoading } = useQuery<ProyectoContable[]>({
    queryKey: ["proyectos-contables-list", empresaFilter],
    queryFn: () => {
      const q = empresaFilter
        ? `?empresa_codigo=${empresaFilter}`
        : "";
      return apiClient.get<ProyectoContable[]>(
        `/proyectos-contables${q}`,
        session,
      );
    },
    enabled: !!session,
  });

  // Empresas únicas para el filtro
  const empresas = useMemo(
    () => Array.from(new Set((data ?? []).map((p) => p.empresa_codigo))).sort(),
    [data],
  );

  const isCompleto = (p: ProyectoContable) => {
    const suma =
      Number(p.aporte_corfo_pct_default) +
      Number(p.aporte_ptec_pct_default) +
      Number(p.aporte_empresa_directa_pct_default);
    if (Math.abs(suma - 100) > 0.01) return false;
    if (
      Number(p.aporte_corfo_pct_default) > 0 &&
      !p.cuenta_aporte_corfo
    )
      return false;
    if (
      Number(p.aporte_ptec_pct_default) > 0 &&
      !p.cuenta_aporte_ptec_cehta
    )
      return false;
    if (
      Number(p.aporte_empresa_directa_pct_default) > 0 &&
      !p.cuenta_aporte_empresa_directa
    )
      return false;
    return true;
  };

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-8 space-y-6">
      <Link
        href={"/admin/usuarios" as Route}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-cehta-green"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a admin
      </Link>

      {/* Round 99 — hero pattern unificado */}
      <div className="relative overflow-hidden rounded-3xl bg-ink-50/40 dark:bg-ink-900 ring-1 ring-hairline p-8 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(rgba(35,108,79,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(35,108,79,0.04) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at top, black 30%, transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-72 w-[600px] rounded-full bg-cehta-green/20 blur-3xl opacity-60"
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-4 py-1.5 ring-1 ring-cehta-green/20">
            <FileText className="size-3.5 text-cehta-green" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Admin · Proyectos contables
            </p>
          </div>
          <h1 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight bg-gradient-to-br from-ink-900 via-ink-700 to-cehta-green bg-clip-text text-transparent dark:from-white dark:via-ink-100 dark:to-cehta-green">
            Catálogo de proyectos
          </h1>
          <p className="text-sm md:text-base text-ink-500 dark:text-ink-400 mt-2 max-w-2xl">
            Configuración del <strong>Bloque E</strong> por proyecto: % default
            (CORFO/P-tec/Empresa) + cuentas contables destino. Click en un
            proyecto para editar.
          </p>
        </div>
      </div>

      {/* Filtro + botón nuevo */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="text-sm text-ink-600">Empresa:</label>
          <select
            value={empresaFilter}
            onChange={(e) => setEmpresaFilter(e.target.value)}
            className="form-input max-w-xs"
          >
            <option value="">Todas</option>
            {empresas.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
        <Link
          href={"/admin/proyectos/nuevo" as Route}
          className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700"
        >
          + Nuevo proyecto
        </Link>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && data && data.length === 0 && (
        <EmptyState
          icon={FileText}
          title="No hay proyectos cargados"
          description={
            empresaFilter
              ? `No hay proyectos contables para la empresa ${empresaFilter}.`
              : "Aún no hay proyectos contables en la base. Creá uno via POST /api/v1/proyectos-contables."
          }
          tone="default"
        />
      )}

      {!isLoading && data && data.length > 0 && (
        <div className="space-y-3">
          {data.map((p) => {
            const completo = isCompleto(p);
            const sumaPct =
              Number(p.aporte_corfo_pct_default) +
              Number(p.aporte_ptec_pct_default) +
              Number(p.aporte_empresa_directa_pct_default);
            return (
              <Link key={p.codigo} href={`/admin/proyectos/${p.codigo}` as Route}>
                <Surface className="p-5 hover:ring-cehta-green/30 hover:bg-cehta-green/[0.02] transition cursor-pointer">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs bg-ink-100 px-1.5 py-0.5 rounded">
                          {p.empresa_codigo}
                        </span>
                        {p.subsidio_codigo && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider bg-cehta-green/10 text-cehta-green px-1.5 py-0.5 rounded ring-1 ring-cehta-green/20">
                            <CircleDollarSign className="size-3" />
                            {p.subsidio_codigo}
                          </span>
                        )}
                        <span
                          className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            p.estado === "ACTIVE"
                              ? "bg-positive/10 text-positive ring-1 ring-positive/20"
                              : "bg-ink-100 text-ink-500"
                          }`}
                        >
                          {p.estado}
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold text-ink-900">
                        {p.nombre}
                      </h3>
                      <p className="text-xs text-ink-500 font-mono mt-0.5">
                        {p.codigo}
                      </p>
                    </div>

                    {/* Estado de configuración */}
                    <div className="text-right">
                      {completo ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 text-positive ring-1 ring-positive/20 px-2 py-0.5 text-[11px] font-semibold">
                          <CheckCircle2 className="size-3" />
                          Configurado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 ring-1 ring-amber-200 px-2 py-0.5 text-[11px] font-semibold">
                          <AlertTriangle className="size-3" />
                          Incompleto
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bottom row: reparto + presupuesto */}
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3 text-[11px]">
                    <div>
                      <span className="text-ink-500">Reparto:</span>
                      <span
                        className={`ml-1 font-mono ${
                          Math.abs(sumaPct - 100) < 0.01
                            ? "text-ink-700"
                            : "text-negative"
                        }`}
                      >
                        {p.aporte_corfo_pct_default}/
                        {p.aporte_ptec_pct_default}/
                        {p.aporte_empresa_directa_pct_default}
                        {Math.abs(sumaPct - 100) > 0.01 && " ⚠"}
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-500">Presupuesto:</span>
                      <span className="ml-1 font-mono text-ink-700">
                        {fmtCLP(p.presupuesto_total)}
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-500">Tipo fin.:</span>
                      <span className="ml-1 text-ink-700">
                        {p.tipo_financiamiento}
                      </span>
                    </div>
                    <div>
                      <span className="text-ink-500">Vigencia:</span>
                      <span className="ml-1 text-ink-700 font-mono">
                        {p.fecha_inicio} → {p.fecha_termino}
                      </span>
                    </div>
                  </div>
                </Surface>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
