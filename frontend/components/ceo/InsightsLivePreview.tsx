"use client";

/**
 * InsightsLivePreview — V4 fase 7.13.
 *
 * Reemplaza el bloque estático `report.insights_ai` del CEO Dashboard
 * con un preview de los insights persistidos desde `/ai/insights`. Si el
 * cron nightly los pre-generó, el CEO los ve al toque. Si no hay, muestra
 * el insights_ai estático como fallback.
 */
import {
  AlertTriangle,
  ArrowRight,
  Info,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/api/client";
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
}

const SEVERITY_ICON = {
  critical: AlertTriangle,
  warning: TrendingDown,
  info: Info,
  positive: TrendingUp,
} as const;

const SEVERITY_COLOR = {
  critical: "text-negative",
  warning: "text-warning",
  info: "text-info",
  positive: "text-positive",
} as const;

interface Props {
  /** Texto fallback estático del backend si no hay insights persistidos. */
  fallbackText: string;
}

export function InsightsLivePreview({ fallbackText }: Props) {
  const { session, loading } = useSession();
  const { data, isLoading } = useQuery<AiInsight[], Error>({
    queryKey: ["ai", "insights", "preview"],
    queryFn: () =>
      apiClient.get<AiInsight[]>(
        "/ai/insights?include_dismissed=false&limit=4",
        session,
      ),
    enabled: !loading && !!session,
    staleTime: 5 * 60_000,
  });

  return (
    <Surface className="h-full">
      <Surface.Header>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-cehta-green/10 text-cehta-green">
              <Sparkles className="h-4 w-4" strokeWidth={1.5} />
            </span>
            <Surface.Title>Insights AI</Surface.Title>
          </div>
          <a
            href="/admin/ai-insights"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-cehta-green hover:underline"
          >
            Ver todos <ArrowRight className="h-3 w-3" strokeWidth={2} />
          </a>
        </div>
        <Surface.Subtitle>
          {data && data.length > 0
            ? `Anomalías detectadas por Claude · ${data.length} sin resolver`
            : "Resumen ejecutivo generado por Claude"}
        </Surface.Subtitle>
      </Surface.Header>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        // Live insights del cron nightly
        <ul className="mt-3 space-y-2">
          {data.slice(0, 4).map((insight) => {
            const Icon = SEVERITY_ICON[insight.severity] ?? Info;
            const color = SEVERITY_COLOR[insight.severity] ?? "text-info";
            return (
              <li
                key={insight.insight_id}
                className="flex items-start gap-2.5 rounded-xl border border-hairline bg-white px-3 py-2"
              >
                <Icon
                  className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", color)}
                  strokeWidth={2}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-ink-900">
                    {insight.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-600">
                    {insight.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        // Fallback al texto estático del backend
        <p className="mt-4 text-sm leading-relaxed text-ink-700">
          {fallbackText}
        </p>
      )}
    </Surface>
  );
}
