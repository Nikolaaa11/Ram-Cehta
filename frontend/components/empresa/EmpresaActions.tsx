"use client";

/**
 * EmpresaActions — botones del header de la empresa: Editar + sync Dropbox.
 *
 * - Edit: solo admin con `empresa:update`.
 * - Sync Dropbox: dropdown con submenu de recursos (Trabajadores, Legal, F29).
 *
 * V4 fase 5 fix visual: el dropdown ahora usa Radix Popover (Portal) para
 * evitar problemas de stacking context con el `backdrop-blur` del header
 * (Surface variant=glass). Antes el menú se veía "borroso/cortado" porque
 * vivía dentro del stacking context blurreado.
 */
import { useState } from "react";
import { Cloud, ChevronDown } from "lucide-react";
import { useMe } from "@/hooks/use-me";
import { useApiQuery } from "@/hooks/use-api-query";
import { EditButton } from "@/components/shared/edit-button";
import { EntityHistoryDrawer } from "@/components/audit/EntityHistoryDrawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
        <Popover open={syncMenuOpen} onOpenChange={setSyncMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
            >
              <Cloud className="h-4 w-4" strokeWidth={1.5} />
              Sincronizar Dropbox
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform duration-150 ease-apple ${syncMenuOpen ? "rotate-180" : ""}`}
                strokeWidth={2}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="min-w-[280px] p-2"
          >
            <div className="mb-1 px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
              Qué sincronizar
            </div>
            <div role="menu" className="flex flex-col gap-1">
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
          </PopoverContent>
        </Popover>
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
}: {
  label: string;
  description: string;
  children: React.ReactNode;
  /** Reservado: el cierre del menú lo dispara el click del SyncDropboxButton via Radix. */
  onClick?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl px-2.5 py-2 transition-colors duration-150 ease-apple hover:bg-ink-100/40">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900">{label}</p>
        <p className="truncate text-xs text-ink-500">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
