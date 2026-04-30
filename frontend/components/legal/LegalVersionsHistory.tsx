"use client";

/**
 * LegalVersionsHistory — drawer con timeline de versiones de un documento
 * legal. Cada versión muestra:
 *   - badge `v{n}` + timestamp relativo
 *   - email del editor
 *   - change_summary auto-generado server-side
 *   - botón "Ver detalle" (expande snapshot pretty-printed)
 *   - botón "Comparar con actual" (abre `LegalVersionCompare`)
 *   - botón "Restaurar esta versión" (admin-only, con confirmación)
 *
 * Forward-only: el restore NO sobreescribe historia, crea 2 nuevas versiones
 * (pre-restore + post-restore) — comportamiento documentado en el alert
 * de confirmación.
 */
import { useState } from "react";
import { History, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useMe } from "@/hooks/use-me";
import {
  useLegalVersions,
  useRestoreLegalVersion,
} from "@/hooks/use-legal-versions";
import { ApiError } from "@/lib/api/client";
import { toDateTime } from "@/lib/format";
import { LegalVersionCompare } from "./LegalVersionCompare";

interface Props {
  documentoId: number;
  trigger?: React.ReactNode;
}

export function LegalVersionsHistory({ documentoId, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [compareVersion, setCompareVersion] = useState<number | null>(null);
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null);

  const { data: me } = useMe();
  const isAdmin = me?.app_role === "admin";

  const { data, isLoading, error } = useLegalVersions(documentoId, open);
  const restore = useRestoreLegalVersion(documentoId);

  const isForbidden = error instanceof ApiError && error.status === 403;
  const versions = data ?? [];

  const handleRestore = (versionNumber: number) => {
    restore.mutate(versionNumber, {
      onSuccess: () => {
        toast.success(`Versión ${versionNumber} restaurada`);
        setRestoreVersion(null);
      },
      onError: (err) => {
        const detail =
          err instanceof ApiError ? err.detail : "Error al restaurar";
        toast.error(detail);
        setRestoreVersion(null);
      },
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          {trigger ?? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
            >
              <History className="h-3.5 w-3.5" strokeWidth={1.5} />
              Versiones
            </button>
          )}
        </DialogTrigger>
        <DialogContent
          hideClose
          className="max-w-3xl bg-white/90 shadow-card ring-hairline backdrop-blur-xl"
        >
          <div className="flex items-start justify-between gap-4 pb-3">
            <div>
              <DialogTitle className="font-display text-lg">
                Historial de versiones
              </DialogTitle>
              <DialogDescription>
                Documento <span className="font-mono text-xs">{documentoId}</span>
                {" — "}
                {versions.length} versión{versions.length === 1 ? "" : "es"}
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar"
              className="rounded-lg p-1 text-ink-500 transition-colors hover:bg-ink-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>

          {isForbidden && (
            <Surface className="bg-warning/5 ring-warning/20">
              <p className="text-sm font-medium text-warning">
                No tenés permisos para ver el historial de este documento.
              </p>
            </Surface>
          )}

          {!isForbidden && isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          )}

          {!isForbidden && !isLoading && versions.length === 0 && (
            <p className="py-6 text-center text-sm text-ink-500">
              Sin versiones registradas para este documento.
            </p>
          )}

          {!isForbidden && versions.length > 0 && (
            <ul className="max-h-[60vh] space-y-2 overflow-auto pr-1">
              {versions.map((v, idx) => {
                const isCurrent = idx === 0;
                const expandedNow = expanded === v.version_number;
                return (
                  <li key={v.version_id}>
                    <Surface
                      padding="compact"
                      className="bg-white/90 ring-hairline"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={isCurrent ? "success" : "neutral"}>
                            v{v.version_number}
                          </Badge>
                          {isCurrent && (
                            <span className="text-[11px] font-medium uppercase tracking-wide text-positive">
                              Más reciente
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] tabular-nums text-ink-500">
                          {toDateTime(v.changed_at)}
                        </span>
                      </div>

                      <p className="mt-1.5 text-sm text-ink-900">
                        {v.change_summary ?? "—"}
                      </p>
                      <p className="text-[11px] text-ink-500">
                        {v.changed_by ?? "Sistema"}
                      </p>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded(expandedNow ? null : v.version_number)
                          }
                          className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40"
                        >
                          {expandedNow ? "Ocultar detalle" : "Ver detalle"}
                        </button>
                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={() =>
                              setCompareVersion(v.version_number)
                            }
                            className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40"
                          >
                            Comparar con actual
                          </button>
                        )}
                        {isAdmin && !isCurrent && (
                          <button
                            type="button"
                            onClick={() =>
                              setRestoreVersion(v.version_number)
                            }
                            className="inline-flex items-center gap-1 rounded-lg bg-cehta-green/10 px-2.5 py-1 text-[11px] font-medium text-cehta-green ring-1 ring-cehta-green/30 transition-colors duration-150 ease-apple hover:bg-cehta-green/20"
                          >
                            <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
                            Restaurar
                          </button>
                        )}
                      </div>

                      {expandedNow && (
                        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-ink-100/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-900 ring-1 ring-hairline">
                          {JSON.stringify(v.snapshot, null, 2)}
                        </pre>
                      )}
                    </Surface>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <LegalVersionCompare
        documentoId={documentoId}
        versionNumber={compareVersion}
        onOpenChange={(o) => !o && setCompareVersion(null)}
      />

      <AlertDialog
        open={restoreVersion !== null}
        onOpenChange={(o) => !o && setRestoreVersion(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Restaurar versión {restoreVersion}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción reemplaza el contenido actual del documento con el
              snapshot de la versión {restoreVersion}. La historia se preserva:
              se crearán dos nuevas versiones (estado previo + estado
              restaurado) — nada se sobreescribe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restore.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={restore.isPending || restoreVersion === null}
              onClick={() => {
                if (restoreVersion !== null) handleRestore(restoreVersion);
              }}
            >
              {restore.isPending ? "Restaurando…" : "Restaurar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
