"use client";

/**
 * R152FFFF · Gráfico evolución mensual del costo empresa RRHH.
 *
 * Bar chart agrupado: 1 barra por empresa por mes, suma todos los meses
 * acumulados. Usa recharts (ya en bundle global vía R152uu lazy-load).
 *
 * Con 1 solo libro carga vacío con mensaje. Con 2+ ya se ve la evolución.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface EvolucionDatum {
  periodo: string;
  total: number;
  byEmpresa: Record<string, number>;
}

const COLORES_EMPRESA: Record<string, string> = {
  AFIS: "#236C4F",
  FIP_CEHTA: "#1e40af",
  CENERGY: "#0e7490",
  EVOQUE: "#9333ea",
  CSL: "#dc2626",
  TRONGKAI: "#16a34a",
  RHO: "#ea580c",
  REVTECH: "#0d9488",
  DTE: "#a16207",
};

const fmtPeriodo = (p: string) => {
  const [y, m] = p.split("-");
  const meses = [
    "", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
  ];
  const idx = parseInt(m ?? "0", 10);
  return `${meses[idx] ?? m ?? ""} ${(y ?? "").slice(-2)}`;
};

const fmtCLPShort = (v: number) => {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
};

const fmtCLPFull = (v: number) =>
  `$${Math.round(v).toLocaleString("es-CL")}`;

export function EvolucionCostoChart({
  data,
}: {
  data: EvolucionDatum[];
}) {
  if (data.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-hairline bg-ink-50/30 p-8 text-center">
        <p className="text-sm text-ink-500">
          Cargá libros mensuales para ver la evolución del costo total.
        </p>
        <p className="text-xs text-ink-400 mt-1">
          Con 2 o más libros mensuales ya se aprecia la tendencia.
        </p>
      </div>
    );
  }

  // Empresas únicas en el rango
  const empresas = Array.from(
    new Set(data.flatMap((d) => Object.keys(d.byEmpresa))),
  ).sort();

  // Flatten para recharts: cada fila tiene periodo + 1 key por empresa
  const rows = data.map((d) => {
    const row: Record<string, string | number> = {
      periodo: fmtPeriodo(d.periodo),
      total: d.total,
    };
    for (const emp of empresas) {
      row[emp] = d.byEmpresa[emp] ?? 0;
    }
    return row;
  });

  return (
    <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h3 className="font-display text-base font-semibold text-ink-900">
            Evolución costo total empresa
          </h3>
          <p className="text-[11px] text-ink-500 mt-0.5">
            Suma haberes + aportes patronales por mes, agrupado por empresa
          </p>
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 5, right: 5, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="periodo"
              tick={{ fontSize: 11, fill: "#6b7280" }}
            />
            <YAxis
              tickFormatter={fmtCLPShort}
              tick={{ fontSize: 10, fill: "#6b7280" }}
              width={50}
            />
            <Tooltip
              formatter={(v: number) => fmtCLPFull(v)}
              labelStyle={{ fontWeight: 600 }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 8,
                border: "1px solid #e5e7eb",
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              iconType="circle"
              iconSize={8}
            />
            {empresas.map((emp) => (
              <Bar
                key={emp}
                dataKey={emp}
                stackId="costo"
                fill={COLORES_EMPRESA[emp] ?? "#6b7280"}
                radius={empresas[empresas.length - 1] === emp ? [4, 4, 0, 0] : 0}
              >
                {rows.map((_, i) => (
                  <Cell key={`c-${i}`} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
