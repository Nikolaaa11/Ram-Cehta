"use client";

import { use, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Inbox, Search } from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useMe } from "@/hooks/use-me";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { LegalDocumentTable } from "@/components/legal/LegalDocumentTable";
import { LegalDocumentCreateDialog } from "@/components/legal/LegalDocumentCreateDialog";
import { LegalDocumentDetail } from "@/components/legal/LegalDocumentDetail";
import type { LegalDocumentListItem, Page } from "@/lib/api/schema";

const CATEGORIA_ITEMS: ComboboxItem[] = [
  { value: "", label: "Todas las categorías" },
  { value: "contrato", label: "Contrato" },
  { value: "acta", label: "Acta" },
  { value: "declaracion_sii", label: "Declaración SII" },
  { value: "permiso", label: "Permiso" },
  { value: "poliza", label: "Póliza" },
  { value: "estatuto", label: "Estatuto" },
  { value: "otro", label: "Otro" },
];

const ESTADO_ITEMS: ComboboxItem[] = [
  { value: "", label: "Todos los estados" },
  { value: "vigente", label: "Vigente" },
  { value: "borrador", label: "Borrador" },
  { value: "renovado", label: "Renovado" },
  { value: "vencido", label: "Vencido" },
  { value: "cancelado", label: "Cancelado" },
];

export default function EmpresaLegalPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = use(params);
  const qc = useQueryClient();
  const { data: me } = useMe();
  const canCreate = me?.allowed_actions?.includes("legal:create") ?? false;

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [categoria, setCategoria] = useState<string>("");
  const [estado, setEstado] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const params_qs = new URLSearchParams({
    empresa_codigo: codigo,
    size: "100",
  });
  if (categoria) params_qs.set("categoria", categoria);
  if (estado) params_qs.set("estado", estado);
  if (search.trim()) params_qs.set("search", search.trim());

  const { data, isLoading, error } = useApiQuery<Page<LegalDocumentListItem>>(
    ["legal", codigo, categoria, estado, search],
    `/legal?${params_qs.toString()}`,
  );

  const items = data?.items ?? [];

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ["legal", codigo] });
  };

  return (
    <div className="space-y-6">
      <Surface>
        <Surface.Header>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Surface.Title>Bóveda Legal</Surface.Title>
              <Surface.Subtitle>
                {data
                  ? `${data.total} ${data.total === 1 ? "documento" : "documentos"} en ${codigo}`
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
                Subir documento
              </button>
            )}
          </div>
        </Surface.Header>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Combobox
            items={CATEGORIA_ITEMS}
            value={categoria}
            onValueChange={setCategoria}
            placeholder="Categoría"
            triggerClassName="min-w-[200px]"
          />
          <Combobox
            items={ESTADO_ITEMS}
            value={estado}
            onValueChange={setEstado}
            placeholder="Estado"
            triggerClassName="min-w-[180px]"
          />
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-500"
              strokeWidth={1.5}
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre…"
              className="h-9 w-full rounded-xl border-0 bg-white pl-9 pr-3 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
        </div>
      </Surface>

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
            Error al cargar documentos legales
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
            Sin documentos legales {categoria || estado || search ? "que coincidan con los filtros" : ""}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {canCreate
              ? "Subí el primer documento con el botón + Subir documento."
              : "Pedile a un admin que cargue contratos, actas o pólizas."}
          </p>
        </Surface>
      )}

      {!isLoading && !error && items.length > 0 && (
        <LegalDocumentTable items={items} onRowClick={(id) => setDetailId(id)} />
      )}

      <LegalDocumentCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        empresaCodigo={codigo}
        onCreated={handleRefresh}
      />

      {detailId !== null && (
        <LegalDocumentDetail
          documentoId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
