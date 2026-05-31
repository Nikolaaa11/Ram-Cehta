"use client";

/**
 * AdoptionQuadrant — visualización 2×2 del Mapa de Actores (R152cc).
 *
 *   Eje X = clasificación (Detractor / Espectador / Aliado / Sin activar)
 *   Eje Y = impacto (B / M / A)
 *
 * Cada usuario es un punto de color en su celda. La densidad ayuda a ver
 * dónde concentrar esfuerzo: Aliados-A son tus champions; Detractores-A
 * son la urgencia.
 *
 * Pensado para ser scaneable en 3 segundos.
 */
import { useMemo } from "react";

interface Row {
  user_id: string;
  email: string;
  classification: "aliado" | "espectador" | "detractor" | "sin_activacion";
  impact_level: "A" | "M" | "B";
}

interface Props {
  rows: Row[];
}

const CLAS_ORDER = ["detractor", "espectador", "aliado", "sin_activacion"] as const;
const IMPACT_ORDER = ["A", "M", "B"] as const;

const CLAS_LABEL: Record<string, string> = {
  detractor: "Detractores",
  espectador: "Espectadores",
  aliado: "Aliados",
  sin_activacion: "Sin activar",
};

const CLAS_COLOR: Record<string, { dot: string; bg: string; text: string }> = {
  detractor: { dot: "bg-red-500", bg: "bg-red-50/60", text: "text-red-700" },
  espectador: { dot: "bg-blue-500", bg: "bg-blue-50/60", text: "text-blue-700" },
  aliado: { dot: "bg-emerald-500", bg: "bg-emerald-50/60", text: "text-emerald-700" },
  sin_activacion: { dot: "bg-ink-300", bg: "bg-ink-50/60", text: "text-ink-500" },
};

const IMPACT_LABEL: Record<string, string> = {
  A: "Alto",
  M: "Medio",
  B: "Bajo",
};

export function AdoptionQuadrant({ rows }: Props) {
  // Bucket por (clasificación × impacto)
  const grid = useMemo(() => {
    const g: Record<string, Row[]> = {};
    for (const r of rows) {
      const k = `${r.classification}|${r.impact_level}`;
      if (!g[k]) g[k] = [];
      g[k].push(r);
    }
    return g;
  }, [rows]);

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid min-w-full" style={{ gridTemplateColumns: "70px repeat(4, minmax(140px, 1fr))" }}>
        {/* Header row */}
        <div />
        {CLAS_ORDER.map((c) => (
          <div
            key={c}
            className={`border-b-2 border-hairline px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider ${CLAS_COLOR[c]!.text}`}
          >
            <span className={`mr-1 inline-block size-2 rounded-full ${CLAS_COLOR[c]!.dot}`} />
            {CLAS_LABEL[c]}
          </div>
        ))}

        {/* Rows: una por nivel de impacto */}
        {IMPACT_ORDER.map((imp) => (
          <div key={imp} className="contents">
            <div className="flex items-center justify-center border-r-2 border-hairline pr-3 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              <div className="flex flex-col items-center gap-0.5">
                <span className="font-bold text-ink-900">{imp}</span>
                <span className="text-[9px] font-normal">{IMPACT_LABEL[imp]}</span>
              </div>
            </div>
            {CLAS_ORDER.map((c) => {
              const cell = grid[`${c}|${imp}`] ?? [];
              const cfg = CLAS_COLOR[c]!;
              return (
                <div
                  key={`${c}-${imp}`}
                  className={`group relative min-h-[88px] border border-hairline px-2 py-2 transition-colors ${cfg.bg} hover:bg-white`}
                >
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className={`font-semibold ${cfg.text}`}>
                      {cell.length}
                    </span>
                    {imp === "A" && cell.length > 0 && c === "detractor" && (
                      <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[8px] font-bold uppercase text-red-700">
                        ¡Urgente!
                      </span>
                    )}
                    {imp === "A" && cell.length > 0 && c === "aliado" && (
                      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[8px] font-bold uppercase text-emerald-700">
                        Champions
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {cell.slice(0, 12).map((r) => (
                      <span
                        key={r.user_id}
                        className={`inline-block size-2.5 rounded-full ${cfg.dot} ring-1 ring-white transition-transform hover:scale-150`}
                        title={r.email}
                      />
                    ))}
                    {cell.length > 12 && (
                      <span className="text-[9px] text-ink-500">
                        +{cell.length - 12}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Leyenda */}
      <p className="mt-3 px-1 text-[10px] leading-relaxed text-ink-500">
        Cada punto = 1 usuario. Hover para ver el email. Los <strong>Aliados de
        Alto Impacto</strong> son tus champions del cambio — pediles feedback en
        decisiones. Los <strong>Detractores de Alto Impacto</strong> son la
        urgencia — 1:1 inmediato.
      </p>
    </div>
  );
}
