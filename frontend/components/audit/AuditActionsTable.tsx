"use client";

/**
 * AuditActionsTable — listado paginado del audit trail (`audit.action_log`).
 *
 * Filtros: entity_type, action, fecha desde/hasta, user_id (texto libre).
 * Click en una fila → drawer con el diff de antes/después.
 *
 * Apple polish: ring-hairline, bg-white/90, shadow-card, ease-apple.
 */
import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  ListChecks,
  PlugZap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useApiQuery } from "@/hooks/use-api-query";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api/client";
import { toDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  AuditLogList,
  AuditLogRead,
  Page,
} from "@/lib/api/schema";
import { ADMIN_ENDPOINTS } from "@/lib/admin/queries";
import { AuditDiffViewer } from "@/components/audit/AuditDiffViewer";

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "create", label: "Crear" },
  { value: "update", label: "Editar" },
  { value: "delete", label: "Eliminar" },
  { value: "approve", label: "Aprobar" },
  { value: "reject", label: "Rechazar" },
  { value: "sync", label: "Sync" },
  { value: "upload", label: "Upload" },
];

const ENTITY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "orden_compra", label: "Órdenes de Compra" },
  { value: "f29", label: "F29" },
  { value: "f29_batch", label: "F29 (sync)" },
  { value: "legal_document", label: "Legal" },
  { value: "legal_batch", label: "Legal (sync)" },
  { value: "trabajador", label: "Trabajadores" },
  { value: "trabajador_batch", label: "Trabajadores (sync)" },
  { value: "empresa", label: "Empresas" },
  { value: "suscripcion", label: "Suscripciones" },
  { value: "fondo", label: "Fondos" },
  { value: "proveedor", label: "Proveedores" },
];

const COLUMNS = [
  { key: "created_at", label: "Cuándo", align: "left" as const },
  { key: "user", label: "Usuario", align: "left" as const },
  { key: "action", label: "Acción", align: "left" as const },
  { key: "entity", label: "Entidad", align: "left" as const },
  { key: "summary", label: "Resumen", align: "left" as const },
  { key: "ver", label: "", align: "right" as const },
];

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

