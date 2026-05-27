"use client";

/**
 * /empresa/[codigo]/impact — Round 152d
 *
 * Vista de Impact ESG por empresa:
 *   - IRIS+ metrics (PI/OI codes con cantidad + unidad + verified)
 *   - SDG alignment (chips por ODS con score color-coded)
 *   - Impact Frontiers 5-dimensiones (radar)
 *   - B-Corp score (si existe)
 */
import { use, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { CheckCircle2, Award } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface ImpactSummary {
  iris_metrics: {
    iris_metric_id: string;
    metric_name: string;
    metric_value: string | number;
    unit: string | null;
    framework: string;
    verified: boolean;
  }[];
  sdg_alignment: { sdg_number: number; alignment_score: number; evidence?: string | null }[];
  dimensions: {
    what_score: number;
    who_score: number;
    how_much_score: number;
    contribution_score: number;
    risk_score: number;
    narrative?: string | null;
    as_of_date: string;
  } | null;
  b_corp_score: number | null;
}

const SDG_COLORS: Record<number, string> = {
  1: "#E5243B", 2: "#DDA63A", 3: "#4C9F38", 4: "#C5192D", 5: "#FF3A21",
  6: "#26BDE2", 7: "#FCC30B", 8: "#A21942", 9: "#FD6925", 10: "#DD1367",
  11: "#FD9D24", 12: "#BF8B2E", 13: "#3F7E44", 14: "#0A97D9", 15: "#56C02B",
  16: "#00689D", 17: "#19486A",
};

const SDG_LABELS: Record<number, string> = {
  1: "Sin Pobreza", 2: "Hambre Cero", 3: "Salud", 4: "Educación",
  5: "Igualdad de Género", 6: "Agua Limpia", 7: "Energía", 8: "Trabajo",
  9: "Innovación", 10: "Reduc. Desig.", 11: "Ciudades", 12: "Consumo",
  13: "Clima", 14: "Vida Marina", 15: "Vida Terrestre", 16: "Paz",
  17: "Alianzas",
};

const numeric: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

export default function ImpactPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = use(params);
  const { session } = useSession();

  const { data, isLoading, error } = useQuery<ImpactSummary>({
    queryKey: ["empresa", codigo, "impact"],
    queryFn: () =>
      apiClient.get<ImpactSummary>(
        `/empresa/${encodeURIComponent(codigo)}/impact`,
        session,
      ),
    enabled: !!session,
  });

  const radarData = useMemo(() => {
    if (!data?.dimensions) {
      return [
        { d: "What", v: 0 }, { d: "Who", v: 0 }, { d: "How Much", v: 0 },
        { d: "Contribution", v: 0 }, { d: "Risk", v: 0 },
      ];
    }
    const d = data.dimensions;
    return [
      { d: "What", v: d.what_score },
      { d: "Who", v: d.who_score },
      { d: "How Much", v: d.how_much_score },
      { d: "Contribution", v: d.contribution_score },
      { d: "Risk", v: d.risk_score },
    ];
  }, [data]);

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/50 p-6 text-sm text-red-900">
        <p className="font-semibold">No se pudo cargar Impact ESG</p>
        <p className="mt-1 text-xs text-red-700">
          {error instanceof Error ? error.message : "Error desconocido"}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return <p className="py-12 text-center text-sm text-ink-400">Cargando Impact ESG…</p>;
  }

  const hasAny =
    (data?.iris_metrics?.length ?? 0) > 0 ||
    (data?.sdg_alignment?.length ?? 0) > 0 ||
    data?.dimensions ||
    data?.b_corp_score;

  if (!hasAny) {
    return (
      <div className="rounded-2xl border border-hairline bg-white p-12 text-center shadow-card">
        <p className="text-sm font-medium text-ink-700">Sin métricas ESG cargadas</p>
        <p className="mt-1 text-xs text-ink-500">
          Esta empresa aún no reporta IRIS+, SDG alignment, ni B-Corp.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* B-Corp + summary tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="IRIS+ metrics" value={String(data?.iris_metrics?.length ?? 0)} />
        <Tile label="SDGs alineados" value={String(data?.sdg_alignment?.length ?? 0)} />
        <Tile
          label="B-Corp Score"
          value={data?.b_corp_score != null ? Number(data.b_corp_score).toFixed(1) : "—"}
          icon={data?.b_corp_score != null ? <Award className="size-4 text-amber-500" /> : undefined}
        />
        <Tile
          label="Verificadas"
          value={`${data?.iris_metrics?.filter((m) => m.verified).length ?? 0}/${data?.iris_metrics?.length ?? 0}`}
        />
      </div>

      {/* IRIS+ Cards */}
      {(data?.iris_metrics?.length ?? 0) > 0 && (
        <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
          <header className="mb-4">
            <h3 className="text-base font-semibold text-ink-900">IRIS+ Metrics</h3>
            <p className="mt-0.5 text-xs text-ink-500">Framework v5.3 · GIIN-IRIS</p>
          </header>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data?.iris_metrics?.map((m) => (
              <div
                key={m.iris_metric_id}
                className="rounded-xl border border-hairline bg-ink-50/30 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[10px] font-mono uppercase text-ink-500">
                    {m.iris_metric_id}
                  </span>
                  {m.verified && (
                    <CheckCircle2 className="size-3.5 text-emerald-600" />
                  )}
                </div>
                <p className="mt-1 text-xs font-medium text-ink-700">{m.metric_name}</p>
                <p className="mt-2 text-xl font-semibold text-ink-900" style={numeric}>
                  {Number(m.metric_value).toLocaleString("es-CL", {
                    maximumFractionDigits: 2,
                  })}
                  {m.unit && (
                    <span className="ml-1 text-xs font-normal text-ink-500">
                      {m.unit}
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* SDG + Radar lado a lado */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* SDG */}
        {(data?.sdg_alignment?.length ?? 0) > 0 && (
          <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
            <header className="mb-4">
              <h3 className="text-base font-semibold text-ink-900">
                SDG Alignment (ONU 2030)
              </h3>
            </header>
            <div className="flex flex-wrap gap-2">
              {data?.sdg_alignment?.map((s) => (
                <div
                  key={s.sdg_number}
                  className="flex flex-col items-center rounded-lg px-3 py-2 text-white"
                  style={{ backgroundColor: SDG_COLORS[s.sdg_number] }}
                  title={s.evidence ?? undefined}
                >
                  <span className="text-xs font-bold">SDG {s.sdg_number}</span>
                  <span className="text-[10px] opacity-90">
                    {SDG_LABELS[s.sdg_number]}
                  </span>
                  <span className="mt-0.5 text-xs font-semibold" style={numeric}>
                    {s.alignment_score}/5
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Radar 5-dim */}
        {data?.dimensions && (
          <section className="rounded-2xl border border-hairline bg-white p-6 shadow-card">
            <header className="mb-4">
              <h3 className="text-base font-semibold text-ink-900">
                Impact Frontiers 5-dimensiones
              </h3>
              <p className="mt-0.5 text-xs text-ink-500">
                Assessment al {data.dimensions.as_of_date}
              </p>
            </header>
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#E5E7EB" />
                  <PolarAngleAxis dataKey="d" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 5]} tick={{ fontSize: 10 }} />
                  <Radar
                    dataKey="v"
                    stroke="#1D6F42"
                    fill="#1D6F42"
                    fillOpacity={0.4}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            {data.dimensions.narrative && (
              <p className="mt-3 text-xs italic text-ink-600">
                &ldquo;{data.dimensions.narrative}&rdquo;
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-4 shadow-card">
      <p className="text-[10px] uppercase tracking-wider text-ink-400">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="text-2xl font-semibold text-ink-900" style={numeric}>
          {value}
        </p>
        {icon}
      </div>
    </div>
  );
}
