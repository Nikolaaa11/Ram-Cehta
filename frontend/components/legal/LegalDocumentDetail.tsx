"use client";

import { useState } from "react";
import { Download, X } from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSession } from "@/hooks/use-session";
import { useMe } from "@/hooks/use-me";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EditButton } from "@/components/shared/edit-button";
import { FileLink } from "@/components/shared/FileLink";
import { EntityHistoryDrawer } from "@/components/audit/EntityHistoryDrawer";
import { AlertBadge } from "./AlertBadge";
import { LegalDocumentEditDialog } from "./LegalDocumentEditDialog";
import { LegalVersionsHistory } from "./LegalVersionsHistory";
import { toCLP, toDate } from "@/lib/format";
import type { LegalDocumentRead } from "@/lib/api/schema";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

interface Props {
  documentoId: number;
  onClose: () => void;
}

/**
 * Drawer/sheet con el detalle de un documento legal. Server-fetch via
 * useApiQuery para obtener el documento completo (incluye descripcion,
 * dropbox_path, fechas, etc.).
 */
export function LegalDocumentDetail({ documentoId, onClose }: Props) {
  const { session } = useSession();
  const { data: me } = useMe();
  const canEdit = me?.allowed_actions?.includes("legal:update") ?? false;
  const { data, isLoading, error, refetch } = useApiQuery<LegalDocumentRead>(
    ["legal-document", String(documentoId)],
    `/legal/${documentoId}`,
  );
  const [editOpen, setEditOpen] = useState(false);

  const downloadHref = `${API_BASE}/legal/${documentoId}/download`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
        aria-label="Cerrar"
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-hairline bg-white shadow-card-hover">
        <div className="flex items-center justify-between gap-2 border-b border-hairline px-6 py-4">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">
            Detalle de documento
          </h2>
          <div className="flex items-center gap-2">
            <LegalVersionsHistory documentoId={documentoId} />
            <EntityHistoryDrawer
              entityType="legal_document"
              entityId={String(documentoId)}
            />
            {canEdit && data && (
              <EditButton
                size="sm"
                onClick={() => setEditOpen(true)}
                label="Editar"
              />
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-ink-500 transition-colors hover:bg-ink-100/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div className="flex-1 px-6 py-5 space-y-4">
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
          {error && (
            <Surface className="border border-negative/20 bg-negative/5">
              <p className="text-sm text-negative">
                Error al cargar el documento.
              </p>
            </Surface>
          )}
          {data && (
            <>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-500">
                  {data.categoria}
                  {data.subcategoria && ` · ${data.subcategoria}`}
                </p>
                <h3 className="mt-1 text-lg font-semibold tracking-tight text-ink-900">
                  {data.nombre}
                </h3>
                {data.contraparte && (
                  <p className="text-sm text-ink-500">{data.contraparte}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">{data.estado}</Badge>
                <AlertBadge
                  nivel={data.alerta_nivel}
                  diasParaVencer={data.dias_para_vencer}
                />
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Item
                  label="Fecha emisión"
                  value={data.fecha_emision ? toDate(data.fecha_emision) : "—"}
                />
                <Item
                  label="Monto"
                  value={data.monto != null ? toCLP(data.monto as never) : "—"}
                />
                <Item
                  label="Vigencia desde"
                  value={
                    data.fecha_vigencia_desde
                      ? toDate(data.fecha_vigencia_desde)
                      : "—"
                  }
                />
                <Item
                  label="Vigencia hasta"
                  value={
                    data.fecha_vigencia_hasta
                      ? toDate(data.fecha_vigencia_hasta)
                      : "—"
                  }
                />
                <Item label="Moneda" value={data.moneda ?? "CLP"} />
                <Item label="Empresa" value={data.empresa_codigo} />
              </dl>

              {data.descripcion && (
                <Surface padding="compact" className="bg-ink-100/40">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                    Descripción
                  </p>
                  <p className="mt-1 text-sm text-ink-700">{data.descripcion}</p>
                </Surface>
              )}

              {data.dropbox_path ? (
                <a
                  href={downloadHref}
                  target="_blank"
                  rel="noreferrer"
                  // server endpoint redirige a temporary link de Dropbox
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 ease-apple hover:bg-cehta-green-700"
                  onClick={(e) => {
                    if (!session?.access_token) return;
                    // Forzamos la descarga con header bearer via window.fetch.
                    // El href falla si no hay sesion; mejor usamos fetch + open.
                    e.preventDefault();
                    fetch(downloadHref, {
                      headers: {
                        Authorization: `Bearer ${session.access_token}`,
                      },
                      redirect: "follow",
                    })
                      .then((r) => {
                        if (r.redirected) {
                          window.open(r.url, "_blank", "noopener");
                        } else if (r.ok) {
                          // El backend siempre redirige; fallback raro
                          window.open(r.url, "_blank", "noopener");
                        }
                      })
                      .catch(() => null);
                  }}
                >
                  <Download className="h-4 w-4" strokeWidth={1.5} />
                  Descargar archivo
                </a>
              ) : (
                <p className="rounded-xl border border-dashed border-hairline px-4 py-3 text-sm text-ink-500">
                  Sin archivo adjunto.
                </p>
              )}

              {data.dropbox_path && (
                <div className="text-xs">
                  <FileLink
                    url={data.dropbox_path}
                    variant="inline"
                    showDomain
                  />
                </div>
              )}
            </>
          )}
        </div>
      </aside>
      {data && (
        <LegalDocumentEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          doc={data}
          onSaved={() => refetch()}
        />
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm tabular-nums text-ink-900">{value}</dd>
    </div>
  );
}
