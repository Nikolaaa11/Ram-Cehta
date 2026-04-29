"use client";

/**
 * AuditDiffViewer — side-by-side diff de antes/después de una entrada de
 * `audit.action_log`.
 *
 * Renderiza dos columnas (Antes / Después) con fondo rojo claro / verde claro
 * y JSON pretty-printed. Soporta dicts anidados con indentación natural.
 * Apple polish: `ring-hairline`, `bg-white/90`, `shadow-card`, `ease-apple`.
 */
import { Surface } from "@/components/ui/surface";

interface AuditDiffViewerProps {
  before: Record<string, unknown> | null | undefined;
  after: Record<string, unknown> | null | undefined;
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isEmpty(v: Record<string, unknown> | null | undefined): boolean {
  if (v === null || v === undefined) return true;
  return Object.keys(v).length === 0;
}

export function AuditDiffViewer({ before, after }: AuditDiffViewerProps) {
  const beforeEmpty = isEmpty(before);
  const afterEmpty = isEmpty(after);

  if (beforeEmpty && afterEmpty) {
    return (
      <div className="rounded-2xl bg-white/90 p-6 ring-1 ring-hairline shadow-card text-center text-sm text-ink-500">
        Sin diff registrado para esta acción.
      </div>
    );
  }

  return (
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
            {beforeEmpty ? "vacío" : `${Object.keys(before ?? {}).length} cambios`}
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
            {afterEmpty ? "vacío" : `${Object.keys(after ?? {}).length} cambios`}
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
  );
}
