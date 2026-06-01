"use client";

/**
 * PullToRefreshIndicator — Etapa C
 *
 * Indicador visual que aparece cuando el user esta tirando para refrescar
 * desde el top en mobile. Cambia mensaje al cruzar el threshold.
 */

import { Loader2, RefreshCw } from "lucide-react";
import { PULL_TO_REFRESH_THRESHOLD } from "@/hooks/use-pull-to-refresh";

interface Props {
  pullDistance: number;
  isRefreshing: boolean;
  isPulling: boolean;
}

export function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  isPulling,
}: Props) {
  if (!isPulling && !isRefreshing) return null;
  const reached = pullDistance >= PULL_TO_REFRESH_THRESHOLD;
  const rotation = Math.min(360, (pullDistance / PULL_TO_REFRESH_THRESHOLD) * 360);

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-0 z-50 -translate-x-1/2"
      style={{
        transform: `translate3d(-50%, ${Math.max(0, pullDistance - 30)}px, 0)`,
        transition: isRefreshing ? "transform 200ms" : "none",
      }}
      aria-live="polite"
    >
      <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-lg ring-1 ring-cehta-green/30">
        {isRefreshing ? (
          <Loader2
            className="size-4 animate-spin text-cehta-green"
            strokeWidth={2}
          />
        ) : (
          <RefreshCw
            className={`size-4 ${reached ? "text-cehta-green" : "text-ink-400"}`}
            strokeWidth={2}
            style={{ transform: `rotate(${rotation}deg)` }}
          />
        )}
        <span
          className={`text-xs font-medium ${
            reached ? "text-cehta-green" : "text-ink-500"
          }`}
        >
          {isRefreshing
            ? "Refrescando…"
            : reached
              ? "Soltá para refrescar"
              : "Sigue tirando…"}
        </span>
      </div>
    </div>
  );
}
