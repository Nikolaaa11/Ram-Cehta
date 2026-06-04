"use client";

/**
 * /f22 — Declaración Anual de Impuesto a la Renta (SII Chile)
 *
 * Análogo a /f29 pero con cadencia anual. Una declaración por empresa
 * por año tributario. Vencimiento típico: abril 30 del año siguiente.
 *
 * Diseño Apple-tier:
 *   - Tabla con filtros (empresa, año, estado)
 *   - Botones: Crear, Sync Dropbox por empresa
 *   - Click en row → drawer con edit + marcar pagado + comprobante
 *   - Bullet alerta para los pendientes que vencen en <60 días
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  Calendar,
  CircleDollarSign,
  Download,
  Plus,
  RefreshCw,
  CheckCircle2,
  Loader2,
  Building2,
  AlertTriangle,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { exportCsv, csvFilename } from "@/lib/csv-export";
import { ResetDataButton } from "@/components/shared/ResetDataButton";

interface F22Item {
  f22_id: number;
  empresa_codigo: string;
  ano_tributario: number;
  fecha_vencimiento: string;
  monto_a_pagar: string | number | null;
  fecha_pago: string | null;
  estado: string;
  comprobante_url: string | null;
  dropbox_path: string | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

interface PageF22 {
  items: F22Item[];
  total: number;
  page: number;
  size: number;
}

interface Empresa {
  codigo: string;
  razon_social: string;
}

const ESTADO_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  pagado: "Pagado",
  vencido: "Vencido",
  prorrogado: "Prorrogado",
  exento: "Exento",
};

function estadoTone(s: string): string {
  switch (s) {
    case "pagado":
      return "bg-cehta-green/10 text-cehta-green";
    case "vencido":
      return "bg-red-50 text-red-600";
    case "prorrogado":
      return "bg-amber-50 text-amber-700";
    case "exento":
      return "bg-ink-100 text-ink-500";
    default:
      return "bg-blue-50 text-blue-700";
  }
}

function fmtCLP(v: number | string | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (Number.isNaN(n)) return "—";
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function daysUntil(iso: string): number {
  const a = new Date(iso).getTime();
  const b = Date.now();
  return Math.floor((a - b) / (1000 * 60 * 60 * 24));
}

const DEFAULT_DRAFT = () => ({
  empresa_codigo: "",
  ano_tributario: String(new Date().getFullYear() - 1),
  fecha_vencimiento: `${new Date().getFullYear()}-04-30`,
  monto_a_pagar: "",
});

interface Props {
  initialEmpresas?: Empresa[];
  initialF22Page?: PageF22;
}

export function F22ClientView({ initialEmpresas, initialF22Page }: Props) {
  const { session } = useSession();
  const qc = useQueryClient();

  const [empresaFilter, setEmpresaFilter] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_DRAFT());
  // Track del id que está siendo marcado pagado para disabled granular
  const [markingPaidId, setMarkingPaidId] = useState<number | null>(null);

  const { data: empresas } = useQuery<Empresa[]>({
    queryKey: ["empresas"],
    queryFn: () => apiClient.get<Empresa[]>("/empresa", session),
    enabled: !!session,
    initialData: initialEmpresas,
    staleTime: 5 * 60 * 1000,
  });

  const PAGE_SIZE = 50;
  const { data, isLoading, refetch } = useQuery<PageF22>({
    // V5++ perf: solo uso initialData en el primer render (filtros vacíos
    // + page=1). Si el user cambia filtros, el queryKey cambia y refetcha.
    initialData:
      empresaFilter === "" && estadoFilter === "" && page === 1
        ? initialF22Page
        : undefined,
    queryKey: ["f22", empresaFilter, estadoFilter, page],
    queryFn: () => {
      const qs = new URLSearchParams({
        size: String(PAGE_SIZE),
        page: String(page),
      });
      if (empresaFilter) qs.set("empresa_codigo", empresaFilter);
      if (estadoFilter) qs.set("estado", estadoFilter);
      return apiClient.get<PageF22>(`/f22?${qs}`, session);
    },
    enabled: !!session,
    staleTime: 30_000,
  });
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  const createMut = useMutation({
    mutationFn: (body: {
      empresa_codigo: string;
      ano_tributario: number;
      fecha_vencimiento: string;
      monto_a_pagar?: number;
    }) => apiClient.post<F22Item>("/f22", body, session),
    onSuccess: () => {
      toast.success("F22 creado");
      setShowCreate(false);
      setDraft(DEFAULT_DRAFT()); // reset para próxima creación
      qc.invalidateQueries({ queryKey: ["f22"] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`No se pudo crear: ${detail}`);
    },
  });

  const syncMut = useMutation({
    mutationFn: (codigo: string) =>
      apiClient.post(`/f22/sync-dropbox/${codigo}`, {}, session),
    onSuccess: (data: unknown) => {
      const d = data as { created?: number };
      toast.success(`Sync OK · ${d.created ?? 0} nuevos`);
      qc.invalidateQueries({ queryKey: ["f22"] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`Sync falló: ${detail}`);
    },
  });

  const markPaidMut = useMutation({
    mutationFn: (id: number) =>
      apiClient.post(
        `/f22/${id}/marcar-pagado`,
        {
          estado: "pagado",
          fecha_pago: new Date().toISOString().slice(0, 10),
        },
        session,
      ),
    // Optimistic update — UI muestra "pagado" instante; rollback si falla.
    onMutate: async (id: number) => {
      setMarkingPaidId(id);
      await qc.cancelQueries({ queryKey: ["f22"] });
      const prev = qc.getQueriesData<PageF22>({ queryKey: ["f22"] });
      const today = new Date().toISOString().slice(0, 10);
      qc.setQueriesData<PageF22>({ queryKey: ["f22"] }, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((it) =>
                it.f22_id === id
                  ? { ...it, estado: "pagado", fecha_pago: today }
                  : it,
              ),
            }
          : old,
      );
      return { prev };
    },
    onSettled: () => setMarkingPaidId(null),
    onSuccess: () => {
      toast.success("Marcado como pagado");
      qc.invalidateQueries({ queryKey: ["f22"] });
    },
    onError: (e: unknown, _id, ctx) => {
      // Rollback
      if (ctx?.prev) {
        ctx.prev.forEach(([key, data]) => qc.setQueryData(key, data));
      }
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`No se pudo marcar pagado: ${detail}`);
    },
  });

  const upcoming = useMemo(() => {
    return (data?.items ?? []).filter(
      (it) => it.estado === "pendiente" && daysUntil(it.fecha_vencimiento) <= 60,
    );
  }, [data]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href={"/" as Route}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            Inicio
          </Link>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
            F22 · Declaración Anual de Renta
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Una declaración por empresa por año tributario. Vencimiento abril 30
            del año siguiente. Sync automático desde
            Dropbox/03-Legal/Declaraciones SII/F22/.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {empresaFilter && (
            <>
              <ResetDataButton
                endpoint={`/admin/reset/f22/${empresaFilter}`}
                method="POST"
                body={{ confirm: true }}
                label={`Borrar F22 · ${empresaFilter}`}
                title={`Borrar todos los F22 de ${empresaFilter}`}
                description={
                  <>
                    <p>
                      Borra <strong>TODOS</strong> los F22 (declaraciones
                      anuales de renta) registrados para{" "}
                      <strong>{empresaFilter}</strong>.
                    </p>
                    <p className="mt-1 text-xs text-ink-500">
                      Después puedes re-sincronizar desde Dropbox con
                      &quot;Sync Dropbox · {empresaFilter}&quot; para traer la versión actualizada.
                    </p>
                  </>
                }
                confirmWord={`BORRAR ${empresaFilter}`}
                onSuccess={() => qc.invalidateQueries({ queryKey: ["f22"] })}
              />
              <button
                type="button"
                onClick={() => syncMut.mutate(empresaFilter)}
                disabled={syncMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green disabled:opacity-50"
              >
                {syncMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                Sync Dropbox · {empresaFilter}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              const items = data?.items ?? [];
              if (!items.length) {
                toast.error("Sin F22 para exportar");
                return;
              }
              exportCsv({
                filename: csvFilename(`f22_${empresaFilter || "all"}`),
                headers: [
                  "Empresa",
                  "Año",
                  "Vencimiento",
                  "Monto",
                  "Estado",
                  "Fecha pago",
                  "Comprobante",
                ],
                rows: items.map((it) => [
                  it.empresa_codigo,
                  it.ano_tributario,
                  it.fecha_vencimiento,
                  it.monto_a_pagar ?? "",
                  it.estado,
                  it.fecha_pago ?? "",
                  it.comprobante_url ?? "",
                ]),
              });
              toast.success(`${items.length} F22 exportados`);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
            CSV
          </button>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Nuevo F22
          </button>
        </div>
      </div>

      {/* Alerta vencimientos próximos */}
      {upcoming.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
            strokeWidth={1.75}
          />
          <div className="text-xs text-amber-800">
            <p className="font-semibold">
              {upcoming.length} F22 vencen en menos de 60 días
            </p>
            <p className="mt-1">
              {upcoming
                .map(
                  (u) =>
                    `${u.empresa_codigo} ${u.ano_tributario} · ${
                      daysUntil(u.fecha_vencimiento) >= 0
                        ? `${daysUntil(u.fecha_vencimiento)}d`
                        : "VENCIDO"
                    }`,
                )
                .join(" · ")}
            </p>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-hairline bg-ink-50/30 px-4 py-3">
        <Building2 className="h-3.5 w-3.5 text-ink-400" strokeWidth={1.75} />
        <select
          value={empresaFilter}
          onChange={(e) => {
            setEmpresaFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filtrar por empresa"
          className="rounded-lg border-0 bg-white px-3 py-1.5 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          <option value="">Todas las empresas</option>
          {(empresas ?? []).map((e) => (
            <option key={e.codigo} value={e.codigo}>
              {e.codigo}
            </option>
          ))}
        </select>
        <select
          value={estadoFilter}
          onChange={(e) => {
            setEstadoFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filtrar por estado"
          className="rounded-lg border-0 bg-white px-3 py-1.5 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {/* Form crear */}
      {showCreate && (
        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Nuevo F22
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Empresa
              </label>
              <select
                value={draft.empresa_codigo}
                onChange={(e) =>
                  setDraft({ ...draft, empresa_codigo: e.target.value })
                }
                className="mt-1 w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
              >
                <option value="">— Empresa —</option>
                {(empresas ?? []).map((e) => (
                  <option key={e.codigo} value={e.codigo}>
                    {e.codigo}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Año tributario
              </label>
              <input
                type="number"
                min={2000}
                max={2100}
                value={draft.ano_tributario}
                onChange={(e) =>
                  setDraft({ ...draft, ano_tributario: e.target.value })
                }
                className="mt-1 w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Fecha vencimiento
              </label>
              <input
                type="date"
                value={draft.fecha_vencimiento}
                onChange={(e) =>
                  setDraft({ ...draft, fecha_vencimiento: e.target.value })
                }
                className="mt-1 w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Monto a pagar (CLP, opcional)
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={draft.monto_a_pagar}
                onChange={(e) =>
                  setDraft({ ...draft, monto_a_pagar: e.target.value })
                }
                className="mt-1 w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!draft.empresa_codigo) {
                  toast.error("Elige empresa");
                  return;
                }
                createMut.mutate({
                  empresa_codigo: draft.empresa_codigo,
                  ano_tributario: Number(draft.ano_tributario),
                  fecha_vencimiento: draft.fecha_vencimiento,
                  monto_a_pagar: draft.monto_a_pagar
                    ? Number(draft.monto_a_pagar)
                    : undefined,
                });
              }}
              disabled={createMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {createMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              Crear
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="text-xs text-ink-500 hover:text-ink-700"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
       <div className="overflow-x-auto">
        {isLoading ? (
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-ink-50/60 text-left text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              <tr>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">Año</th>
                <th className="px-3 py-2">Vencimiento</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Pago</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline" data-virtualized>
              {Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>
                  <td className="px-3 py-2"><Skeleton className="h-3 w-12" /></td>
                  <td className="px-3 py-2"><Skeleton className="h-3 w-24" /></td>
                  <td className="px-3 py-2"><Skeleton className="ml-auto h-3 w-20" /></td>
                  <td className="px-3 py-2"><Skeleton className="h-4 w-20 rounded-full" /></td>
                  <td className="px-3 py-2"><Skeleton className="h-3 w-20" /></td>
                  <td className="px-3 py-2 text-right"><Skeleton className="ml-auto h-5 w-24" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : !data?.items?.length ? (
          <div className="flex flex-col items-center gap-3 p-12 text-center">
            <Calendar className="h-10 w-10 text-ink-300" strokeWidth={1.25} />
            <p className="text-sm text-ink-500">
              Sin F22 registrados. Haz clic en &ldquo;Sync Dropbox&rdquo; para
              importar de la cuenta Cehta o &ldquo;Nuevo F22&rdquo; para crear
              manualmente.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-ink-50/60 text-left text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              <tr>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">Año</th>
                <th className="px-3 py-2">Vencimiento</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Pago</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline" data-virtualized>
              {data.items.map((it) => {
                const days = daysUntil(it.fecha_vencimiento);
                const overdue = it.estado === "pendiente" && days < 0;
                return (
                  <tr key={it.f22_id} className="hover:bg-ink-50/30">
                    <td className="px-3 py-2 font-mono text-xs">
                      {it.empresa_codigo}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">
                      {it.ano_tributario}
                    </td>
                    <td className="px-3 py-2">
                      <p className="tabular-nums">{it.fecha_vencimiento}</p>
                      {it.estado === "pendiente" && (
                        <p
                          className={`text-[10px] ${
                            overdue
                              ? "text-red-600"
                              : days <= 30
                                ? "text-amber-600"
                                : "text-ink-400"
                          }`}
                        >
                          {overdue
                            ? `${Math.abs(days)}d vencido`
                            : `en ${days}d`}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {fmtCLP(it.monto_a_pagar)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${estadoTone(
                          it.estado,
                        )}`}
                      >
                        {ESTADO_LABELS[it.estado] ?? it.estado}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-500 tabular-nums">
                      {it.fecha_pago ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {it.estado !== "pagado" && (
                        <button
                          type="button"
                          onClick={() => markPaidMut.mutate(it.f22_id)}
                          disabled={markingPaidId === it.f22_id}
                          className="inline-flex items-center gap-1 rounded-lg bg-cehta-green/10 px-2 py-1 text-[10px] font-medium text-cehta-green hover:bg-cehta-green hover:text-white disabled:opacity-50"
                        >
                          {markingPaidId === it.f22_id ? (
                            <Loader2
                              className="h-3 w-3 animate-spin"
                            />
                          ) : (
                            <CheckCircle2
                              className="h-3 w-3"
                              strokeWidth={1.75}
                            />
                          )}
                          Marcar pagado
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
       </div>
      </div>
      {/* Paginación */}
      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs">
          <p className="text-ink-500">
            Página {page} de {totalPages} · {data.total} F22 totales
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-hairline bg-white px-3 py-1 hover:bg-ink-50 disabled:opacity-50"
            >
              ← Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-hairline bg-white px-3 py-1 hover:bg-ink-50 disabled:opacity-50"
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}
      <p className="text-[11px] italic text-ink-500">
        Mostrando {data?.items?.length ?? 0} de {data?.total ?? 0} F22 · sync
        Dropbox lee /03-Legal/Declaraciones SII/F22/{`{YYYY}.pdf`}
      </p>
    </div>
  );
}
