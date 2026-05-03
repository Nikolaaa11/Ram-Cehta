"use client";

/**
 * /admin/ai-insights — V5 fase 4.
 *
 * Inbox de insights generados por AI sobre patrones y anomalías regulatorias.
 * Carga al montar los insights persistidos en BD (cron nightly los genera).
 * Botón "Generar ahora" dispara el endpoint sincrónicamente.
 *
 * Cada insight tiene 2 estados: read / dismissed. Acciones:
 *   - Click "Marcar leído" → read_at = now()
 *   - Click "Archivar" → dismissed_at = now()
 *   - Toggle "Mostrar archivados" para ver el histórico
 */
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowRight,
  Brain,
  ChevronLeft,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { toast } from "sonner";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface AiInsight {
  insight_id: number;
  severity: "critical" | "warning" | "info" | "positive";
  title: string;
  body: string;
  recommendation: string;
  tags: string[];
  read_at: string | null;
  dismissed_at: string | null;
  generated_at: string;
  created_at: string;
}

interface GenerateResponse {
  insights: Array<{
    severity: string;
    title: string;
    body: string;
    recommendation: string;
    tags: string[];
  }>;
  generated_at: string;
  tokens: { input: number; output: number };
  raw_response: string | null;
  persisted_count: number;
}

const SEVERITY_CONFIG: Record<
  string,
  { icon: typeof Info; color: string; bg: string; label: string; rank: number }
> = {
  critical: {
    icon: AlertTriangle,
    color: "text-negative",
    bg: "border-negative/30 bg-negative/5",
    label: "Crítico",
    rank: 0,
  },
  warning: {
    icon: TrendingDown,
    color: "text-warning",
    bg: "border-warning/30 bg-warning/5",
    label: "Atención",
    rank: 1,
  },
  info: {
    icon: Info,
    color: "text-info",
    bg: "border-info/30 bg-info/5",
    label: "Info",
    rank: 2,
  },
  positive: {
    icon: TrendingUp,
    color: "text-positive",
    bg: "border-positive/30 bg-positive/5",
    label: "Positivo",
    rank: 3,
  },
};

