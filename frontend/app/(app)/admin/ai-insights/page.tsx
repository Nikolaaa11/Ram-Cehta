"use client";

/**
 * /admin/ai-insights — V5 fase 3.
 *
 * Vista admin que muestra los insights generados por la AI sobre patrones
 * y anomalías regulatorias del FIP CEHTA. Botón "Generar ahora" dispara
 * el endpoint sincrónicamente; el cron nightly (04:00 UTC) los pre-genera
 * cada noche.
 */
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  ChevronLeft,
  CheckCircle2,
  Clock,
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
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface AiInsight {
  severity: "critical" | "warning" | "info" | "positive";
  title: string;
  body: string;
  recommendation: string;
  tags: string[];
}

interface InsightsResponse {
  insights: AiInsight[];
  generated_at: string;
  tokens: { input: number; output: number };
  raw_response: string | null;
}

const SEVERITY_CONFIG: Record<
  string,
  { icon: typeof Info; color: string; bg: string; label: string }
> = {
  critical: {
    icon: AlertTriangle,
    color: "text-negative",
    bg: "border-negative/30 bg-negative/5",
    label: "Crítico",
  },
  warning: {
    icon: TrendingDown,
    color: "text-warning",
    bg: "border-warning/30 bg-warning/5",
    label: "Atención",
  },
  info: {
    icon: Info,
    color: "text-info",
    bg: "border-info/30 bg-info/5",
    label: "Info",
  },
  positive: {
    icon: TrendingUp,
    color: "text-positive",
    bg: "border-positive/30 bg-positive/5",
    label: "Positivo",
  },
};

export default function AiInsightsPage() {
  const { session } = useSession();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<InsightsResponse | null>(null);

  const generate = async () => {
    if (!session) return;
    setLoading(true);
    try {
      const res = await apiClient.post<InsightsResponse>(
        "/ai/insights/generate",
        {},
        session,
      );
      setData(res);
      toast.success(
        res.insights.length > 0
          ? `${res.insights.length} insight${res.insights.length !== 1 ? "s" : ""} generados`
          : "Sin anomalías detectadas — todo OK",
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        toast.error("AI no configurado. Setear ANTHROPIC_API_KEY.");
      } else {
        toast.error(
          err instanceof ApiError ? err.detail : "Error generando insights",
        );
      }
    } finally {
      setLoading(false);
    }
  };

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
              V5 fase 3 · Anomaly detection
            </p>
            <h1 className="mt-1 flex items-center gap-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
              <Sparkles className="h-7 w-7 text-cehta-green" strokeWidth={1.5} />
              AI Insights
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              Claude analiza patrones cross-empresa y destaca anomalías que
              requieren atención. El cron nightly los genera cada noche a la
              01:00 Chile.
            </p>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
            )}
            {loading ? "Analizando…" : "Generar ahora"}
          </button>
        </div>
      </div>

      {/* Estado inicial */}
      {!data && !loading && (
        <Surface className="py-16 text-center">
          <Brain
            className="mx-auto mb-3 h-12 w-12 text-ink-300"
            strokeWidth={1.5}
          />
          <p className="text-base font-semibold text-ink-900">
            Sin insights generados todavía
          </p>
          <p className="mt-1 text-sm text-ink-500">
            Click en "Generar ahora" para que Claude analice el estado actual
            del sistema. Toma ~15 segundos.
          </p>
        </Surface>
      )}

      {/* Loading state */}
      {loading && !data && (
        <Surface className="flex items-center justify-center gap-3 py-16">
          <Brain
            className="h-6 w-6 animate-pulse text-cehta-green"
            strokeWidth={1.5}
          />
          <div>
            <p className="font-medium text-ink-900">
              Analizando estado regulatorio…
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              Pull de compliance · workload · histórico fallidos · concentración
              próximos 30d
            </p>
          </div>
        </Surface>
      )}

      {/* Resultado */}
      {data && (
        <>
          {/* Header con metadata */}
          <Surface
            variant="glass"
            padding="compact"
            className="border border-cehta-green/20"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-3">
                <Clock
                  className="h-3.5 w-3.5 text-ink-400"
                  strokeWidth={1.75}
                />
                <span className="text-ink-700">
                  Generado{" "}
                  <strong>
                    {new Date(data.generated_at).toLocaleString("es-CL", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </strong>
                </span>
              </div>
              <div className="text-ink-500">
                {data.insights.length} insight
                {data.insights.length !== 1 ? "s" : ""} ·{" "}
                {data.tokens.input + data.tokens.output} tokens
              </div>
            </div>
          </Surface>

          {/* Estado vacío feliz */}
          {data.insights.length === 0 && !data.raw_response && (
            <Surface className="py-12 text-center">
              <CheckCircle2
                className="mx-auto mb-3 h-10 w-10 text-positive"
                strokeWidth={1.5}
              />
              <p className="text-base font-semibold text-positive">
                Todo bajo control
              </p>
              <p className="mt-1 text-sm text-ink-500">
                Claude no encontró anomalías destacables. Sin patrones
                preocupantes en compliance, workload, ni concentraciones.
              </p>
            </Surface>
          )}

          {/* Parse fallido — debug view */}
          {data.insights.length === 0 && data.raw_response && (
            <Surface className="border border-warning/30 bg-warning/5">
              <Surface.Title className="flex items-center gap-2 text-warning">
                <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
                Claude devolvió respuesta no parseable
              </Surface.Title>
              <Surface.Subtitle>
                El JSON output no se pudo interpretar. Mostramos el raw para
                debug.
              </Surface.Subtitle>
              <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-ink-900 p-3 font-mono text-[10px] text-ink-100">
                {data.raw_response}
              </pre>
            </Surface>
          )}

          {/* Insights list */}
          {data.insights.length > 0 && (
            <div className="space-y-3">
              {data.insights.map((insight, idx) => {
                const cfg =
                  SEVERITY_CONFIG[insight.severity] ?? SEVERITY_CONFIG.info!;
                const Icon = cfg.icon;
                return (
                  <Surface
                    key={idx}
                    className={cn("border", cfg.bg)}
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
                              "rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              cfg.color,
                              "bg-white",
                            )}
                          >
                            {cfg.label}
                          </span>
                          {insight.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-600"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                        <h3 className="mt-1 text-base font-semibold text-ink-900">
                          {insight.title}
                        </h3>
                        <p className="mt-1 text-sm text-ink-700">
                          {insight.body}
                        </p>
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
                      </div>
                    </div>
                  </Surface>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Footer informativo */}
      <p className="border-t border-hairline pt-3 text-[10px] text-ink-500">
        Los insights son generados por Claude analizando datos reales del
        sistema. Son sugerencias — siempre verificá con tu juicio operativo
        antes de tomar acciones. El cron nightly corre a las 04:00 UTC
        (01:00 Chile) y guarda los resultados en logs de GitHub Actions.
      </p>
    </div>
  );
}
