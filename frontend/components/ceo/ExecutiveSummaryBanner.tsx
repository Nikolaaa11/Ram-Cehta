"use client";

/**
 * ExecutiveSummaryBanner — V5 fase 6.
 *
 * Banner narrativo de 1-2 líneas que aparece arriba de los KPIs en el
 * CEO Dashboard. Genera "context setting" antes de que el ejecutivo mire
 * los números crudos.
 *
 * Soft-fail: si Anthropic no está configurado o el endpoint falla,
 * el banner no aparece (no bloquea el resto del dashboard).
 */
import { useQuery } from "@tanstack/react-query";
import { Sparkles, RefreshCw } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";

interface ExecSummary {
  summary: string;
  generated_at: string;
  tokens: { input: number; output: number };
}

export function ExecutiveSummaryBanner() {
  const { session, loading } = useSession();
  const { data, isLoading, refetch, isFetching, error } = useQuery<
    ExecSummary,
    Error
  >({
    queryKey: ["ai", "executive-summary"],
    queryFn: () =>
      apiClient.get<ExecSummary>("/ai/executive-summary", session),
    enabled: !loading && !!session,
    // TTL agresivo — el resumen es estable durante el día, no tiene sentido
    // re-pegarle al LLM en cada navegación.
    staleTime: 60 * 60_000, // 1 hora
    retry: false,
  });

  // Si Anthropic no está configurado (503), ocultamos el banner (no bloquea)
  if (error instanceof ApiError && error.status === 503) {
    return null;
  }

  if (isLoading) {
    return (
      <Surface
        variant="glass"
        padding="compact"
        className="border border-cehta-green/20"
      >
        <div className="flex items-center gap-3">
          <Sparkles
            className="h-4 w-4 shrink-0 animate-pulse text-cehta-green"
            strokeWidth={1.75}
          />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </Surface>
    );
  }

  if (!data) return null;

  return (
    <Surface
      variant="glass"
      padding="compact"
      className="border border-cehta-green/20"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-cehta-green/15 text-cehta-green">
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-cehta-green">
            Resumen ejecutivo · AI
          </p>
          <p className="text-sm leading-relaxed text-ink-800">
            {data.summary}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Regenerar resumen"
          title="Regenerar resumen"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100/40 hover:text-ink-700 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
            strokeWidth={1.75}
          />
        </button>
      </div>
    </Surface>
  );
}
