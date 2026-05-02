"use client";

/**
 * AuditDiffViewer — side-by-side diff de antes/después de una entrada de
 * `audit.action_log`.
 *
 * V4 fase 7.10 — agregado modo "Friendly" que muestra solo los campos
 * que cambiaron con labels amigables y highlighting before→after, ideal
 * para revisión en actas de Comité de Vigilancia. El modo "Raw JSON"
 * sigue disponible para debugging técnico.
 *
 * Apple polish: `ring-hairline`, `bg-white/90`, `shadow-card`, `ease-apple`.
 */
import { useMemo, useState } from "react";
import { ArrowRight, Code2, ListFilter } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

interface AuditDiffViewerProps {
  before: Record<string, unknown> | null | undefined;
  after: Record<string, unknown> | null | undefined;
}

// Diccionario de field names → labels amigables.
// Si una key no está acá, se usa el snake_case original.
const FIELD_LABELS: Record<string, string> = {
  estado: "Estado",
  fecha_entrega_real: "Fecha entrega real",
  fecha_limite: "Fecha límite",
  motivo_no_entrega: "Motivo no entrega",
  notas: "Notas",
  adjunto_url: "Adjunto",
  responsable: "Responsable",
  prioridad: "Prioridad",
  alerta_15: "Alerta 15 días",
  alerta_10: "Alerta 10 días",
  alerta_5: "Alerta 5 días",
  nombre: "Nombre",
  descripcion: "Descripción",
  categoria: "Categoría",
  subcategoria: "Subcategoría",
  referencia_normativa: "Ref. normativa",
  periodo: "Período",
  frecuencia: "Frecuencia",
  // OCs / pagos
  numero_oc: "Número OC",
  total: "Total",
  forma_pago: "Forma de pago",
  proveedor_id: "Proveedor",
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, " ");
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatValueShort(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  const s = String(value);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

function isEmpty(v: Record<string, unknown> | null | undefined): boolean {
  if (v === null || v === undefined) return true;
  return Object.keys(v).length === 0;
}

function diffKeys(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { key: string; before: unknown; after: unknown }[] {
  const allKeys = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const out: { key: string; before: unknown; after: unknown }[] = [];
  for (const k of allKeys) {
    const bv = (before as Record<string, unknown> | null | undefined)?.[k];
    const av = (after as Record<string, unknown> | null | undefined)?.[k];
    // Solo incluir si difieren (JSON string compare cubre dict/list)
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      out.push({ key: k, before: bv, after: av });
    }
  }
  return out.sort((a, b) => fieldLabel(a.key).localeCompare(fieldLabel(b.key)));
}

export function AuditDiffViewer({ before, after }: AuditDiffViewerProps) {
  const [mode, setMode] = useState<"friendly" | "raw">("friendly");
  const beforeEmpty = isEmpty(before);
  const afterEmpty = isEmpty(after);

  const changedFields = useMemo(
    () => diffKeys(before, after),
    [before, after],
  );

  if (beforeEmpty && afterEmpty) {
    return (
      <div className="rounded-2xl bg-white/90 p-6 ring-1 ring-hairline shadow-card text-center text-sm text-ink-500">
        Sin diff registrado para esta acción.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="inline-flex rounded-xl bg-ink-100/40 p-0.5 ring-1 ring-hairline">
        <button
          type="button"
          onClick={() => setMode("friendly")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[11px] font-medium transition-all duration-150 ease-apple",
            mode === "friendly"
              ? "bg-white text-ink-900 shadow-card/40"
              : "text-ink-600 hover:bg-white/40",
          )}
        >
          <ListFilter className="h-3 w-3" strokeWidth={1.75} />
          Solo cambios
          {changedFields.length > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-cehta-green/15 px-1 text-[10px] font-semibold text-cehta-green">
              {changedFields.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setMode("raw")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[11px] font-medium transition-all duration-150 ease-apple",
            mode === "raw"
              ? "bg-white text-ink-900 shadow-card/40"
              : "text-ink-600 hover:bg-white/40",
          )}
        >
          <Code2 className="h-3 w-3" strokeWidth={1.75} />
          JSON completo
        </button>
      </div>

      {/* Friendly mode — solo campos que cambiaron */}
      {mode === "friendly" && (
        <Surface padding="none" className="overflow-hidden bg-white">
          {changedFields.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-ink-500">
              Esta acción no modificó ningún campo (probablemente create o
              delete sin diff parcial).
            </div>
          ) : (
            <table className="min-w-full divide-y divide-hairline text-sm">
              <thead className="bg-ink-50/50 text-[10px] uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-2 text-left">Campo</th>
                  <th className="px-4 py-2 text-left">Antes</th>
                  <th className="w-8 px-2 py-2 text-center"></th>
                  <th className="px-4 py-2 text-left">Después</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {changedFields.map(({ key, before: bv, after: av }) => (
                  <tr key={key}>
                    <td className="whitespace-nowrap px-4 py-2 font-medium capitalize text-ink-700">
                      {fieldLabel(key)}
                    </td>
                    <td className="px-4 py-2 align-top">
                      <span className="inline-block rounded-md bg-negative/5 px-2 py-1 font-mono text-[11px] text-negative ring-1 ring-negative/15">
                        {formatValueShort(bv)}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center text-ink-400">
                      <ArrowRight className="mx-auto h-3 w-3" strokeWidth={2} />
                    </td>
                    <td className="px-4 py-2 align-top">
                      <span className="inline-block rounded-md bg-positive/5 px-2 py-1 font-mono text-[11px] text-positive ring-1 ring-positive/15">
                        {formatValueShort(av)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Surface>
      )}

      {/* Raw JSON mode — side-by-side completo */}
      {mode === "raw" && (
        <div className="grid gap-3 md:grid-cols-2">
          {/* Antes */}
          <Surface
            padding="none"
            className="overflow-hidden bg-white/90 ring-hairline shadow-card transition-all duration-200 ease-apple"
          >
            <div className="flex items-center justify-between border-b border-hairline bg-negative/5 px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-negative">
                Antes
              </span>
              <span className="text-[11px] text-ink-500">
                {beforeEmpty ? "vacío" : `${Object.keys(before ?? {}).length} fields`}
              </span>
            </div>
            <pre
              className="max-h-[60vh] overflow-auto px-4 py-3 font-mono text-xs leading-relaxed text-ink-900 bg-negative/[0.04]"
              aria-label="Estado anterior"
            >
              {beforeEmpty ? "—" : formatJson(before)}
            </pre>
          </Surface>

          {/* Después */}
          <Surface
            padding="none"
            className="overflow-hidden bg-white/90 ring-hairline shadow-card transition-all duration-200 ease-apple"
          >
            <div className="flex items-center justify-between border-b border-hairline bg-positive/5 px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-positive">
                Después
              </span>
              <span className="text-[11px] text-ink-500">
                {afterEmpty ? "vacío" : `${Object.keys(after ?? {}).length} fields`}
              </span>
            </div>
            <pre
              className="max-h-[60vh] overflow-auto px-4 py-3 font-mono text-xs leading-relaxed text-ink-900 bg-positive/[0.04]"
              aria-label="Estado posterior"
            >
              {afterEmpty ? "—" : formatJson(after)}
            </pre>
          </Surface>
        </div>
      )}
    </div>
  );
}