export default function AiInsightsPage() {
  const { session } = useSession();
  const [insights, setInsights] = useState<AiInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);

  const loadList = async () => {
    if (!session) return;
    setLoading(true);
    try {
      const list = await apiClient.get<AiInsight[]>(
        `/ai/insights?include_dismissed=${includeDismissed}&limit=100`,
        session,
      );
      setInsights(list);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "Error cargando insights",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, includeDismissed]);

  const generate = async () => {
    if (!session) return;
    setGenerating(true);
    try {
      const res = await apiClient.post<GenerateResponse>(
        "/ai/insights/generate",
        {},
        session,
      );
      const newCount = res.persisted_count;
      const totalGenerated = res.insights.length;
      if (totalGenerated === 0) {
        toast.success("Sin anomalías detectadas — todo OK");
      } else if (newCount === 0) {
        toast.info(
          `${totalGenerated} insights generados, pero todos ya estaban en el inbox.`,
        );
      } else {
        toast.success(
          `${newCount} insight${newCount !== 1 ? "s" : ""} nuevos guardados`,
        );
      }
      await loadList();
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        toast.error("AI no configurado. Setear ANTHROPIC_API_KEY.");
      } else {
        toast.error(
          err instanceof ApiError ? err.detail : "Error generando insights",
        );
      }
    } finally {
      setGenerating(false);
    }
  };

  const updateInsight = async (
    id: number,
    body: { read?: boolean; dismissed?: boolean },
  ) => {
    if (!session) return;
    setActingId(id);
    try {
      const updated = await apiClient.patch<AiInsight>(
        `/ai/insights/${id}`,
        body,
        session,
      );
      setInsights((prev) =>
        prev.map((it) => (it.insight_id === id ? updated : it)),
      );
      // Si dismiss y no estamos mostrando dismissed → quitarlo de la lista
      if (body.dismissed && !includeDismissed) {
        setInsights((prev) => prev.filter((it) => it.insight_id !== id));
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "Error actualizando insight",
      );
    } finally {
      setActingId(null);
    }
  };

  const visibleInsights = insights.filter((it) =>
    includeDismissed ? true : it.dismissed_at === null,
  );

  const unreadCount = visibleInsights.filter(
    (it) => it.read_at === null && it.dismissed_at === null,
  ).length;

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 px-6 py-6 lg:px-10">
      <div>
        <Link
          href={"/admin" as Route}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          Panel admin
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              V5 fase 4 · Inbox de insights
            </p>
            <h1 className="mt-1 flex items-center gap-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
              <Sparkles className="h-7 w-7 text-cehta-green" strokeWidth={1.5} />
              AI Insights
              {unreadCount > 0 && (
                <span className="ml-2 inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-negative px-2 text-xs font-bold text-white">
                  {unreadCount}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              Anomalías generadas por Claude. Cron nightly a las 01:00 Chile.
              Click &quot;Generar ahora&quot; para forzar análisis.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIncludeDismissed((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-50"
            >
              {includeDismissed ? (
                <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
              ) : (
                <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              {includeDismissed ? "Ocultar archivados" : "Mostrar archivados"}
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-60"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
              )}
              {generating ? "Analizando…" : "Generar ahora"}
            </button>
          </div>
        </div>
      </div>

      {/* Loading inicial */}
      {loading && insights.length === 0 && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      )}

      {/* Estado vacío */}
      {!loading && visibleInsights.length === 0 && (
        <Surface className="py-16 text-center">
          {includeDismissed ? (
            <Archive
              className="mx-auto mb-3 h-12 w-12 text-ink-300"
              strokeWidth={1.5}
            />
          ) : (
            <CheckCircle2
              className="mx-auto mb-3 h-12 w-12 text-positive"
              strokeWidth={1.5}
            />
          )}
          <p className="text-base font-semibold text-ink-900">
            {includeDismissed
              ? "Sin insights archivados"
              : "Todo bajo control"}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {includeDismissed
              ? "No hay insights cerrados todavía."
              : "Sin anomalías detectadas. El cron corre cada noche y aparecerán acá si hay algo."}
          </p>
          {!includeDismissed && (
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-60"
            >
              <Brain className="h-3.5 w-3.5" strokeWidth={1.75} />
              Forzar análisis ahora
            </button>
          )}
        </Surface>
      )}

      {/* Insights list */}
      {visibleInsights.length > 0 && (
        <div className="space-y-3">
          {visibleInsights.map((insight) => {
            const cfg =
              SEVERITY_CONFIG[insight.severity] ?? SEVERITY_CONFIG.info!;
            const Icon = cfg.icon;
            const isUnread = !insight.read_at && !insight.dismissed_at;
            const isDismissed = !!insight.dismissed_at;
            const isActing = actingId === insight.insight_id;
            return (
              <Surface
                key={insight.insight_id}
                className={cn(
                  "border transition-opacity",
                  cfg.bg,
                  isDismissed && "opacity-60",
                  isUnread && "ring-2 ring-cehta-green/20",
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white",
                      cfg.color,
                    )}
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                          cfg.color,
                        )}
                      >
                        {cfg.label}
                      </span>
                      {isUnread && (
                        <span className="rounded bg-cehta-green/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cehta-green">
                          Nuevo
                        </span>
                      )}
                      {isDismissed && (
                        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                          Archivado
                        </span>
                      )}
                      {insight.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-600"
                        >
                          {tag}
                        </span>
                      ))}
                      <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-ink-500">
                        <Clock className="h-3 w-3" strokeWidth={1.75} />
                        {new Date(insight.created_at).toLocaleString("es-CL", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <h3 className="mt-1 text-base font-semibold text-ink-900">
                      {insight.title}
                    </h3>
                    <p className="mt-1 text-sm text-ink-700">{insight.body}</p>
                    {insight.recommendation && (
                      <div className="mt-2 flex items-start gap-2 rounded-lg bg-white/70 px-3 py-2">
                        <ArrowRight
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cehta-green"
                          strokeWidth={2}
                        />
                        <p className="text-xs text-ink-700">
                          <span className="font-semibold text-cehta-green">
                            Recomendación:
                          </span>{" "}
                          {insight.recommendation}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {!insight.read_at && !insight.dismissed_at && (
                        <button
                          type="button"
                          onClick={() =>
                            updateInsight(insight.insight_id, { read: true })
                          }
                          disabled={isActing}
                          className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-1 text-[11px] font-medium text-ink-600 hover:bg-ink-50 disabled:opacity-60"
                        >
                          <Eye className="h-3 w-3" strokeWidth={1.75} />
                          Marcar leído
                        </button>
                      )}
                      {!insight.dismissed_at ? (
                        <button
                          type="button"
                          onClick={() =>
                            updateInsight(insight.insight_id, {
                              dismissed: true,
                            })
                          }
                          disabled={isActing}
                          className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-1 text-[11px] font-medium text-ink-600 hover:bg-ink-50 disabled:opacity-60"
                        >
                          <Archive className="h-3 w-3" strokeWidth={1.75} />
                          Archivar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            updateInsight(insight.insight_id, {
                              dismissed: false,
                            })
                          }
                          disabled={isActing}
                          className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-1 text-[11px] font-medium text-ink-600 hover:bg-ink-50 disabled:opacity-60"
                        >
                          <ArchiveRestore
                            className="h-3 w-3"
                            strokeWidth={1.75}
                          />
                          Restaurar
                        </button>
                      )}
                      {isActing && (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin text-ink-400"
                          strokeWidth={2}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </Surface>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <p className="border-t border-hairline pt-3 text-[10px] text-ink-500">
        Insights generados por Claude analizando datos reales del sistema. El
        cron nightly corre a las 04:00 UTC (01:00 Chile). Idempotente — si
        un insight ya está abierto en el inbox, no se duplica al re-analizar.
      </p>
    </div>
  );
}
