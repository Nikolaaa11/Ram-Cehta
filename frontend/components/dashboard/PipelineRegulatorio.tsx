"use client";

/**
 * PipelineRegulatorio — V4 fase 7.13.
 *
 * Widget de dashboard que muestra la distribución del pipeline regulatorio
 * por categoría (CMF/CORFO/UAF/SII/...) con counts visuales tipo chart de
 * barras horizontal apilado. Da una mirada rápida de "dónde está mi
 * carga regulatoria" en una sola card.
 */
import { useMemo } from "react";
import { ClipboardList, ArrowRight } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { useEntregables } from "@/hooks/use-entregables";
import { cn } from "@/lib/utils";

const CATEGORIA_COLOR: Record<string, string> = {
  CMF: "bg-purple-500",
  CORFO: "bg-cehta-green",
  UAF: "bg-red-500",
  SII: "bg-orange-500",
  INTERNO: "bg-blue-500",
  AUDITORIA: "bg-gray-500",
  ASAMBLEA: "bg-yellow-500",
  OPERACIONAL: "bg-emerald-500",
};

const CATEGORIA_BG: Record<string, string> = {
  CMF: "bg-purple-100 text-purple-800",
  CORFO: "bg-cehta-green/15 text-cehta-green",
  UAF: "bg-red-100 text-red-800",
  SII: "bg-orange-100 text-orange-800",
  INTERNO: "bg-blue-100 text-blue-800",
  AUDITORIA: "bg-gray-100 text-gray-800",
  ASAMBLEA: "bg-yellow-100 text-yellow-800",
  OPERACIONAL: "bg-emerald-100 text-emerald-800",
};

interface CategoriaStats {
  categoria: string;
  pendientes: number;
  criticos: number;
  porcentaje: number;
}

export function PipelineRegulatorio() {
  // Próximos 90 días, pendientes/en proceso
  const today = new Date();
  const en90d = new Date(today);
  en90d.setDate(today.getDate() + 90);

  const { data: entregables = [], isLoading } = useEntregables({
    desde: today.toISOString().slice(0, 10),
    hasta: en90d.toISOString().slice(0, 10),
  });

  const stats = useMemo<CategoriaStats[]>(() => {
    const map: Record<
      string,
      { pendientes: number; criticos: number }
    > = {};
    let total = 0;
    for (const e of entregables) {
      if (e.estado === "entregado" || e.estado === "no_entregado") continue;
      if (!map[e.categoria]) {
        map[e.categoria] = { pendientes: 0, criticos: 0 };
      }
      map[e.categoria]!.pendientes++;
      total++;
      const isCritico =
        e.nivel_alerta === "vencido" ||
        e.nivel_alerta === "hoy" ||
        e.nivel_alerta === "critico";
      if (isCritico) map[e.categoria]!.criticos++;
    }
    return Object.entries(map)
      .map(([categoria, vals]) => ({
        categoria,
        pendientes: vals.pendientes,
        criticos: vals.criticos,
        porcentaje: total > 0 ? (vals.pendientes / total) * 100 : 0,
      }))
      .sort((a, b) => b.pendientes - a.pendientes);
  }, [entregables]);

  const totalPendientes = stats.reduce((acc, s) => acc + s.pendientes, 0);
  const totalCriticos = stats.reduce((acc, s) => acc + s.criticos, 0);

  return (
    <Surface>
      <Surface.Header className="border-b border-hairline pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cehta-green/15 text-cehta-green">
              <ClipboardList className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <Surface.Title>Pipeline Regulatorio</Surface.Title>
              <Surface.Subtitle>
                Próximos 90 días por categoría ·{" "}
                <strong>{totalPendientes}</strong> pendientes
                {totalCriticos > 0 && (
                  <>
                    {" · "}
                    <span className="text-negative">
                      {totalCriticos} crítico{totalCriticos !== 1 ? "s" : ""}
                    </span>
                  </>
                )}
              </Surface.Subtitle>
            </div>
          </div>
          <a
            href="/entregables"
            className="inline-flex items-center gap-1 text-xs font-medium text-cehta-green hover:underline"
          >
            Ver detalle <ArrowRight className="h-3 w-3" strokeWidth={2} />
          </a>
        </div>
      </Surface.Header>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 rounded-lg" />
          ))}
        </div>
      ) : stats.length === 0 ? (
        <div className="mt-3 rounded-xl border border-positive/20 bg-positive/5 p-4 text-center">
          <p className="text-sm font-semibold text-positive">
            Pipeline limpio — sin pendientes en próximos 90 días
          </p>
        </div>
      ) : (
        <>
          {/* Barra apilada total */}
          <div className="mt-3">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-ink-100">
              {stats.map((s) => (
                <div
                  key={s.categoria}
                  className={cn(
                    "transition-all",
                    CATEGORIA_COLOR[s.categoria] ?? "bg-ink-300",
                  )}
                  style={{ width: `${s.porcentaje}%` }}
                  title={`${s.categoria}: ${s.pendientes} pendientes (${s.porcentaje.toFixed(0)}%)`}
                />
              ))}
            </div>
          </div>

          {/* Filas por categoría */}
          <div className="mt-3 space-y-1.5">
            {stats.map((s) => (
              <a
                key={s.categoria}
                href={`/entregables?categoria=${s.categoria}`}
                className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-ink-50"
              >
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    CATEGORIA_BG[s.categoria] ?? "bg-ink-100 text-ink-700",
                  )}
                >
                  {s.categoria}
                </span>
                <div className="flex-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                    <div
                      className={cn(
                        "h-full transition-all",
                        CATEGORIA_COLOR[s.categoria] ?? "bg-ink-300",
                      )}
                      style={{ width: `${s.porcentaje}%` }}
                    />
                  </div>
                </div>
                <span className="text-sm font-semibold tabular-nums text-ink-900 min-w-[2rem] text-right">
                  {s.pendientes}
                </span>
                {s.criticos > 0 && (
                  <span
                    className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-negative/15 px-1.5 text-[10px] font-bold text-negative"
                    title={`${s.criticos} crítico${s.criticos !== 1 ? "s" : ""}`}
                  >
                    {s.criticos}
                  </span>
                )}
                <ArrowRight
                  className="h-3 w-3 shrink-0 text-ink-300"
                  strokeWidth={2}
                />
              </a>
            ))}
          </div>
        </>
      )}
    </Surface>
  );
}
