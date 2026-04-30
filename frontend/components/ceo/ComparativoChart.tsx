"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LineChart as LineIcon, Building2 } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import type { FlujoMensualPoint } from "@/lib/api/schema";

/**
 * Paleta Apple (mismos hex que `APPLE_PALETTE` del backend) — máximo 9
 * empresas, así que 9 colores bien distintos sin risk de colisión.
 */
const APPLE_PALETTE = [
  "#10b981", // cehta-green
  "#3b82f6", // azul
  "#f59e0b", // ámbar
  "#ef4444", // rojo
  "#8b5cf6", // violeta
  "#06b6d4", // cyan
  "#ec4899", // rosa
  "#84cc16", // lima
  "#6366f1", // índigo
];

type Metric = "flujo_neto" | "saldo_acumulado" | "abono_real" | "egreso_real";

const METRICS: { key: Metric; label: string; description: string }[] = [
  { key: "flujo_neto", label: "Flujo neto", description: "Abono − egreso por mes" },
  {
    key: "saldo_acumulado",
    label: "Saldo acumulado",
    description: "Saldo running sumado mes a mes",
  },
  { key: "abono_real", label: "Abonos reales", description: "Ingresos confirmados" },
  { key: "egreso_real", label: "Egresos reales", description: "Salidas confirmadas" },
];

function formatCLP(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K`;
  }
  return value.toFixed(0);
}

interface MergedPoint {
  periodo: string;
  // Valores por empresa, p.ej.: { CENERGY: 1500000, RHO: -200000, ... }
  [empresaCodigo: string]: number | string;
}

/**
 * Comparativo overlay chart — superpone líneas de N empresas seleccionadas
 * sobre el mismo eje de tiempo. Útil para que el CEO vea de un vistazo cómo
 * se mueven 3-4 empresas relativas entre sí.
 *
 * Datos vienen de `GET /empresa/{codigo}/flujo-mensual` (endpoint que ya
 * existe). Llamamos uno por empresa en paralelo via `useQueries`. Si alguno
 * falla, esa empresa simplemente no aparece — no crashea el chart.
 */
export function ComparativoChart() {
  const { session, loading: sessionLoading } = useSession();
  const { data: empresas = [] } = useCatalogoEmpresas();
  const [selected, setSelected] = useState<string[]>([]);
  const [metric, setMetric] = useState<Metric>("flujo_neto");

  // Default: seleccionar las 3 primeras empresas activas si nada está
  // seleccionado y ya cargaron las empresas.
  const effectiveSelected = useMemo(() => {
    if (selected.length > 0) return selected;
    return empresas.slice(0, 3).map((e) => e.codigo);
  }, [selected, empresas]);

  const queries = useQueries({
    queries: effectiveSelected.map((codigo) => ({
      queryKey: ["empresa-flujo-mensual", codigo],
      queryFn: () =>
        apiClient.get<FlujoMensualPoint[]>(
          `/empresa/${codigo}/flujo-mensual`,
          session,
        ),
      enabled: !sessionLoading,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);

  // Mergeamos por periodo: una row por mes, columnas por empresa.
  const merged = useMemo<MergedPoint[]>(() => {
    const byPeriodo = new Map<string, MergedPoint>();
    queries.forEach((q, idx) => {
      const codigo = effectiveSelected[idx];
      if (!codigo || !q.data) return;
      for (const point of q.data) {
        let row = byPeriodo.get(point.periodo);
        if (!row) {
          row = { periodo: point.periodo };
          byPeriodo.set(point.periodo, row);
        }
        const numeric =
          metric === "flujo_neto"
            ? Number(point.flujo_neto)
            : metric === "saldo_acumulado"
            ? Number(point.saldo_acumulado)
            : metric === "abono_real"
            ? Number(point.abono_real)
            : Number(point.egreso_real);
        row[codigo] = numeric;
      }
    });
    return Array.from(byPeriodo.values()).sort((a, b) =>
      a.periodo.localeCompare(b.periodo),
    );
  }, [queries, effectiveSelected, metric]);

  const toggleEmpresa = (codigo: string) => {
    setSelected((prev) => {
      if (prev.includes(codigo)) return prev.filter((c) => c !== codigo);
      if (prev.length >= APPLE_PALETTE.length) return prev; // techo defensivo
      return [...prev, codigo];
    });
  };

  return (
    <Surface padding="none">
      <Surface.Header className="border-b border-hairline px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-cehta-green/10 text-cehta-green">
                <LineIcon className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <Surface.Title>Comparativo entre empresas</Surface.Title>
            </div>
            <Surface.Subtitle>
              {METRICS.find((m) => m.key === metric)?.description}
            </Surface.Subtitle>
          </div>

          {/* Tabs de métrica */}
          <div className="flex flex-wrap gap-1 rounded-xl bg-ink-100/60 p-1">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 ease-apple ${
                  metric === m.key
                    ? "bg-white text-ink-900 shadow-card/40"
                    : "text-ink-500 hover:text-ink-700"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </Surface.Header>

      {/* Chips de empresas */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline px-6 py-3">
        <Building2 className="h-3.5 w-3.5 text-ink-400" strokeWidth={2} />
        <span className="text-[11px] uppercase tracking-wider text-ink-400 mr-1">
          Empresas:
        </span>
        {empresas.map((e) => {
          const idx = effectiveSelected.indexOf(e.codigo);
          const isActive = idx >= 0;
          const color = isActive ? APPLE_PALETTE[idx % APPLE_PALETTE.length] : null;
          return (
            <button
              key={e.codigo}
              type="button"
              onClick={() => toggleEmpresa(e.codigo)}
              className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs font-medium transition-all duration-150 ease-apple ${
                isActive
                  ? "text-ink-900 ring-1 ring-hairline"
                  : "text-ink-500 opacity-60 hover:opacity-100 hover:bg-ink-100/40"
              }`}
              style={
                isActive && color
                  ? { backgroundColor: `${color}15`, borderColor: color }
                  : undefined
              }
            >
              <EmpresaLogo empresaCodigo={e.codigo} size={18} />
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: color ?? "#cbd5e1" }}
              />
              {e.codigo}
            </button>
          );
        })}
      </div>

      <div className="px-2 py-4">
        {isLoading ? (
          <div className="flex h-72 items-center justify-center">
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : merged.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-ink-400">
            Selecciona al menos una empresa para ver el comparativo
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart
              data={merged}
              margin={{ top: 10, right: 24, bottom: 10, left: 0 }}
            >
              <CartesianGrid
                stroke="#f3f4f6"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="periodo"
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={{ stroke: "#e5e7eb" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#64748b" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCLP(Number(v))}
                width={50}
              />
              <Tooltip
                cursor={{ stroke: "#e5e7eb", strokeWidth: 1 }}
                contentStyle={{
                  background: "white",
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  fontSize: 12,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                }}
                formatter={(value) => formatCLP(Number(value))}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                iconType="circle"
              />
              {effectiveSelected.map((codigo, idx) => (
                <Line
                  key={codigo}
                  type="monotone"
                  dataKey={codigo}
                  name={codigo}
                  stroke={APPLE_PALETTE[idx % APPLE_PALETTE.length]}
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Surface>
  );
}
