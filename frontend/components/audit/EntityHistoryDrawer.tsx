"use client";

/**
 * EntityHistoryDrawer — Dialog reutilizable que muestra el historial de
 * cambios para una entidad concreta (entity_type + entity_id).
 *
 * Uso:
 *   <EntityHistoryDrawer
 *     entityType="orden_compra"
 *     entityId={oc.oc_id.toString()}
 *     trigger={<Button>Ver historial</Button>}
 *   />
 *
 * Apple polish: ring-hairline, bg-white/90, shadow-card, ease-apple.
 */
import { useState } from "react";
import { History, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useApiQuery } from "@/hooks/use-api-query";
import { ADMIN_ENDPOINTS } from "@/lib/admin/queries";
import type { AuditLogList, AuditLogRead, Page } from "@/lib/api/schema";
import { toDateTime } from "@/lib/format";
import { ApiError } from "@/lib/api/client";
import { AuditDiffViewer } from "@/components/audit/AuditDiffViewer";

interface EntityHistoryDrawerProps {
  entityType: string;
  entityId: string;
  trigger?: React.ReactNode;
}

function actionVariant(
  action: string,
): "success" | "info" | "warning" | "danger" | "neutral" {
  switch (action) {
    case "create":
      return "success";
    case "update":
      return "info";
    case "approve":
      return "success";
    case "reject":
    case "delete":
      return "danger";
    case "sync":
    case "upload":
      return "info";
    default:
      return "neutral";
  }
}

export function EntityHistoryDrawer({
  entityType,
  entityId,
  trigger,
}: EntityHistoryDrawerProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const path = ADMIN_ENDPOINTS.auditEntityHistory(entityType, entityId, {
    size: 50,
  });

  const { data, isLoading, error } = useApiQuery<Page<AuditLogList>>(
    ["audit-history", entityType, entityId, String(open)],
    path,
    open, // sólo fetchea cuando el drawer está abierto
  );

  const detailPath = selected
    ? ADMIN_ENDPOINTS.auditAction(selected)
    : "/audit/actions/__noop__";
  const { data: detail } = useApiQuery<AuditLogRead>(
    ["audit-detail", selected ?? "none"],
    detailPath,
    open && selected !== null,
  );

  const items = data?.items ?? [];
  const isForbidden = error instanceof ApiError && error.status === 403;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
          >
            <History className="h-3.5 w-3.5" strokeWidth={1.5} />
            Historial
          </button>
        )}
      </DialogTrigger>
      <DialogContent
        hideClose
        className="max-w-4xl bg-white/90 shadow-card ring-hairline backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-4 pb-3">
          <div>
            <DialogTitle className="font-display text-lg">
              Historial de cambios
            </DialogTitle>
            <DialogDescription>
              {entityType} ·{" "}
              <span className="font-mono text-xs">{entityId}</span>
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
              Solo administradores pueden ver el historial de auditoría.
            </p>
          </Surface>
        )}

        {!isForbidden && isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {!isForbidden && !isLoading && items.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-500">
            Sin cambios registrados para esta entidad.
          </p>
        )}

        {!isForbidden && items.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            {/* Timeline */}
            <ul className="max-h-[60vh] space-y-1.5 overflow-auto pr-1">
              {items.map((it) => {
                const active = selected === it.id;
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(it.id)}
                      className={
                        "flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left ring-1 transition-all duration-150 ease-apple " +
                        (active
                          ? "bg-cehta-green/10 ring-cehta-green/40 shadow-card"
                          : "bg-white/90 ring-hairline hover:bg-ink-100/40")
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={actionVariant(it.action)}>
                          {it.action}
                        </Badge>
                        <span className="text-[11px] tabular-nums text-ink-500">
                          {toDateTime(it.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-ink-700 line-clamp-2">
                        {it.summary}
                      </p>
                      <p className="text-[11px] text-ink-500">
                        {it.user_email ?? "—"}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Detail / diff */}
            <div className="min-w-0">
              {selected === null ? (
                <div className="rounded-2xl bg-white/90 p-6 text-center text-sm text-ink-500 ring-1 ring-hairline shadow-card">
                  Seleccioná una entrada para ver el diff.
                </div>
              ) : detail ? (
                <AuditDiffViewer
                  before={detail.diff_before}
                  after={detail.diff_after}
                />
              ) : (
                <Skeleton className="h-40 w-full" />
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
