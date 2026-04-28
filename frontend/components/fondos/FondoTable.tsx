"use client";

import { ChevronRight } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { toDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FondoListItem } from "@/lib/api/schema";

const TIPO_LABEL: Record<string, string> = {
  lp: "LP",
  banco: "Banco",
  programa_estado: "Programa Estado",
  family_office: "Family Office",
  vc: "VC",
  angel: "Angel",
  otro: "Otro",
};

const ESTADO_VARIANT: Record<
  string,
  "success" | "warning" | "info" | "neutral" | "danger"
> = {
  no_contactado: "neutral",
  contactado: "info",
  en_negociacion: "warning",
  cerrado: "success",
  descartado: "danger",
};

const ESTADO_LABEL: Record<string, string> = {
  no_contactado: "No contactado",
  contactado: "Contactado",
  en_negociacion: "En negociación",
  cerrado: "Cerrado",
  descartado: "Descartado",
};

function formatTicket(min?: string | number | null, max?: string | number | null): string {
  if (min == null && max == null) return "—";
  const fmt = (v: string | number | null | undefined) => {
    if (v == null) return "?";
    const n = typeof v === "string" ? Number(v) : v;
    if (Number.isNaN(n)) return "?";
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n}`;
  };
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}`;
  if (min != null) return `≥ ${fmt(min)}`;
  return `≤ ${fmt(max)}`;
}

interface Props {
  items: FondoListItem[];
  onRowClick?: (id: number) => void;
}

export function FondoTable({ items, onRowClick }: Props) {
  return (
    <Surface padding="none">
      <table className="min-w-full divide-y divide-hairline text-sm">
        <thead className="bg-ink-100/40 text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Nombre</th>
            <th className="px-4 py-3 text-left font-medium">Tipo</th>
            <th className="px-4 py-3 text-left font-medium">País</th>
            <th className="px-4 py-3 text-left font-medium">Ticket</th>
            <th className="px-4 py-3 text-left font-medium">Sectores</th>
            <th className="px-4 py-3 text-left font-medium">Estado</th>
            <th className="px-4 py-3 text-left font-medium">Próximo contacto</th>
            <th className="px-4 py-3 text-right font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {items.map((f) => {
            const interactive = !!onRowClick;
            return (
              <tr
                key={f.fondo_id}
                onClick={() => onRowClick?.(f.fondo_id)}
                className={cn(
                  "transition-colors duration-150",
                  interactive && "cursor-pointer hover:bg-ink-100/30",
                )}
              >
                <td className="px-4 py-3 font-medium text-ink-900">{f.nombre}</td>
                <td className="px-4 py-3 text-ink-700">
                  {TIPO_LABEL[f.tipo] ?? f.tipo}
                </td>
                <td className="px-4 py-3 text-ink-700">{f.pais ?? "—"}</td>
                <td className="px-4 py-3 tabular-nums text-ink-700">
                  {formatTicket(f.ticket_min_usd, f.ticket_max_usd)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(f.sectores ?? []).slice(0, 3).map((s) => (
                      <Badge key={s} variant="neutral">
                        {s}
                      </Badge>
                    ))}
                    {(f.sectores?.length ?? 0) > 3 && (
                      <span className="text-xs text-ink-500">
                        +{(f.sectores?.length ?? 0) - 3}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={ESTADO_VARIANT[f.estado_outreach] ?? "neutral"}>
                    {ESTADO_LABEL[f.estado_outreach] ?? f.estado_outreach}
                  </Badge>
                </td>
                <td className="px-4 py-3 tabular-nums text-ink-700">
                  {f.fecha_proximo_contacto ? toDate(f.fecha_proximo_contacto) : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {interactive && (
                    <ChevronRight
                      className="ml-auto h-4 w-4 text-ink-300"
                      strokeWidth={1.75}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Surface>
  );
}