function TableSkeleton() {
  return (
    <Surface padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-hairline text-sm">
          <thead className="bg-ink-100/40">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-4 py-3 text-xs uppercase tracking-wide text-ink-500 font-medium",
                    c.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="px-4 py-3">
                    <Skeleton className="h-4 w-24" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

export function AuditActionsTable() {
  const [entityType, setEntityType] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const SIZE = 25;

  const path = useMemo(
    () =>
      ADMIN_ENDPOINTS.auditActions({
        entity_type: entityType || undefined,
        action: action || undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        page,
        size: SIZE,
      }),
    [entityType, action, fromDate, toDate, page],
  );

  const { data, isLoading, error } = useApiQuery<Page<AuditLogList>>(
    ["audit-actions", entityType, action, fromDate, toDate, String(page)],
    path,
  );

  const detailPath = selectedId
    ? ADMIN_ENDPOINTS.auditAction(selectedId)
    : "/audit/actions/__noop__";
  const { data: detail } = useApiQuery<AuditLogRead>(
    ["audit-detail", selectedId ?? "none"],
    detailPath,
    selectedId !== null,
  );

  const items = data?.items ?? [];
  const isEndpointMissing =
    error instanceof ApiError && (error.status === 404 || error.status === 405);
  const isForbidden = error instanceof ApiError && error.status === 403;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Surface variant="glass" padding="compact">
        <div className="flex flex-wrap items-end gap-3">
          {/* Entity */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="audit-entity"
              className="text-xs uppercase tracking-wide text-ink-500 font-medium"
            >
              Entidad
            </label>
            <select
              id="audit-entity"
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-xl bg-white px-3 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
            >
              {ENTITY_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Action */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="audit-action"
              className="text-xs uppercase tracking-wide text-ink-500 font-medium"
            >
              Acción
            </label>
            <select
              id="audit-action"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-xl bg-white px-3 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
            >
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="audit-from"
              className="text-xs uppercase tracking-wide text-ink-500 font-medium"
            >
              Desde
            </label>
            <input
              id="audit-from"
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-xl bg-white px-3 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="audit-to"
              className="text-xs uppercase tracking-wide text-ink-500 font-medium"
            >
              Hasta
            </label>
            <input
              id="audit-to"
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-xl bg-white px-3 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
            />
          </div>

          {data && (
            <div className="ml-auto text-xs text-ink-500 tabular-nums">
              {data.total.toLocaleString("es-CL")} cambio
              {data.total !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      </Surface>

      {/* Forbidden */}
      {isForbidden && (
        <Surface className="bg-warning/5 ring-warning/20">
          <p className="text-sm font-medium text-warning">
            Solo administradores pueden consultar el audit trail.
          </p>
        </Surface>
      )}

      {/* Loading */}
      {!isForbidden && isLoading && <TableSkeleton />}

      {/* Endpoint missing */}
      {!isForbidden && !isLoading && isEndpointMissing && (
        <Surface className="py-16">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
              <PlugZap className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
            </div>
            <p className="text-base font-semibold text-ink-900">
              Endpoint audit no disponible
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              El backend aún no expone <code className="font-mono text-xs">/audit/actions</code>.
            </p>
          </div>
        </Surface>
      )}

      {/* Error */}
      {!isForbidden && !isLoading && error && !isEndpointMissing && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm font-medium text-negative">
            Error al cargar el audit trail
          </p>
          <p className="mt-1 text-xs text-negative/80">
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
        </Surface>
      )}

      {/* Empty */}
      {!isForbidden && !isLoading && !error && items.length === 0 && (
        <Surface className="py-16">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60">
              <ListChecks className="h-6 w-6 text-ink-300" strokeWidth={1.5} />
            </div>
            <p className="text-base font-semibold text-ink-900">
              No hay cambios para los filtros aplicados
            </p>
            <p className="mt-1 max-w-md text-sm text-ink-500">
              Probá quitar los filtros o ampliar el rango de fechas.
            </p>
          </div>
        </Surface>
      )}

      {/* Table */}
      {!isForbidden && !isLoading && !error && items.length > 0 && (
        <Surface
          padding="none"
          className="overflow-hidden bg-white/90 ring-hairline shadow-card"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-hairline text-sm">
              <thead className="bg-ink-100/40">
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={cn(
                        "px-4 py-3 text-xs uppercase tracking-wide text-ink-500 font-medium",
                        c.align === "right" ? "text-right" : "text-left",
                      )}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {items.map((it) => (
                  <tr
                    key={it.id}
                    className="cursor-pointer transition-colors duration-150 ease-apple hover:bg-ink-100/30"
                    onClick={() => setSelectedId(it.id)}
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-700">
                      {toDateTime(it.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                      {it.user_email ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge variant={actionVariant(it.action)}>
                        {it.action}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                      <span className="font-medium">{it.entity_type}</span>
                      {it.entity_label && (
                        <span className="ml-1.5 text-ink-500">
                          · {it.entity_label}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[28rem] truncate px-4 py-3 text-ink-700">
                      <span title={it.summary}>{it.summary}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-cehta-green transition-colors hover:bg-cehta-green/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
                      >
                        <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-500 tabular-nums">
            Página {data.page} de {data.pages} ·{" "}
            {data.total.toLocaleString("es-CL")} resultados
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-50 disabled:hover:bg-white"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={data.page >= data.pages}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-50 disabled:hover:bg-white"
            >
              Siguiente
              <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}

      {/* Diff dialog */}
      <Dialog
        open={selectedId !== null}
        onOpenChange={(o) => !o && setSelectedId(null)}
      >
        <DialogContent
          hideClose
          className="max-w-5xl bg-white/90 shadow-card ring-hairline backdrop-blur-xl"
        >
          <DialogTitle className="font-display text-lg">
            Detalle del cambio
          </DialogTitle>
          {detail && (
            <>
              <DialogDescription>
                <span className="font-medium text-ink-700">
                  {detail.action}
                </span>{" "}
                · {detail.entity_type}{" "}
                {detail.entity_label && (
                  <span className="text-ink-500">· {detail.entity_label}</span>
                )}{" "}
                · {toDateTime(detail.created_at)} ·{" "}
                {detail.user_email ?? "sistema"}
              </DialogDescription>
              <p className="mt-3 text-sm text-ink-700">{detail.summary}</p>
              <div className="mt-4">
                <AuditDiffViewer
                  before={detail.diff_before}
                  after={detail.diff_after}
                />
              </div>
            </>
          )}
          {!detail && (
            <div className="mt-3 space-y-2">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
