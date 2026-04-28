"use client";

import { use, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Users, Inbox } from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useMe } from "@/hooks/use-me";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrabajadorCreateDialog } from "@/components/empresa/TrabajadorCreateDialog";
import { TrabajadorRow } from "@/components/empresa/TrabajadorRow";

interface TrabajadorListItem {
  trabajador_id: number;
  empresa_codigo: string;
  nombre_completo: string;
  rut: string;
  cargo: string | null;
  fecha_ingreso: string;
  fecha_egreso: string | null;
  tipo_contrato: string | null;
  estado: string;
}

interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export default function TrabajadoresPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = use(params);
  const [estadoFilter, setEstadoFilter] = useState<"activo" | "inactivo">(
    "activo",
  );
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canCreate = me?.allowed_actions?.includes("trabajador:create") ?? false;

  const { data, isLoading, error } = useApiQuery<Page<TrabajadorListItem>>(
    ["trabajadores", codigo, estadoFilter],
    `/trabajadores?empresa_codigo=${encodeURIComponent(codigo)}&estado=${estadoFilter}&size=100`,
  );

  const items = data?.items ?? [];

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ["trabajadores", codigo] });
  };

  return (
    <div className="space-y-6">
      <Surface>
        <Surface.Header>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Surface.Title>Trabajadores</Surface.Title>
              <Surface.Subtitle>
                {data
                  ? `${data.total} ${data.total === 1 ? "persona" : "personas"} ${estadoFilter === "activo" ? "activas" : "inactivas"}`
                  : "Cargando..."}
              </Surface.Subtitle>
            </div>
            {canCreate && (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-apple hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
              >
                <Plus className="h-4 w-4" strokeWidth={2} />
                Nuevo trabajador
              </button>
            )}
          </div>
        </Surface.Header>

        {/* Tabs activos/inactivos */}
        <div className="-mx-6 mt-2 border-b border-hairline">
          <div className="flex gap-1 px-6">
            {(["activo", "inactivo"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setEstadoFilter(s)}
                className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 ease-apple ${
                  estadoFilter === s
                    ? "border-cehta-green text-cehta-green"
                    : "border-transparent text-ink-500 hover:text-ink-900"
                }`}
              >
                {s === "activo" ? "Activos" : "Inactivos"}
              </button>
            ))}
          </div>
        </div>
      </Surface>

      {/* Body */}
      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <Surface className="border border-negative/20 bg-negative/5 ring-1 ring-negative/20">
          <Surface.Title className="text-negative">
            Error al cargar trabajadores
          </Surface.Title>
          <Surface.Subtitle>
            {error instanceof Error ? error.message : "Error desconocido"}
          </Surface.Subtitle>
        </Surface>
      )}

      {!isLoading && !error && items.length === 0 && (
        <Surface className="text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60 text-ink-500">
            <Inbox className="h-6 w-6" strokeWidth={1.5} />
          </span>
          <p className="mt-3 text-base font-medium text-ink-900">
            {estadoFilter === "activo"
              ? "Sin trabajadores activos"
              : "Sin trabajadores inactivos"}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {estadoFilter === "activo"
              ? canCreate
                ? "Hacé click en + Nuevo trabajador para empezar."
                : "Pedile a un admin que agregue al primer trabajador."
              : "Cuando alguien deje la empresa, aparecerá acá."}
          </p>
        </Surface>
      )}

      {!isLoading && !error && items.length > 0 && (
        <Surface padding="none">
          <table className="min-w-full divide-y divide-hairline text-sm">
            <thead className="bg-ink-100/40 text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Nombre</th>
                <th className="px-4 py-3 text-left font-medium">RUT</th>
                <th className="px-4 py-3 text-left font-medium">Cargo</th>
                <th className="px-4 py-3 text-left font-medium">Ingreso</th>
                <th className="px-4 py-3 text-left font-medium">Contrato</th>
                <th className="px-4 py-3 text-left font-medium">Estado</th>
                <th className="px-4 py-3 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {items.map((t) => (
                <TrabajadorRow
                  key={t.trabajador_id}
                  trabajador={t}
                  empresaCodigo={codigo}
                  onChanged={handleRefresh}
                />
              ))}
            </tbody>
          </table>
        </Surface>
      )}

      <TrabajadorCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        empresaCodigo={codigo}
        onCreated={handleRefresh}
      />
    </div>
  );
}
