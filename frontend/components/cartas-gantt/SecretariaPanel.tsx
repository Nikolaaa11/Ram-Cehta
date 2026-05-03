"use client";

/**
 * SecretariaPanel — "Claudia" la secretaria virtual de proyectos.
 *
 * Banner sticky en top de /cartas-gantt que muestra 5 bullets accionables
 * priorizados por Claude. Soft-fail: si Anthropic no está configurado,
 * el panel se oculta sin romper.
 *
 * Endpoint: POST /ai/secretaria-tareas (cache 30min server-side).
 * Frontend cache: 30min staleTime.
 *
 * Diseño: glass surface con avatar generado, gradient sutil,
 * bullets con jerarquía visual (URGENTE en negative, normal en ink-700).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, RefreshCw, Loader2, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { useApiQuery } from "@/hooks/use-api-query";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { SecretariaBriefResponse } from "@/lib/api/schema";

interface Props {
  empresa?: string;
  encargado?: string;
  className?: string;
}

export function SecretariaPanel({ empresa, encargado, className }: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);

  const qs = new URLSearchParams();
  if (empresa) qs.set("empresa", empresa);
  if (encargado) qs.set("encargado", encargado);
  const queryString = qs.toString();
  const url = `/ai/secretaria-tareas${queryString ? "?" + queryString : ""}`;

  const queryKey = [
    "ai",
    "secretaria-tareas",
    empresa ?? "",
    encargado ?? "",
  ];
  const query = useApiQuery<SecretariaBriefResponse>(queryKey, url);

  // Mutation para forzar refresh (limpia cache server-side via re-fetch)
  const refresh = useMutation({
    mutationFn: () =>
      apiClient.post<SecretariaBriefResponse>(url, {}, session),
    onSuccess: (data) => {
      qc.setQueryData(queryKey, data);
    },
  });

  // Soft-fail si Anthropic no configurado: 503 → ocultar
  if (query.isError) {
    const err = query.error;
    if (err instanceof ApiError && err.status === 503) {
      return null; // oculta sin romper
    }
  }

  const data = query.data;
  const isLoading = query.isLoading || query.isPending;

  return (
    <Surface
      variant="glass"
      className={cn(
        "border border-cehta-green/20 transition-all",
        className,
      )}
    >
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cehta-green to-cehta-green-700 text-white shadow-md">
            <Sparkles className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-positive ring-2 ring-white" />
        </div>

        <div className="min-w-0 flex-1">
          {/* Header */}
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="font-display text-base font-semibold text-ink-900">
              Claudia
            </h3>
            <span className="text-xs text-ink-500">
              · Tu secretaria de proyectos
            </span>
            {data?.cached && (
              <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-500">
                cache
              </span>
            )}
          </div>

          {/* Subtítulo según estado */}
          {isLoading && (
            <p className="mt-0.5 text-xs text-ink-500">
              Pensando en tus prioridades del día…
            </p>
          )}
          {!isLoading && data && (
            <p className="mt-0.5 text-xs text-ink-500">
              {data.bullets.length} prioridades para hoy ·{" "}
              <button
                type="button"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
                className="inline-flex items-center gap-1 text-cehta-green hover:underline disabled:opacity-60"
              >
                {refresh.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.75} />
                ) : (
                  <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
                )}
                refrescar
              </button>
            </p>
          )}

          {/* Bullets */}
          {!collapsed && (
            <div className="mt-3">
              {isLoading && <BulletsSkeleton />}
              {!isLoading && data && data.bullets.length > 0 && (
                <ul className="space-y-1.5">
                  {data.bullets.map((b, i) => (
                    <BulletItem key={i} text={b} />
                  ))}
                </ul>
              )}
              {!isLoading &&
                data &&
                data.bullets.length === 0 &&
                data.raw_text && (
                  <p className="rounded-xl bg-ink-50/60 px-3 py-2 text-sm text-ink-700">
                    {data.raw_text}
                  </p>
                )}
              {!isLoading && data && data.bullets.length === 0 && !data.raw_text && (
                <p className="text-sm text-ink-500">
                  Sin tareas pendientes — buen trabajo 🎉
                </p>
              )}
            </div>
          )}
        </div>

        {/* Toggle collapse */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expandir" : "Colapsar"}
          className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100/40 hover:text-ink-700"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              collapsed && "-rotate-180",
            )}
            strokeWidth={1.75}
          />
        </button>
      </div>
    </Surface>
  );
}

// ─── Bullet item — detecta urgentes y celebraciones ────────────────────────

function BulletItem({ text }: { text: string }) {
  const isUrgent = text.startsWith("🚨");
  const isCelebration = text.startsWith("🎉");
  const cleanText = text.replace(/^(🚨|🎉)\s*/, "");

  return (
    <li
      className={cn(
        "flex items-start gap-2 rounded-xl px-3 py-2 text-sm leading-relaxed transition-colors",
        isUrgent && "bg-negative/5 text-ink-900 ring-1 ring-negative/20",
        isCelebration && "bg-positive/5 text-ink-900 ring-1 ring-positive/20",
        !isUrgent && !isCelebration && "bg-white/40 text-ink-800 hover:bg-white/70",
      )}
    >
      {isUrgent && <span className="shrink-0 text-base leading-none">🚨</span>}
      {isCelebration && (
        <span className="shrink-0 text-base leading-none">🎉</span>
      )}
      {!isUrgent && !isCelebration && (
        <span
          className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-cehta-green"
          aria-hidden
        />
      )}
      <span className="min-w-0 flex-1">{cleanText}</span>
    </li>
  );
}

function BulletsSkeleton() {
  return (
    <ul className="space-y-2">
      {[100, 90, 95, 85, 75].map((w, i) => (
        <li key={i} className="flex items-start gap-2">
          <Skeleton className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />
          <Skeleton className="h-4 rounded" style={{ width: `${w}%` }} />
        </li>
      ))}
    </ul>
  );
}
