"use client";

/**
 * /admin/feedback — Dashboard NPS para admin (R152dd).
 *
 * Visualiza el feedback agregado por flujo (voucher.crear, voucher.firmar,
 * transferencia.confirmar, etc.) con:
 *   - DonutKPI por flujo: % positivos vs % negativos
 *   - Tabla detallada con muestra y comentarios recientes
 *   - Filtro por flujo (solo flujos con datos)
 *
 * Solo accesible a app_role='admin' (backend ya filtra).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MessageSquare,
  TrendingUp,
  TrendingDown,
  Smile,
  Frown,
  Meh,
  MessageCircle,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
// R152uu — Lazy DonutKPI (recharts ~80kB). ChartCard y AnimatedNumber NO usan recharts.
import {
  ChartCard,
  LazyDonutKPI as DonutKPI,
  AnimatedNumber,
} from "@/components/charts/lazy";

interface Comment {
  comment: string | null;
  score: number;
  created_at: string;
}

interface FeedbackSummary {
  action_type: string;
  total: number;
  avg_score: number;
  pct_positive: number;
  pct_negative: number;
  last_comments: Comment[];
}

const ACTION_LABELS: Record<string, string> = {
  "voucher.crear": "Crear voucher",
  "voucher.firmar": "Firmar voucher",
  "voucher.bulk": "Bulk firmas",
  "transferencia.confirmar": "Confirmar pago",
  "rendicion.corfo": "Rendición CORFO",
  "aprender.completar": "Completar módulo",
};

function actionLabel(key: string): string {
  return ACTION_LABELS[key] ?? key;
}

function scoreEmoji(score: number) {
  if (score === 3) return { icon: Smile, color: "text-emerald-600", label: "Fácil" };
  if (score === 2) return { icon: Meh, color: "text-amber-600", label: "Ok" };
  return { icon: Frown, color: "text-red-600", label: "Difícil" };
}

export default function FeedbackDashboardPage() {
  const { session } = useSession();
  const [selectedAction, setSelectedAction] = useState<string | null>(null);

  const { data: rows, isLoading, error } = useQuery<FeedbackSummary[]>({
    queryKey: ["admin", "feedback", "summary"],
    queryFn: () =>
      apiClient.get<FeedbackSummary[]>("/admin/feedback/summary", session),
    enabled: !!session,
    staleTime: 5 * 60_000, // R152ww — feedback cambia lentamente (5 min)
  });

  const totals = useMemo(() => {
    const all = rows ?? [];
    const total = all.reduce((s, r) => s + r.total, 0);
    const weightedScore = total > 0
      ? all.reduce((s, r) => s + r.avg_score * r.total, 0) / total
      : 0;
    const pctPositive = total > 0
      ? all.reduce((s, r) => s + (r.pct_positive * r.total) / 100, 0) / total * 100
      : 0;
    const pctNegative = total > 0
      ? all.reduce((s, r) => s + (r.pct_negative * r.total) / 100, 0) / total * 100
      : 0;
    return {
      total,
      avg: weightedScore,
      pctPositive: Math.round(pctPositive),
      pctNegative: Math.round(pctNegative),
    };
  }, [rows]);

  const selectedRow = useMemo(
    () => rows?.find((r) => r.action_type === selectedAction) ?? null,
    [rows, selectedAction],
  );

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-6 text-sm text-red-900">
          <p className="font-semibold">No se pudo cargar el dashboard de NPS.</p>
          <p className="mt-1 text-xs">
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
          <p className="mt-2 text-xs">Verifica que tu rol sea admin.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green">
          <MessageSquare className="size-6" strokeWidth={1.6} />
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            Feedback de usuarios · NPS
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Comunicación bidireccional · qué tan fácil resulta cada flujo para
            los usuarios. Últimos 90 días.
          </p>
        </div>
      </div>

      {/* Stats globales */}
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Total respuestas
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink-900">
            <AnimatedNumber value={totals.total} format="int" />
          </p>
        </div>
        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Score promedio
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink-900">
            <AnimatedNumber
              value={totals.avg}
              format="decimal"
              decimals={2}
              suffix=" / 3"
            />
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-card">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            <TrendingUp className="size-3.5" />
            Positivos
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-emerald-800">
            <AnimatedNumber value={totals.pctPositive} format="pct" decimals={0} />
          </p>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50/40 p-5 shadow-card">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-700">
            <TrendingDown className="size-3.5" />
            Negativos
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-red-800">
            <AnimatedNumber value={totals.pctNegative} format="pct" decimals={0} />
          </p>
        </div>
      </div>

      {/* Donuts por flujo */}
      <h2 className="mt-10 mb-4 text-xs font-semibold uppercase tracking-wider text-ink-400">
        Salud por flujo · click para detalles
      </h2>
      {isLoading ? (
        <ChartCard title="Cargando…" loading={true}>
          <div />
        </ChartCard>
      ) : (rows ?? []).length === 0 ? (
        <ChartCard
          title="Sin feedback todavía"
          empty
          emptyMessage="Cuando los usuarios respondan los prompts de feedback, los resultados aparecerán aquí."
        >
          <div />
        </ChartCard>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {(rows ?? []).map((r) => {
            const isSelected = selectedAction === r.action_type;
            return (
              <button
                key={r.action_type}
                type="button"
                onClick={() =>
                  setSelectedAction(isSelected ? null : r.action_type)
                }
                className={`group flex flex-col items-center gap-2 rounded-2xl border bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-elevated-lg ${
                  isSelected
                    ? "border-cehta-green ring-2 ring-cehta-green/20"
                    : "border-hairline"
                }`}
              >
                <DonutKPI
                  value={r.pct_positive}
                  total={100}
                  label="positivos"
                  color={
                    r.pct_negative > 30
                      ? "#DC2626"
                      : r.avg_score >= 2.5
                      ? "#10B981"
                      : "#F59E0B"
                  }
                  size={120}
                />
                <p className="text-center text-xs font-semibold text-ink-900">
                  {actionLabel(r.action_type)}
                </p>
                <p className="text-[10px] text-ink-500">{r.total} respuestas</p>
              </button>
            );
          })}
        </div>
      )}

      {/* Detalle del flujo seleccionado */}
      {selectedRow && (
        <section className="mt-8 rounded-2xl border border-hairline bg-white p-6 shadow-card">
          <header className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-ink-900">
                {actionLabel(selectedRow.action_type)}
              </h3>
              <p className="mt-0.5 text-xs text-ink-500">
                {selectedRow.total} respuestas · score promedio{" "}
                {selectedRow.avg_score.toFixed(2)} / 3
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedAction(null)}
              className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50"
            >
              Cerrar
            </button>
          </header>

          {/* Comentarios recientes */}
          <div className="mt-4">
            <h4 className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              <MessageCircle className="size-3.5" />
              Últimos comentarios ({selectedRow.last_comments.length})
            </h4>
            {selectedRow.last_comments.length === 0 ? (
              <p className="rounded-xl bg-ink-50/40 px-4 py-6 text-center text-xs text-ink-400">
                No hay comentarios escritos todavía.
              </p>
            ) : (
              <div className="space-y-2">
                {selectedRow.last_comments.map((c, i) => {
                  const { icon: Icon, color, label } = scoreEmoji(c.score);
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-3 rounded-xl border border-hairline bg-white px-4 py-3 transition-shadow hover:shadow-card"
                    >
                      <Icon className={`mt-0.5 size-5 shrink-0 ${color}`} strokeWidth={1.6} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink-900">
                          {c.comment || (
                            <span className="italic text-ink-400">
                              (sin comentario)
                            </span>
                          )}
                        </p>
                        <p className="mt-1 text-[10px] text-ink-500">
                          {label} · {new Date(c.created_at).toLocaleDateString("es-CL")}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Concept */}
      <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50/50 p-5 text-sm text-amber-900">
        <p className="font-semibold">
          🎓 Marco: Comunicación bidireccional (Ray Gallegos · Clase 4)
        </p>
        <p className="mt-1.5 text-xs leading-relaxed">
          El feedback negativo no es ruido — es la señal más valiosa. Si un
          flujo tiene <strong>&gt;30% de score 1 (Difícil)</strong>, esa es la
          próxima prioridad de UX. Los comentarios escritos suelen contener el
          "porqué" específico que ningún survey trimestral captura.
        </p>
      </div>
    </div>
  );
}
