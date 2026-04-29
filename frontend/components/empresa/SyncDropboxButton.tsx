"use client";

/**
 * SyncDropboxButton — dispara POST /{resource}/sync-dropbox/{empresa}.
 *
 * - Toast con resultado: "5 nuevos, 12 ya existentes".
 * - Soft-fail si Dropbox no está conectado (503): toast con mensaje útil.
 * - Permisos (Disciplina 3): chequea allowed_actions antes de mostrar el botón.
 */
import { useMutation } from "@tanstack/react-query";
import { Cloud, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { useMe } from "@/hooks/use-me";
import { apiClient, ApiError } from "@/lib/api/client";

export type SyncResource = "trabajadores" | "legal" | "f29";

interface SyncResult {
  created_trabajadores?: number;
  created_documentos?: number;
  created_legal?: number;
  created_f29?: number;
  skipped?: number;
  errors?: string[];
}

interface Props {
  empresaCodigo: string;
  resource: SyncResource;
  onSynced?: () => void;
  variant?: "default" | "compact";
}

const SCOPE_FOR: Record<SyncResource, string> = {
  trabajadores: "trabajador:update",
  legal: "legal:create",
  f29: "f29:create",
};

const LABEL_FOR: Record<SyncResource, string> = {
  trabajadores: "Sincronizar Dropbox",
  legal: "Sincronizar Dropbox",
  f29: "Sincronizar Dropbox",
};

function summarize(resource: SyncResource, r: SyncResult): string {
  const parts: string[] = [];
  if (resource === "trabajadores") {
    if (r.created_trabajadores) parts.push(`${r.created_trabajadores} trabajadores nuevos`);
    if (r.created_documentos) parts.push(`${r.created_documentos} docs sincronizados`);
  } else if (resource === "legal") {
    if (r.created_legal) parts.push(`${r.created_legal} documentos legales nuevos`);
  } else if (resource === "f29") {
    if (r.created_f29) parts.push(`${r.created_f29} F29 nuevas`);
  }
  if (r.skipped) parts.push(`${r.skipped} ya existentes`);
  return parts.length ? parts.join(", ") : "Nada nuevo que sincronizar";
}

export function SyncDropboxButton({
  empresaCodigo,
  resource,
  onSynced,
  variant = "default",
}: Props) {
  const { session } = useSession();
  const { data: me } = useMe();
  const canSync = me?.allowed_actions?.includes(SCOPE_FOR[resource]) ?? false;

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<SyncResult>(
        `/${resource}/sync-dropbox/${encodeURIComponent(empresaCodigo)}`,
        {},
        session,
      ),
    onSuccess: (data) => {
      toast.success(summarize(resource, data));
      if (data.errors && data.errors.length > 0) {
        toast.warning(
          `${data.errors.length} error${data.errors.length === 1 ? "" : "es"} durante el sync (revisar logs)`,
        );
      }
      onSynced?.();
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error al sincronizar Dropbox";
      toast.error(detail);
    },
  });

  if (!canSync) return null;

  const compactClass =
    "inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green disabled:opacity-60";
  const defaultClass =
    "inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60";

  return (
    <button
      type="button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className={variant === "compact" ? compactClass : defaultClass}
      title={LABEL_FOR[resource]}
    >
      {mutation.isPending ? (
        <RefreshCw
          className={
            variant === "compact"
              ? "h-3.5 w-3.5 animate-spin"
              : "h-4 w-4 animate-spin"
          }
          strokeWidth={1.5}
        />
      ) : (
        <Cloud
          className={variant === "compact" ? "h-3.5 w-3.5" : "h-4 w-4"}
          strokeWidth={1.5}
        />
      )}
      {mutation.isPending ? "Sincronizando…" : LABEL_FOR[resource]}
    </button>
  );
}
