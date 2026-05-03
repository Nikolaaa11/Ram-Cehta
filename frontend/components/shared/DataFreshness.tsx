"use client";

/**
 * DataFreshness — V4 fase 7.15.
 *
 * Indicador inline de cuán fresca es la data de un endpoint. Util para
 * que el usuario vea de un golpe si está mirando un snapshot cached
 * antiguo o data en vivo.
 *
 * Variantes visuales:
 *   - Verde + "ahora" si <1min
 *   - Verde + "hace X" si <5min
 *   - Amarillo + "hace X" si 5-30min
 *   - Rojo pulsante + "stale" si >30min
 *
 * Uso:
 *   <DataFreshness updatedAt={data.last_updated} />
 */
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  updatedAt: string | Date | null | undefined;
  /** Refresh interval del componente para re-renderizar el "hace X". */
  refreshIntervalMs?: number;
  className?: string;
}

function getRelative(date: Date): { text: string; severity: "fresh" | "ok" | "warning" | "stale" } {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return { text: "ahora", severity: "fresh" };
  }
  if (diffMin < 5) {
    return { text: `hace ${diffMin}m`, severity: "fresh" };
  }
  if (diffMin < 30) {
    return { text: `hace ${diffMin}m`, severity: "ok" };
  }
  if (diffHour < 1) {
    return { text: `hace ${diffMin}m`, severity: "warning" };
  }
  if (diffHour < 24) {
    return { text: `hace ${diffHour}h`, severity: "warning" };
  }
  if (diffDay < 7) {
    return { text: `hace ${diffDay}d`, severity: "stale" };
  }
  return { text: date.toLocaleDateString("es-CL"), severity: "stale" };
}

export function DataFreshness({
  updatedAt,
  refreshIntervalMs = 30_000,
  className,
}: Props) {
  // Re-render cada 30s para que el "hace X min" siga fresco
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), refreshIntervalMs);
    return () => clearInterval(id);
  }, [refreshIntervalMs]);

  if (!updatedAt) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[10px] text-ink-400",
          className,
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-ink-300" />
        Sin datos
      </span>
    );
  }

  const date = typeof updatedAt === "string" ? new Date(updatedAt) : updatedAt;
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const { text, severity } = getRelative(date);

  const dotClass = {
    fresh: "bg-positive",
    ok: "bg-cehta-green",
    warning: "bg-warning",
    stale: "bg-negative animate-pulse",
  }[severity];

  const textClass = {
    fresh: "text-positive",
    ok: "text-ink-500",
    warning: "text-warning",
    stale: "text-negative font-medium",
  }[severity];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px]",
        textClass,
        className,
      )}
      title={`Actualizado ${date.toLocaleString("es-CL")}`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
      {text}
    </span>
  );
}
