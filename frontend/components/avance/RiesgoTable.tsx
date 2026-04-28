"use client";

import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { toDate } from "@/lib/format";
import type { RiesgoRead } from "@/lib/api/schema";

const SEVERIDAD_VARIANT: Record<string, "danger" | "warning" | "neutral"> = {
  alta: "danger",
  media: "warning",
  baja: "neutral",
};

const ESTADO_VARIANT: Record<string, "success" | "warning" | "info" | "neutral"> = {
  abierto: "warning",
  mitigado: "info",
  aceptado: "neutral",
  cerrado: "success",
};

interface Props {
  riesgos: RiesgoRead[];
}

export function RiesgoTable({ riesgos }: Props) {
  if (riesgos.length === 0) {
    return (
      <Surface className="text-center">
        <p className="text-sm text-ink-500">Sin riesgos registrados.</p>
      </Surface>
    );
  }

  return (
    <Surface padding="none">
      <table className="min-w-full divide-y divide-hairline text-sm">
        <thead className="bg-ink-100/40 text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Severidad</th>
            <th className="px-4 py-3 text-left font-medium">Título</th>
            <th className="px-4 py-3 text-left font-medium">Probabilidad</th>
            <th className="px-4 py-3 text-left font-medium">Estado</th>
            <th className="px-4 py-3 text-left font-medium">Owner</th>
            <th className="px-4 py-3 text-left font-medium">Identificado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {riesgos.map((r) => (
            <tr key={r.riesgo_id}>
              <td className="px-4 py-3">
                <Badge variant={SEVERIDAD_VARIANT[r.severidad] ?? "neutral"}>
                  {r.severidad}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <p className="font-medium text-ink-900">{r.titulo}</p>
                {r.descripcion && (
                  <p className="line-clamp-1 text-xs text-ink-500">
                    {r.descripcion}
                  </p>
                )}
              </td>
              <td className="px-4 py-3 capitalize text-ink-700">{r.probabilidad}</td>
              <td className="px-4 py-3">
                <Badge variant={ESTADO_VARIANT[r.estado] ?? "neutral"}>
                  {r.estado}
                </Badge>
              </td>
              <td className="px-4 py-3 text-ink-700">{r.owner_email ?? "—"}</td>
              <td className="px-4 py-3 tabular-nums text-ink-700">
                {toDate(r.fecha_identificado)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Surface>
  );
}
