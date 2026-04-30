"use client";

/**
 * LegalVersionCompare — modal con diff side-by-side de una versión histórica
 * vs el estado actual del documento. Reusa el patrón visual de
 * `AuditDiffViewer` (rojo/verde + JSON pretty-printed) pero filtra para
 * mostrar SÓLO las claves que cambiaron — el ruido del snapshot completo
 * no aporta a la lectura del operario.
 *
 * Endpoint: GET /legal/{id}/versions/{n}/compare
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { useLegalVersionCompare } from "@/hooks/use-legal-versions";

interface Props {
  documentoId: number;
  versionNumber: number | null;
  onOpenChange: (open: boolean) => void;
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function LegalVersionCompare({
  documentoId,
  versionNumber,
  onOpenChange,
}: Props) {
  const open = versionNumber !== null;
  const { data, isLoading, error } = useLegalVersionCompare(
    documentoId,
    versionNumber,
  );
  const diffEntries = data ? Object.entries(data.diff) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl bg-white/90 shadow-card ring-hairline backdrop-blur-xl">
        <DialogTitle className="font-display text-lg">
          Comparar versión {versionNumber} vs actual
        </DialogTitle>
        <DialogDescription>
          Sólo se muestran las claves que difieren entre las dos versiones.
        </DialogDescription>

        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {error && (
          <Surface className="border border-negative/20 bg-negative/5">
            <p className="text-sm text-negative">
              Error al cargar la comparación.
            </p>
          </Surface>
        )}

        {data && diffEntries.length === 0 && (
          <p className="rounded-2xl bg-white/90 p-6 text-center text-sm text-ink-500 ring-1 ring-hairline shadow-card">
            Esta versión es idéntica al estado actual.
          </p>
        )}

        {data && diffEntries.length > 0 && (
          <div className="space-y-2">
            {diffEntries.map(([key, { before, after }]) => (
              <div
                key={key}
                className="grid gap-2 rounded-2xl bg-white/90 p-3 ring-1 ring-hairline shadow-card md:grid-cols-[140px_1fr_1fr]"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-700">
                  {key}
                </span>
                <Surface
                  padding="none"
                  className="overflow-hidden ring-hairline"
                >
                  <div className="border-b border-hairline bg-negative/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-negative">
                    v{versionNumber}
                  </div>
                  <pre className="max-h-32 overflow-auto bg-negative/[0.04] px-3 py-2 font-mono text-xs leading-relaxed text-ink-900">
                    {formatJson(before)}
                  </pre>
                </Surface>
                <Surface
                  padding="none"
                  className="overflow-hidden ring-hairline"
                >
                  <div className="border-b border-hairline bg-positive/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-positive">
                    Actual
                  </div>
                  <pre className="max-h-32 overflow-auto bg-positive/[0.04] px-3 py-2 font-mono text-xs leading-relaxed text-ink-900">
                    {formatJson(after)}
                  </pre>
                </Surface>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
