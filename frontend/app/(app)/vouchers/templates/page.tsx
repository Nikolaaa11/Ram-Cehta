"use client";

/**
 * /vouchers/templates — V5++ ola AB
 *
 * Lista de plantillas reutilizables para vouchers recurrentes.
 *
 * Acciones:
 *   - Click en una plantilla → modal "Usar plantilla" con fecha + multiplier
 *   - Editar → abre form de edición
 *   - Soft delete → marca activo=false
 *   - Sort por: recientes / más usadas / alfabético
 */
import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Copy,
  FileEdit,
  FileText,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { UseTemplateDialog } from "@/components/vouchers/UseTemplateDialog";

interface TemplateListItem {
  template_id: number;
  codigo: string;
  nombre: string;
  empresa_codigo: string;
  tipo: string;
  moneda: string;
  activo: boolean;
  use_count: number;
  last_used_at: string | null;
}

type SortMode = "recent" | "most_used" | "alpha";

export default function VoucherTemplatesPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [sort, setSort] = useState<SortMode>("recent");
  const [search, setSearch] = useState("");
  const [usingTemplate, setUsingTemplate] = useState<TemplateListItem | null>(null);

  const { data: templates = [], isLoading, error, refetch } = useQuery({
    queryKey: ["voucher-templates", { sort }],
    queryFn: () =>
      apiClient.get<TemplateListItem[]>(
        `/vouchers/templates?sort=${sort}&activo=true`,
        session,
      ),
    enabled: !!session,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient.delete<void>(`/vouchers/templates/${id}`, session),
    onSuccess: () => {
      toast.success("Plantilla desactivada");
      queryClient.invalidateQueries({ queryKey: ["voucher-templates"] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.detail : "Error";
      toast.error(`Error: ${msg}`);
    },
  });

  const filtered = templates.filter(
    (t) =>
      !search ||
      t.nombre.toLowerCase().includes(search.toLowerCase()) ||
      t.codigo.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Link
          href="/vouchers"
          className="text-ink-500 hover:text-ink-900 dark:hover:text-ink-100"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-ink-900 dark:text-ink-100">
            Plantillas de vouchers
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Reutilizá vouchers recurrentes (sueldos, arriendos, servicios) con un click.
          </p>
        </div>
      </div>

      <Surface className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-400" />
            <Input
              placeholder="Buscar por nombre o código..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1 rounded-lg border border-hairline p-1">
            <SortButton current={sort} value="recent" onClick={setSort}>
              Recientes
            </SortButton>
            <SortButton current={sort} value="most_used" onClick={setSort}>
              <TrendingUp className="size-3.5 mr-1 inline" />
              Top usadas
            </SortButton>
            <SortButton current={sort} value="alpha" onClick={setSort}>
              A-Z
            </SortButton>
          </div>
        </div>
      </Surface>

      {isLoading ? (
        <Surface className="p-8 text-center text-ink-500">
          <Loader2 className="size-5 mx-auto animate-spin mb-2" />
          Cargando plantillas...
        </Surface>
      ) : error ? (
        <ErrorState
          title="No se pudieron cargar las plantillas"
          error={error as Error}
          onRetry={() => refetch()}
        />
      ) : filtered.length === 0 ? (
        search ? (
          <EmptyState
            icon={Sparkles}
            title="Sin resultados"
            description="Probá con otro término."
          />
        ) : (
          <EmptyState
            icon={FileText}
            title="Sin templates aún"
            description="Creá un template para acelerar la creación de vouchers recurrentes."
            primaryAction={{ label: "Ir a vouchers", href: "/vouchers" }}
          />
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((tpl) => (
            <Surface
              key={tpl.template_id}
              className="p-4 hover:border-cehta-green/40 transition-colors cursor-pointer"
              onClick={() => setUsingTemplate(tpl)}
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <code className="text-xs font-mono text-ink-500">{tpl.codigo}</code>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-300">
                      {tpl.tipo}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-300">
                      {tpl.empresa_codigo}
                    </span>
                  </div>
                  <h3 className="font-medium text-ink-900 dark:text-ink-100 text-sm">
                    {tpl.nombre}
                  </h3>
                </div>
                <div className="flex items-center gap-1 text-xs text-ink-500">
                  <TrendingUp className="size-3" />
                  {tpl.use_count}
                </div>
              </div>
              {tpl.last_used_at && (
                <p className="text-xs text-ink-500">
                  Última vez: {new Date(tpl.last_used_at).toLocaleDateString("es-CL")}
                </p>
              )}
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="default"
                  onClick={(e) => {
                    e.stopPropagation();
                    setUsingTemplate(tpl);
                  }}
                >
                  <Copy className="size-3.5 mr-1" />
                  Usar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      confirm(
                        `¿Desactivar plantilla "${tpl.nombre}"? Podés reactivarla después.`,
                      )
                    ) {
                      deleteMutation.mutate(tpl.template_id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </Surface>
          ))}
        </div>
      )}

      {usingTemplate && (
        <UseTemplateDialog
          template={usingTemplate}
          onClose={() => setUsingTemplate(null)}
          onSuccess={(voucherId) => {
            setUsingTemplate(null);
            queryClient.invalidateQueries({ queryKey: ["voucher-templates"] });
            window.location.href = `/vouchers/${voucherId}`;
          }}
        />
      )}
    </div>
  );
}

function SortButton({
  current,
  value,
  onClick,
  children,
}: {
  current: SortMode;
  value: SortMode;
  onClick: (s: SortMode) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={`text-xs px-3 py-1.5 rounded transition-colors ${
        active
          ? "bg-cehta-green text-white"
          : "text-ink-500 hover:text-ink-900 dark:hover:text-ink-100"
      }`}
    >
      {children}
    </button>
  );
}
