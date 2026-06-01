"use client";

/**
 * /admin/ai-index — Indexación masiva del Asistente IA (R152mmm).
 *
 * Cada empresa del fondo tiene su propio índice vectorial en
 * core.ai_documents. El asistente IA usa ese índice para responder
 * preguntas con contexto financiero/legal/operativo.
 *
 * Si una empresa NO está indexada, el chat falla con "Failed to fetch"
 * porque vector_search no encuentra rows.
 *
 * Esta página muestra el status de TODAS las empresas + un botón para
 * indexarlas en bulk (secuencial para no saturar el backend).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Database,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  RefreshCcw,
  Building2,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { toast } from "sonner";

interface IndexStatus {
  empresa_codigo: string;
  chunk_count: number;
  last_indexed_at: string | null;
  sources: string[];
}

function fmtDate(iso: string | null): string {
  if (!iso) return "Nunca";
  try {
    return new Date(iso).toLocaleString("es-CL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface RowState {
  status: "idle" | "loading" | "ok" | "error";
  message?: string;
  result?: { files_processed: number; chunks_created: number };
}

export default function AdminAiIndexPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { data: empresas = [], isLoading: empresasLoading } =
    useCatalogoEmpresas();

  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [bulkRunning, setBulkRunning] = useState(false);

  // Status por empresa (fetch en paralelo, una query por empresa)
  const statusQuery = useQuery<IndexStatus[]>({
    queryKey: ["admin", "ai-index-bulk", empresas.map((e) => e.codigo)],
    queryFn: async () => {
      const results = await Promise.all(
        empresas.map((e) =>
          apiClient
            .get<IndexStatus>(
              `/ai/index/${encodeURIComponent(e.codigo)}/status`,
              session,
            )
            .catch(
              () =>
                ({
                  empresa_codigo: e.codigo,
                  chunk_count: 0,
                  last_indexed_at: null,
                  sources: [],
                }) as IndexStatus,
            ),
        ),
      );
      return results;
    },
    enabled: !!session && empresas.length > 0,
    staleTime: 30 * 1000,
  });

  const reindexOne = async (empresa_codigo: string) => {
    setRowStates((prev) => ({
      ...prev,
      [empresa_codigo]: { status: "loading" },
    }));
    try {
      const result = await apiClient.post<{
        files_processed: number;
        chunks_created: number;
      }>(`/ai/index/${encodeURIComponent(empresa_codigo)}`, {}, session);
      setRowStates((prev) => ({
        ...prev,
        [empresa_codigo]: { status: "ok", result },
      }));
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      setRowStates((prev) => ({
        ...prev,
        [empresa_codigo]: { status: "error", message: msg },
      }));
      throw e;
    }
  };

  const reindexOneMut = useMutation({
    mutationFn: reindexOne,
    onSuccess: (_, empresa) => {
      toast.success(`${empresa} indexada correctamente`);
      queryClient.invalidateQueries({
        queryKey: ["admin", "ai-index-bulk"],
      });
      queryClient.invalidateQueries({
        queryKey: ["ai", "index", empresa],
      });
    },
    onError: (e: Error, empresa) => {
      toast.error(`Error indexando ${empresa}: ${e.message}`);
    },
  });

  const reindexAll = async () => {
    if (empresas.length === 0) return;
    if (
      !confirm(
        `Vas a re-indexar ${empresas.length} empresas. Esto puede tardar varios minutos. ¿Continuar?`,
      )
    )
      return;

    setBulkRunning(true);
    let okCount = 0;
    let errCount = 0;

    // Secuencial para no saturar el backend (el embed_text + Dropbox son lentos).
    for (const e of empresas) {
      try {
        await reindexOne(e.codigo);
        okCount += 1;
      } catch {
        errCount += 1;
      }
    }

    setBulkRunning(false);
    queryClient.invalidateQueries({
      queryKey: ["admin", "ai-index-bulk"],
    });
    queryClient.invalidateQueries({ queryKey: ["ai", "index"] });

    if (errCount === 0) {
      toast.success(`Indexación masiva completa: ${okCount} empresas OK`);
    } else {
      toast.error(
        `Indexación con errores: ${okCount} OK, ${errCount} fallaron. Revisa la tabla.`,
      );
    }
  };

  const allStatuses = statusQuery.data ?? [];
  const indexedCount = allStatuses.filter((s) => s.chunk_count > 0).length;
  const totalChunks = allStatuses.reduce((s, r) => s + r.chunk_count, 0);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green">
          <Sparkles className="size-6" strokeWidth={1.6} />
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            Indexación del Asistente IA
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Estado del índice vectorial por empresa. Sin índice, el asistente
            no puede responder.
          </p>
        </div>
      </div>

      {/* Stats globales */}
      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Empresas
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink-900">
            {empresas.length}
          </p>
        </div>
        <div
          className={`rounded-2xl border p-5 shadow-card ${
            indexedCount === empresas.length
              ? "border-emerald-200 bg-emerald-50/40"
              : "border-amber-200 bg-amber-50/40"
          }`}
        >
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            {indexedCount === empresas.length ? (
              <CheckCircle2 className="size-3.5 text-emerald-700" />
            ) : (
              <AlertTriangle className="size-3.5 text-amber-700" />
            )}
            <span
              className={
                indexedCount === empresas.length
                  ? "text-emerald-800"
                  : "text-amber-800"
              }
            >
              Indexadas
            </span>
          </p>
          <p
            className={`mt-2 font-display text-3xl font-semibold ${
              indexedCount === empresas.length
                ? "text-emerald-900"
                : "text-amber-900"
            }`}
          >
            {indexedCount} / {empresas.length}
          </p>
        </div>
        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Total chunks
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink-900">
            {totalChunks.toLocaleString("es-CL")}
          </p>
        </div>
      </div>

      {/* CTA bulk */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cehta-green/30 bg-cehta-green/5 p-5">
        <div>
          <p className="text-base font-semibold text-ink-900">
            Re-indexar todas las empresas
          </p>
          <p className="mt-1 text-sm text-ink-600">
            Corre secuencialmente para no saturar el backend. Puede tardar
            varios minutos según cantidad de documentos.
          </p>
        </div>
        <button
          type="button"
          onClick={reindexAll}
          disabled={bulkRunning || empresasLoading || empresas.length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-5 py-3 text-sm font-semibold text-white shadow-card transition-colors hover:bg-cehta-green-700 disabled:opacity-60"
        >
          <RefreshCcw
            className={`size-4 ${bulkRunning ? "animate-spin" : ""}`}
            strokeWidth={1.8}
          />
          {bulkRunning ? "Indexando…" : "Indexar todas"}
        </button>
      </div>

      {/* Tabla por empresa */}
      <section className="mt-8 overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
        <header className="border-b border-hairline px-6 py-4">
          <h2 className="text-base font-semibold tracking-tight text-ink-900">
            Status por empresa
          </h2>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/50">
              <tr className="text-[10px] uppercase tracking-wider text-ink-500">
                <th className="px-4 py-3 text-left font-semibold">Empresa</th>
                <th className="px-4 py-3 text-right font-semibold">Chunks</th>
                <th className="px-4 py-3 text-right font-semibold">Archivos</th>
                <th className="px-4 py-3 text-left font-semibold">
                  Último update
                </th>
                <th className="px-4 py-3 text-center font-semibold">Estado</th>
                <th className="px-4 py-3 text-right font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {empresasLoading || statusQuery.isLoading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm text-ink-400"
                  >
                    Cargando estado del índice…
                  </td>
                </tr>
              ) : (
                empresas.map((emp) => {
                  const s = allStatuses.find(
                    (x) => x.empresa_codigo === emp.codigo,
                  );
                  const chunks = s?.chunk_count ?? 0;
                  const sources = s?.sources?.length ?? 0;
                  const rowState = rowStates[emp.codigo] ?? { status: "idle" };
                  const isThisLoading =
                    rowState.status === "loading" || bulkRunning;
                  return (
                    <tr key={emp.codigo} className="hover:bg-ink-50/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="size-4 text-ink-400" />
                          <span className="font-mono font-semibold text-ink-900">
                            {emp.codigo}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span
                          className={
                            chunks > 0 ? "text-ink-900" : "text-ink-300"
                          }
                        >
                          {chunks.toLocaleString("es-CL")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink-700">
                        {sources}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-600">
                        {fmtDate(s?.last_indexed_at ?? null)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {rowState.status === "loading" || bulkRunning ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                            <RefreshCcw
                              className="size-3 animate-spin"
                              strokeWidth={2}
                            />
                            Indexando…
                          </span>
                        ) : rowState.status === "ok" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            <CheckCircle2 className="size-3" />
                            OK
                          </span>
                        ) : rowState.status === "error" ? (
                          <span
                            title={rowState.message}
                            className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700"
                          >
                            <AlertTriangle className="size-3" />
                            Error
                          </span>
                        ) : chunks > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            <Database className="size-3" />
                            Indexada
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            <AlertTriangle className="size-3" />
                            Sin indexar
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => reindexOneMut.mutate(emp.codigo)}
                          disabled={isThisLoading}
                          className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-cehta-green hover:bg-cehta-green/5 disabled:opacity-60"
                        >
                          Re-indexar
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Footer explicativo */}
      <div className="mt-8 rounded-2xl border border-blue-200 bg-blue-50/40 p-5 text-sm">
        <p className="font-semibold text-blue-900">
          🎓 Cómo funciona la indexación
        </p>
        <p className="mt-2 text-xs leading-relaxed text-blue-900">
          El backend lee los archivos del Dropbox de cada empresa (carpeta{" "}
          <code>/Apps/CehtaCapital/&lt;EMPRESA&gt;/</code>), los corta en chunks
          de ~500 tokens, genera embeddings con OpenAI{" "}
          <code>text-embedding-3-small</code>, y los guarda en{" "}
          <code>core.ai_documents</code>. Cuando un usuario pregunta al
          asistente, el backend busca los chunks más similares (vector{" "}
          <code>&lt;=&gt;</code>) y los manda como contexto a Claude.
        </p>
      </div>
    </div>
  );
}
