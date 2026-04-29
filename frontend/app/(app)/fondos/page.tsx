"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Inbox, Download } from "lucide-react";
import { toast } from "sonner";
import { useApiQuery } from "@/hooks/use-api-query";
import { useMe } from "@/hooks/use-me";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { FondoTable } from "@/components/fondos/FondoTable";
import { FondoDetail } from "@/components/fondos/FondoDetail";
import { FondoCreateDialog } from "@/components/fondos/FondoCreateDialog";
import { ExportExcelButton } from "@/components/shared/ExportExcelButton";
import type { FondoListItem, FondoStats, Page } from "@/lib/api/schema";

const TIPO_ITEMS: ComboboxItem[] = [
  { value: "", label: "Todos los tipos" },
  { value: "lp", label: "LP" },
  { value: "banco", label: "Banco" },
  { value: "programa_estado", label: "Programa Estado" },
  { value: "family_office", label: "Family Office" },
  { value: "vc", label: "VC" },
  { value: "angel", label: "Angel" },
  { value: "otro", label: "Otro" },
];

const ESTADO_ITEMS: ComboboxItem[] = [
  { value: "", label: "Todos los estados" },
  { value: "no_contactado", label: "No contactado" },
  { value: "contactado", label: "Contactado" },
  { value: "en_negociacion", label: "En negociación" },
  { value: "cerrado", label: "Cerrado" },
  { value: "descartado", label: "Descartado" },
];

export default function FondosPage() {
  const qc = useQueryClient();
  const { session } = useSession();
  const { data: me } = useMe();
  const canCreate = me?.allowed_actions?.includes("fondo:create") ?? false;
  const isAdmin = me?.app_role === "admin";

  const [tipo, setTipo] = useState<string>("");
  const [estado, setEstado] = useState<string>("");
  const [sector, setSector] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const params = new URLSearchParams({ size: "100" });
  if (tipo) params.set("tipo", tipo);
  if (estado) params.set("estado", estado);
  if (sector.trim()) params.set("sector", sector.trim());
  if (search.trim()) params.set("search", search.trim());

  const listQ = useApiQuery<Page<FondoListItem>>(
    ["fondos", tipo, estado, sector, search],
    `/fondos?${params.toString()}`,
  );

  const statsQ = useApiQuery<FondoStats>(["fondos", "stats"], "/fondos/stats");

  const importMutation = useMutation({
    mutationFn: () => apiClient.post("/fondos/import-from-dropbox", {}, session),
    onSuccess: (res: unknown) => {
      const r = res as { found: boolean; message: string };
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["fondos"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error al importar");
    },
  });

  const items = listQ.data?.items ?? [];
  const stats = statsQ.data;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["fondos"] });
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-6 lg:px-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
            Búsqueda de Fondos
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Pipeline de capital — LPs, bancos, programas estatales y family
            offices.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportExcelButton entity="fondos" />
          {isAdmin && (
            <button
              type="button"
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 ease-apple hover:bg-ink-100/40 disabled:opacity-60"
            >
              <Download className="h-4 w-4" strokeWidth={1.5} />
              {importMutation.isPending ? "Importando…" : "Importar Dropbox"}
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-apple hover:bg-cehta-green-700"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              Nuevo fondo
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total fondos" value={stats?.total ?? 0} />
        <KpiCard
          label="Contactados"
          value={(stats?.por_estado["contactado"] ?? 0) +
            (stats?.por_estado["en_negociacion"] ?? 0) +
            (stats?.por_estado["cerrado"] ?? 0)}
        />
        <KpiCard
          label="En negociación"
          value={stats?.por_estado["en_negociacion"] ?? 0}
        />
        <KpiCard label="Cerrados" value={stats?.por_estado["cerrado"] ?? 0} />
      </div>

      <Surface>
        <div className="flex flex-wrap items-center gap-3">
          <Combobox
            items={TIPO_ITEMS}
            value={tipo}
            onValueChange={setTipo}
            placeholder="Tipo"
            triggerClassName="min-w-[180px]"
          />
          <Combobox
            items={ESTADO_ITEMS}
            value={estado}
            onValueChange={setEstado}
            placeholder="Estado outreach"
            triggerClassName="min-w-[200px]"
          />
          <input
            type="text"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            placeholder="Filtrar por sector…"
            className="h-9 min-w-[180px] rounded-xl border-0 bg-white px-3 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green"
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
              placeholder="Buscar por nombre o thesis…"
              className="h-9 w-full rounded-xl border-0 bg-white pl-9 pr-3 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
        </div>
      </Surface>

      {listQ.isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!listQ.isLoading && items.length === 0 && (
        <Surface className="text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60 text-ink-500">
            <Inbox className="h-6 w-6" strokeWidth={1.5} />
          </span>
          <p className="mt-3 text-base font-medium text-ink-900">
            Sin fondos {(tipo || estado || sector || search) ? "con esos filtros" : ""}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {canCreate
              ? "Agregá el primer fondo con + Nuevo fondo o importá desde Dropbox."
              : "Pedile a un admin que cargue el pipeline de fondos."}
          </p>
        </Surface>
      )}

      {!listQ.isLoading && items.length > 0 && (
        <FondoTable items={items} onRowClick={(id) => setDetailId(id)} />
      )}

      <FondoCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={refresh}
      />

      {detailId !== null && (
        <FondoDetail
          fondoId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <Surface>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-ink-900">
        {value}
      </p>
    </Surface>
  );
}
