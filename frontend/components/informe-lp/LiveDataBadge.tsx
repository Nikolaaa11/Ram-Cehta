"use client";

/**
 * LiveDataBadge — pill compacto que dice "Actualizado hace X" con un
 * dot verde pulsante. Comunica al LP que los datos del informe son
 * recientes — esto genera confianza diferencial vs PDFs estáticos.
 */
import { useEffect, useState } from "react";

interface Props {
  generatedAt: string | null | undefined;
  className?: string;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "hace segundos";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `hace ${diffD} día${diffD === 1 ? "" : "s"}`;
  const diffM = Math.floor(diffD / 30);
  return `hace ${diffM} mes${diffM === 1 ? "" : "es"}`;
}

export function LiveDataBadge({ generatedAt, className }: Props) {
  const [, setTick] = useState(0);

  // Tick cada 60s para que el "hace X" se actualice
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!generatedAt) return null;
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full bg-positive/10 px-2.5 py-1 text-[11px] font-medium text-positive " +
        (className ?? "")
      }
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-positive" />
      </span>
      <span>Actualizado {relativeTime(generatedAt)}</span>
    </span>
  );
}
