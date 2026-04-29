"use client";

/**
 * EmpresaActions — botones del header de la empresa: Editar + sync Dropbox.
 *
 * - Edit: solo admin con `empresa:update`.
 * - Sync Dropbox: dropdown con submenu de recursos (Trabajadores, Legal, F29).
 */
import { useState } from "react";
import { Cloud } from "lucide-react";
import { useMe } from "@/hooks/use-me";
import { useApiQuery } from "@/hooks/use-api-query";
import { EditButton } from "@/components/shared/edit-button";
import { EntityHistoryDrawer } from "@/components/audit/EntityHistoryDrawer";
import { EmpresaEditDialog } from "./EmpresaEditDialog";
import { SyncDropboxButton } from "./SyncDropboxButton";

interface EmpresaFullRead {
  codigo: string;
  razon_social: string;
  rut?: string | null;
  giro?: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  telefono?: string | null;
  representante_legal?: string | null;
  email_firmante?: string | null;
  oc_prefix?: string | null;
  activo: boolean;
}

interface Props {
  codigo: string;
}

export function EmpresaActions({ codigo }: Props) {
  const { data: me } = useMe();
  const canEdit = me?.allowed_actions?.includes("empresa:update") ?? false;
  const canSyncTrabajador =
    me?.allowed_actions?.includes("trabajador:update") ?? false;
  const canSyncLegal = me?.allowed_actions?.includes("legal:create") ?? false;
  const canSyncF29 = me?.allowed_actions?.includes("f29:create") ?? false;

  const [editOpen, setEditOpen] = useState(false);
  const [syncMenuOpen, setSyncMenuOpen] = useState(false);

  // Cargar datos full sólo cuando vamos a editar (lazy).
  const { data: empresa, refetch } = useApiQuery<EmpresaFullRead>(
    ["empresa-full", codigo],
    `/catalogos/empresas/${encodeURIComponent(codigo)}`,
    editOpen,
  );

  const showSyncRoot = canSyncTrabajador || canSyncLegal || canSyncF29;
  const showAudit = me?.allowed_actions?.includes("audit:read") ?? false;
  if (!canEdit && !showSyncRoot && !showAudit) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showAudit && (
        <EntityHistoryDrawer entityType="empresa" entityId={codigo} />
      )}
      {canEdit && (
        <EditButton onClick={() => setEditOpen(true)} label="Editar empresa" />
      )}

      {showSyncRoot && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setSyncMenuOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
            aria-haspopup="menu"
            aria-expanded={syncMenuOpen}
          >
            <Cloud className="h-4 w-4" strokeWidth={1.5} />
            Sincronizar Dropbox
          </button>
          {syncMenuOpen && (
            <>
              <button
                type="button"
                aria-label="Cerrar menú"
                onClick={() => setSyncMenuOpen(false)}
                className="fixed inset-0 z-30 cursor-default"
              />
              <div
                role="menu"
                className="absolute right-0 z-40 mt-2 flex min-w-[220px] flex-col gap-1 rounded-2xl border border-hairline bg-white p-2 shadow-card"
              >
                {canSyncTrabajador && (
                  <SyncMenuItem
                    label="Trabajadores"
                    description="Activos/{rut – nombre}"
                    onClick={() => setSyncMenuOpen(false)}
                  >
                    <SyncDropboxButton
                      empresaCodigo={codigo}
                      resource="trabajadores"
                      variant="compact"
                    />
                  </SyncMenuItem>
                )}
                {canSyncLegal && (
                  <SyncMenuItem
                    label="Legal"
                    description="03-Legal/* (recursivo)"
                    onClick={() => setSyncMenuOpen(false)}
                  >
                    <SyncDropboxButton
                      empresaCodigo={codigo}
                      resource="legal"
                      variant="compact"
                    />
                  </SyncMenuItem>
                )}
                {canSyncF29 && (
                  <SyncMenuItem
                    label="F29"
                    description="Declaraciones SII / F29"
                    onClick={() => setSyncMenuOpen(false)}
                  >
                    <SyncDropboxButton
                      empresaCodigo={codigo}
                      resource="f29"
                      variant="compact"
                    />
                  </SyncMenuItem>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {empresa && (
        <EmpresaEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          empresa={empresa}
          onSaved={() => refetch()}
        />
      )}
    </div>
  );
}

function SyncMenuItem({
  label,
  description,
  children,
  onClick,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 hover:bg-ink-100/40"
      onClick={onClick}
    >
      <div>
        <p className="text-sm font-medium text-ink-900">{label}</p>
        <p className="text-xs text-ink-500">{description}</p>
      </div>
      {children}
    </div>
  );
}
