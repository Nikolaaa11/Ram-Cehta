"use client";

import { ChevronRight } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { AlertBadge } from "./AlertBadge";
import { toCLP, toDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LegalDocumentListItem } from "@/lib/api/schema";

const CATEGORIA_LABEL: Record<string, string> = {
  contrato: "Contrato",
  acta: "Acta",
  declaracion_sii: "Declaración SII",
  permiso: "Permiso",
  poliza: "Póliza",
  estatuto: "Estatuto",
  otro: "Otro",
};

const ESTADO_VARIANT: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  vigente: "success",
  vencido: "danger",
  renovado: "neutral",
  cancelado: "neutral",
  borrador: "warning",
};

interface Props {
  items: LegalDocumentListItem[];
  onRowClick?: (id: number) => void;
}

export function LegalDocumentTable({ items, onRowClick }: Props) {
  return (
    <Surface padding="none">
      <table className="min-w-full divide-y divide-hairline text-sm">
        <thead className="bg-ink-100/40 text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Categoría</th>
            <th className="px-4 py-3 text-left font-medium">Nombre</th>
            <th className="px-4 py-3 text-left font-medium">Contraparte</th>
            <th className="px-4 py-3 text-left font-medium">Vigencia</th>
            <th className="px-4 py-3 text-right font-medium">Monto</th>
            <th className="px-4 py-3 text-left font-medium">Estado</th>
            <th className="px-4 py-3 text-right font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {items.map((d) => {
            const interactive = !!onRowClick;
            return (
              <tr
                key={d.documento_id}
                onClick={() => onRowClick?.(d.documento_id)}
                className={cn(
                  "transition-colors duration-150",
                  interactive && "cursor-pointer hover:bg-ink-100/30",
                )}
              >
                <td className="px-4 py-3 text-ink-700">
                  {CATEGORIA_LABEL[d.categoria] ?? d.categoria}
                  {d.subcategoria && (
                    <span className="ml-1 text-xs text-ink-500">
                      · {d.subcategoria}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-medium text-ink-900">{d.nombre}</td>
                <td className="px-4 py-3 text-ink-700">{d.contraparte ?? "—"}</td>
                <td className="px-4 py-3 text-ink-700">
                  {d.fecha_vigencia_hasta ? (
                    <div className="flex flex-col gap-1">
                      <span className="tabular-nums text-xs text-ink-500">
                        {toDate(d.fecha_vigencia_hasta)}
                      </span>
                      <AlertBadge
                        nivel={d.alerta_nivel}
                        diasParaVencer={d.dias_para_vencer}
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-ink-500">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-900">
                  {d.monto != null ? toCLP(d.monto as never) : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={ESTADO_VARIANT[d.estado] ?? "neutral"}>
                    {d.estado}
                  </Badge>
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
