"use client";

/**
 * /dashboard/directorio/impact — Round 152
 *
 * Tab Impact con:
 *   - G16 IRIS+ metric cards (ya hay en Overview, repetimos con mas detalle)
 *   - G14 Radar 5 dimensiones (Impact Frontiers)
 *   - G15 SDG alignment grid (compañías × SDGs 1-17)
 *   - Companies B-Corp scores
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { CheckCircle2 } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface ImpactCard {
  iris_metric_id: string;
  metric_name: string;
  aggregate_value: string;
  unit: string;
  framework: string;
  companies_count: number;
  verified_count: number;
}

// Pre-fetched data structure desde nuevos endpoints
interface ImpactDimensionRow {
  empresa_codigo: string;
  ticker: string;
  what_score: number;
  who_score: number;
  how_much_score: number;
  contribution_score: number;
  risk_score: number;
  narrative: string | null;
}

interface SdgAlignmentRow {
  empresa_codigo: string;
  ticker: string;
  sdg_number: number;
  alignment_score: number;
}

// Iconos SDG (texto compact — Apple es flat, no usamos imagenes externas)
const SDG_LABELS: Record<number, string> = {
  1: "1·Sin Pobreza",
  2: "2·Hambre Cero",
  3: "3·Salud",
  4: "4·Educación",
  5: "5·Igualdad",
  6: "6·Agua",
  7: "7·Energía",
  8: "8·Trabajo",
  9: "9·Innovación",
  10: "10·Desigualdad",
  11: "11·Ciudades",
  12: "12·Consumo",
  13: "13·Clima",
  14: "14·Mar",
  15: "15·Tierra",
  16: "16·Paz",
  17: "17·Alianzas",
};

const SDG_COLORS: Record<number, string> = {
  1: "#E5243B",
  2: "#DDA63A",
  3: "#4C9F38",
  4: "#C5192D",
  5: "#FF3A21",
  6: "#26BDE2",
  7: "#FCC30B",
  8: "#A21942",
  9: "#FD6925",
  10: "#DD1367",
  11: "#FD9D24",
  12: "#BF8B2E",
  13: "#3F7E44",
  14: "#0A97D9",
  15: "#56C02B",
  16: "#00689D",
  17: "#19486A",
};

const PORTFOLIO_TICKERS = ["CSL", "RHO", "DTE", "REVTECH", "EVOQUE", "TRONGKAI"];

export default function ImpactPage() {
  const { session } = useSession();

  const { data: impact } = useQuery<{ period: string; cards: ImpactCard[] }>({
    queryKey: ["dashboard", "impact"],
    queryFn: () =>
      apiClient.get<{ period: string; cards: ImpactCard[] }>("/dashboard/impact", session),
    enabled: !!session,
    staleTime: 60_000,
  });

  // Para Impact Dimensions y SDG, llamamos un endpoint que no existe aun;
  // por ahora hard-codeamos un fallback con los datos del seed
  // (esto se reemplazara cuando agreguemos endpoint /dashboard/impact/dimensions)
  const dimensionsFallback: ImpactDimensionRow[] = [
    { empresa_codigo: "CSL", ticker: "CSL", what_score: 4, who_score: 4, how_much_score: 4, contribution_score: 5, risk_score: 2, narrative: "Leasing equipos cleantech permite acceso PYMES a tecnologia limpia." },
    { empresa_codigo: "RHO", ticker: "RHO", what_score: 5, who_score: 3, how_much_score: 5, contribution_score: 4, risk_score: 3, narrative: "Generacion 100% renovable. Beneficio amplio." },
    { empresa_codigo: "DTE", ticker: "DTE", what_score: 4, who_score: 3, how_much_score: 3, contribution_score: 4, risk_score: 2, narrative: "Consultoria habilita proyectos cleantech corporates." },
    { empresa_codigo: "REVTECH", ticker: "REVTECH", what_score: 4, who_score: 4, how_much_score: 3, contribution_score: 5, risk_score: 3, narrative: "Revalorizacion escorias mineras reduce impacto ambiental." },
    { empresa_codigo: "EVOQUE", ticker: "EVOQUE", what_score: 5, who_score: 4, how_much_score: 4, contribution_score: 5, risk_score: 2, narrative: "Economia circular industrial." },
    { empresa_codigo: "TRONGKAI", ticker: "TRONGKAI", what_score: 4, who_score: 4, how_much_score: 3, contribution_score: 4, risk_score: 3, narrative: "Valorizacion subproductos agro." },
  ];

  const sdgFallback: SdgAlignmentRow[] = [
    { empresa_codigo: "CSL", ticker: "CSL", sdg_number: 7, alignment_score: 5 },
    { empresa_codigo: "CSL", ticker: "CSL", sdg_number: 9, alignment_score: 4 },
    { empresa_codigo: "CSL", ticker: "CSL", sdg_number: 13, alignment_score: 5 },
    { empresa_codigo: "RHO", ticker: "RHO", sdg_number: 7, alignment_score: 5 },
    { empresa_codigo: "RHO", ticker: "RHO", sdg_number: 8, alignment_score: 3 },
    { empresa_codigo: "RHO", ticker: "RHO", sdg_number: 13, alignment_score: 5 },
    { empresa_codigo: "DTE", ticker: "DTE", sdg_number: 7, alignment_score: 4 },
    { empresa_codigo: "DTE", ticker: "DTE", sdg_number: 9, alignment_score: 5 },
    { empresa_codigo: "DTE", ticker: "DTE", sdg_number: 13, alignment_score: 4 },
    { empresa_codigo: "REVTECH", ticker: "REVTECH", sdg_number: 9, alignment_score: 5 },
    { empresa_codigo: "REVTECH", ticker: "REVTECH", sdg_number: 12, alignment_score: 5 },
    { empresa_codigo: "REVTECH", ticker: "REVTECH", sdg_number: 13, alignment_score: 4 },
    { empresa_codigo: "EVOQUE", ticker: "EVOQUE", sdg_number: 9, alignment_score: 4 },
    { empresa_codigo: "EVOQUE", ticker: "EVOQUE", sdg_number: 12, alignment_score: 5 },
    { empresa_codigo: "EVOQUE", ticker: "EVOQUE", sdg_number: 13, alignment_score: 4 },
    { empresa_codigo: "TRONGKAI", ticker: "TRONGKAI", sdg_number: 2, alignment_score: 4 },
    { empresa_codigo: "TRONGKAI", ticker: "TRONGKAI", sdg_number: 12, alignment_score: 5 },
    { empresa_codigo: "TRONGKAI", ticker: "TRONGKAI", sdg_number: 13, alignment_score: 4 },
  ];

  // G14: Radar agregado del fondo (promedio de las 5 dimensiones)
  const radarData = useMemo(() => {
    const dims: Array<keyof (typeof dimensionsFallback)[number]> = [
      "what_score",
      "who_score",
      "how_much_score",
      "contribution_score",
      "risk_score",
    ];
    const labels = ["What", "Who", "How Much", "Contribution", "Risk"];
    return dims.map((d, i) => ({
      dimension: labels[i],
      score:
        dimensionsFallback.reduce((sum, row) => sum + (row[d] as number), 0) /
        dimensionsFallback.length,
    }));
  }, []);

  // G15: SDG Grid mapping para render
  const sdgGrid = useMemo(() => {
    const grid: Record<string, Record<number, number>> = {};
    for (const ticker of PORTFOLIO_TICKERS) {
      grid[ticker] = {};
    }
    for (const row of sdgFallback) {
      const tickerGrid = grid[row.ticker] ?? (grid[row.ticker] = {});
      tickerGrid[row.sdg_number] = row.alignment_score;
    }
    return grid;
  }, []);

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8 space-y-8">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-ink-900">
          Impact & ESG
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          IRIS+ v5.3 · Impact Frontiers 5-dim · SDG alignment · B Corp scores
        </p>
      </div>

      {/* G16: IRIS+ Cards detalladas */}
      <section>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-ink-900">Métricas IRIS+ del Fondo</h2>
            <p className="text-xs text-ink-500 mt-0.5">
              Agregadas a nivel portfolio · Período {impact?.period ?? "2025-12-31"}
            </p>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink-400">G16 · IRIS+ v5.3</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3" style={{ fontVariantNumeric: "tabular-nums" }}>
          {impact?.cards?.map((card) => (
            <div
              key={card.iris_metric_id}
              className="rounded-xl border border-hairline bg-white p-5 shadow-card-sm"
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-[10px] uppercase tracking-wider text-cehta-green font-bold">
                  {card.iris_metric_id}
                </span>
                {card.verified_count > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-cehta-green font-semibold">
                    <CheckCircle2 className="size-3" />
                    {card.verified_count}/{card.companies_count} verif.
                  </span>
                ) : (
                  <span className="text-[10px] text-amber-700">Pending verif.</span>
                )}
              </div>
              <div className="text-3xl font-bold text-ink-900 tabular-nums">
                {parseFloat(card.aggregate_value).toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </div>
              <div className="text-xs text-ink-500 font-medium uppercase tracking-wider mt-0.5">
                {card.unit}
              </div>
              <div className="text-sm text-ink-700 mt-3 leading-tight font-medium">{card.metric_name}</div>
              <div className="mt-3 pt-3 border-t border-hairline text-[10px] text-ink-400 flex items-center justify-between">
                <span>{card.companies_count} compañías reportan</span>
                <span className="text-cehta-green font-medium">{card.framework}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* G14 Radar + G15 SDG side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* G14: Impact Dimensions Radar */}
        <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-ink-900">Impact Frontiers 5 Dimensiones</h2>
              <p className="text-xs text-ink-500 mt-0.5">
                Promedio agregado del portfolio (scores 1-5)
              </p>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-ink-400">G14</div>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="#E4E4E7" />
                <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: "#52525B" }} />
                <PolarRadiusAxis angle={90} domain={[0, 5]} tick={{ fontSize: 10, fill: "#71717A" }} />
                <Radar
                  name="Portfolio agregado"
                  dataKey="score"
                  stroke="#0E7C66"
                  fill="#0E7C66"
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
                <Tooltip
                  contentStyle={{
                    background: "#FFFFFF",
                    border: "1px solid #E4E4E7",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => v.toFixed(1)}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-ink-400 italic mt-3">
            What (qué impacto) · Who (a quién) · How Much (cantidad) · Contribution (contribución
            única) · Risk (probabilidad de no lograrlo)
          </p>
        </section>

        {/* G15: SDG Grid 6 companies × 17 SDGs */}
        <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card overflow-x-auto">
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-ink-900">SDG Alignment Grid</h2>
              <p className="text-xs text-ink-500 mt-0.5">
                Compañías × SDGs 1-17 · Color intensidad = score 0-5
              </p>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-ink-400">G15 · UN SDGs</div>
          </div>
          <div className="text-xs">
            <div className="grid grid-cols-[80px_repeat(17,minmax(28px,1fr))] gap-1 items-center">
              {/* Header row con SDG numbers */}
              <div></div>
              {Array.from({ length: 17 }, (_, i) => i + 1).map((n) => (
                <div
                  key={n}
                  className="aspect-square rounded-md flex items-center justify-center text-[9px] font-bold text-white"
                  style={{ backgroundColor: SDG_COLORS[n] }}
                  title={SDG_LABELS[n]}
                >
                  {n}
                </div>
              ))}
              {/* Rows: cada portfolio company */}
              {PORTFOLIO_TICKERS.map((ticker) => (
                <>
                  <div key={`${ticker}-label`} className="font-mono text-xs font-semibold text-ink-700 text-right pr-1">
                    {ticker}
                  </div>
                  {Array.from({ length: 17 }, (_, i) => i + 1).map((n) => {
                    const score = sdgGrid[ticker]?.[n] ?? 0;
                    const opacity = score === 0 ? 0.08 : 0.2 + (score / 5) * 0.7;
                    return (
                      <div
                        key={`${ticker}-${n}`}
                        className="aspect-square rounded-md flex items-center justify-center text-[9px] font-bold text-white"
                        style={{
                          backgroundColor: score > 0 ? SDG_COLORS[n] : "#E4E4E7",
                          opacity: score > 0 ? opacity : 1,
                        }}
                        title={`${ticker} × ${SDG_LABELS[n]}: ${score}/5`}
                      >
                        {score > 0 ? score : ""}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-ink-400 italic mt-4">
            Colores oficiales UN SDG · score 0 = sin alineación · 5 = alineación máxima
          </p>
        </section>
      </div>

      {/* Impact Dimensions Detail Table */}
      <section className="rounded-2xl border border-hairline bg-white shadow-card overflow-hidden">
        <div className="px-6 py-4 border-b border-hairline">
          <h2 className="text-base font-semibold text-ink-900">Impact Frontiers — detalle por compañía</h2>
          <p className="text-xs text-ink-500 mt-0.5">Scores 1-5 en las 5 dimensiones + narrativa</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
            <thead className="bg-ink-50/50">
              <tr className="text-[10px] uppercase tracking-wider text-ink-500">
                <th className="px-4 py-3 text-left font-semibold">Ticker</th>
                <th className="px-4 py-3 text-center font-semibold">What</th>
                <th className="px-4 py-3 text-center font-semibold">Who</th>
                <th className="px-4 py-3 text-center font-semibold">How Much</th>
                <th className="px-4 py-3 text-center font-semibold">Contribution</th>
                <th className="px-4 py-3 text-center font-semibold">Risk</th>
                <th className="px-4 py-3 text-left font-semibold">Narrativa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {dimensionsFallback.map((row) => (
                <tr key={row.empresa_codigo} className="hover:bg-ink-50/40">
                  <td className="px-4 py-2.5 font-mono font-semibold">{row.ticker}</td>
                  <ScoreCell value={row.what_score} />
                  <ScoreCell value={row.who_score} />
                  <ScoreCell value={row.how_much_score} />
                  <ScoreCell value={row.contribution_score} />
                  <ScoreCell value={row.risk_score} invertedColor />
                  <td className="px-4 py-2.5 text-xs text-ink-600">{row.narrative}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ScoreCell({ value, invertedColor }: { value: number; invertedColor?: boolean }) {
  // Risk: bajo es mejor (verde). Otros: alto es mejor.
  let cls = "bg-ink-100 text-ink-500";
  const scale = invertedColor ? 6 - value : value;
  if (scale >= 4) cls = "bg-cehta-green/15 text-cehta-green";
  else if (scale >= 3) cls = "bg-blue-100 text-blue-700";
  else if (scale >= 2) cls = "bg-amber-100 text-amber-700";
  else cls = "bg-red-100 text-red-700";
  return (
    <td className="px-4 py-2.5 text-center">
      <span className={`inline-block w-6 h-6 rounded font-bold text-xs leading-6 ${cls}`}>
        {value}
      </span>
    </td>
  );
}
