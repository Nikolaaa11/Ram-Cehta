"use client";

import { cn } from "@/lib/utils";

const TIPO_COLOR: Record<string, string> = {
  f29: "bg-cehta-green",
  reporte_lp: "bg-sf-blue",
  comite: "bg-sf-purple",
  reporte_trimestral: "bg-warning",
  vencimiento: "bg-negative",
  otro: "bg-ink-500",
};

export function EventDot({
  tipo,
  className,
  completado,
}: {
  tipo: string;
  className?: string;
  completado?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        TIPO_COLOR[tipo] ?? "bg-ink-500",
        completado && "opacity-40",
        className,
      )}
      aria-hidden="true"
    />
  );
}

export const TIPO_LABEL: Record<string, string> = {
  f29: "F29",
  reporte_lp: "Reporte LP",
  comite: "Comité",
  reporte_trimestral: "Reporte Trim.",
  vencimiento: "Vencimiento",
  otro: "Otro",
};
