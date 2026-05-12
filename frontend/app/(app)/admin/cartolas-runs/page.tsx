"use client";

/**
 * /admin/cartolas-runs — historial de imports OCR de cartolas bancarias.
 *
 * Cada run = un PDF de cartola procesado. Muestra:
 *   - empresa + path + tamaño archivo
 *   - banco detectado + período
 *   - status (imported / failed_parse / failed_ocr_required / etc.)
 *   - filas extraídas / insertadas / skipped (duplicates)
 *   - quién lo disparó + cuándo
 *
 * Útil para auditar qué PDFs se cargaron OK y cuáles necesitan reintento.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  Banknote,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileImage,
  Loader2,
  Building2,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";

interface CartolaRun {
  run_id: number;
  empresa_codigo: string;
  dropbox_path: string;
  file_hash: string;
  file_size_bytes: number | null;
  banco_detectado: string | null;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  status: string;
  rows_extracted: number;
  rows_inserted: number;
  rows_skipped: number;
  error_message: string | null;
  triggered_by: string | null;
  triggered_at: string;
  finished_at: string | null;
}

interface Empresa {
  codigo: string;
  razon_social: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  parsed: "Parseado",
  imported: "Importado",
  failed_parse: "Falló parse",
  failed_ocr_required: "Requiere OCR",
  failed_unknown_format: "Banco desconocido",
  skipped_duplicate: "Duplicado",
};

function statusTone(s: string): string {
  switch (s) {
    case "imported":
    case "parsed":
      return "bg-cehta-green/10 text-cehta-green";
    case "failed_parse":
    case "failed_unknown_format":
      return "bg-red-50 text-red-600";
    case "failed_ocr_required":
      return "bg-amber-50 text-amber-700";
    case "skipped_duplicate":
      return "bg-ink-100 text-ink-500";
    default:
      return "bg-blue-50 text-blue-700";
  }
}

const BANCO_LABELS: Record<string, string> = {
  santander: "Santander",
  bci: "BCI",
  banco_estado: "BancoEstado",
  bice: "BICE",
  itau: "Itaú",
  scotiabank: "Scotiabank",
  security: "Security",
  internacional: "Internacional",
  consorcio: "Consorcio",
  falabella: "Falabella",
  unknown: "—",
};

function fmtSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function CartolasRunsPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [empresaFilter, setEmpresaFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [syncingEmpresa, setSyncingEmpresa] = useState<string | null>(null);

  const { data: empresas } = useQuery<Empresa[]>({
    queryKey: ["empresas"],
    queryFn: () => apiClient.get<Empresa[]>("/empresa", session),
    enabled: !!session,
    staleTime: 5 * 60_000,
  });

  const { data: runs, isLoading } = useQuery<CartolaRun[]>({
    queryKey: ["cartolas-runs", empresaFilter, statusFilter],
    queryFn: () => {
      const qs = new URLSearchParams({ limit: "100" });
      if (empresaFilter) qs.set("empresa_codigo", empresaFilter);
      if (statusFilter) qs.set("status", statusFilter);
      return apiClient.get<CartolaRun[]>(`/cartolas/runs?${qs}`, session);
    },
    enabled: !!session,
    staleTime: 30_000,
  });

  const syncMut = useMutation({
    mutationFn: (codigo: string) =>
      apiClient.post(`/cartolas/sync/${codigo}`, {}, session),
    onMutate: (codigo) => setSyncingEmpresa(codigo),
    onSettled: () => setSyncingEmpresa(null),
    onSuccess: (data: unknown, codigo) => {
      const d = data as { files_imported?: number; files_skipped?: number; movimientos_inserted?: number };
      const imp = d.files_imported ?? 0;
      const skipped = d.files_skipped ?? 0;
      const inserted = d.movimientos_inserted ?? 0;
      toast.success(
        `${codigo}: ${imp} PDFs nuevos · ${inserted} movimientos · ${skipped} duplicados`,
      );
      qc.invalidateQueries({ queryKey: ["cartolas-runs"] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`Sync falló: ${detail}`);
    },
  });

  const aggregateStats = useMemo(() => {
    if (!runs) return null;
    return {
      total: runs.length,
      imported: runs.filter((r) => r.status === "imported").length,
      failed: runs.filter((r) => r.status.startsWith("failed")).length,
      total_movs: runs.reduce((acc, r) => acc + r.rows_inserted, 0),
    };
  }, [runs]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href={"/admin" as Route}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            Panel admin
          </Link>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
            Cartolas Bancarias · OCR
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Sync automático de PDFs en Dropbox{" "}
            <code className="text-[11px]">
              /04-Financiero/Cartolas Bancarias/
            </code>{" "}
            → <code className="text-[11px]">core.movimientos</code> para
            conciliación bancaria.
          </p>
        </div>
        {empresaFilter && (
          <button
            type="button"
            onClick={() => syncMut.mutate(empresaFilter)}
            disabled={syncingEmpresa === empresaFilter}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {syncingEmpresa === empresaFilter ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Sync cartolas · {empresaFilter}
          </button>
        )}
      </div>

      {/* KPIs agregados */}
      {aggregateStats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-hairline bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Runs totales
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink-900">
              {aggregateStats.total}
            </p>
          </div>
          <div className="rounded-2xl border border-hairline bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-cehta-green">
              Importados
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-cehta-green">
              {aggregateStats.imported}
            </p>
          </div>
          <div className="rounded-2xl border border-hairline bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-red-600">
              Fallidos
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-red-600">
              {aggregateStats.failed}
            </p>
          </div>
          <div className="rounded-2xl border border-hairline bg-white p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Movimientos creados
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink-900">
              {aggregateStats.total_movs}
            </p>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-hairline bg-ink-50/30 px-4 py-3">
        <Building2 className="h-3.5 w-3.5 text-ink-400" strokeWidth={1.75} />
        <select
          value={empresaFilter}
          onChange={(e) => setEmpresaFilter(e.target.value)}
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
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filtrar por estado"
          className="rounded-lg border-0 bg-white px-3 py-1.5 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-24 rounded-full" />
                </div>
              ))}
            </div>
          ) : !runs?.length ? (
            <div className="flex flex-col items-center gap-3 p-12 text-center">
              <Banknote
                className="h-10 w-10 text-ink-300"
                strokeWidth={1.25}
              />
              <p className="text-sm text-ink-500">
                Sin runs todavía. Elegí una empresa arriba y tocá &ldquo;Sync
                cartolas&rdquo; para procesar los PDFs en Dropbox.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-ink-50/60 text-left text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-3 py-2">Empresa</th>
                  <th className="px-3 py-2">Archivo</th>
                  <th className="px-3 py-2">Banco</th>
                  <th className="px-3 py-2">Período</th>
                  <th className="px-3 py-2 text-right">Filas</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Cuándo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline" data-virtualized>
                {runs.map((r) => {
                  const fileName = r.dropbox_path.split("/").pop() ?? "";
                  return (
                    <tr key={r.run_id} className="hover:bg-ink-50/30">
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.empresa_codigo}
                      </td>
                      <td className="px-3 py-2">
                        <p
                          className="text-xs text-ink-700 truncate max-w-[260px]"
                          title={r.dropbox_path}
                        >
                          {fileName}
                        </p>
                        <p className="text-[10px] text-ink-400">
                          {fmtSize(r.file_size_bytes)}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {BANCO_LABELS[r.banco_detectado ?? "unknown"] ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs tabular-nums">
                        {r.periodo_desde && r.periodo_hasta ? (
                          <>
                            {r.periodo_desde}
                            <br />
                            <span className="text-ink-400">→</span>{" "}
                            {r.periodo_hasta}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <p className="font-mono text-xs tabular-nums">
                          <span className="text-cehta-green">
                            +{r.rows_inserted}
                          </span>
                          {r.rows_skipped > 0 && (
                            <span className="ml-1 text-ink-400">
                              ↻{r.rows_skipped}
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-ink-400">
                          de {r.rows_extracted}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusTone(
                            r.status,
                          )}`}
                          title={r.error_message ?? ""}
                        >
                          {r.status === "imported" && (
                            <CheckCircle2
                              className="h-2.5 w-2.5"
                              strokeWidth={2.5}
                            />
                          )}
                          {r.status === "failed_ocr_required" && (
                            <FileImage
                              className="h-2.5 w-2.5"
                              strokeWidth={2.5}
                            />
                          )}
                          {r.status.startsWith("failed") &&
                            r.status !== "failed_ocr_required" && (
                              <XCircle
                                className="h-2.5 w-2.5"
                                strokeWidth={2.5}
                              />
                            )}
                          {STATUS_LABELS[r.status] ?? r.status}
                        </span>
                        {r.error_message && (
                          <p className="mt-1 text-[10px] italic text-red-600 max-w-[200px] truncate">
                            {r.error_message}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-ink-500 tabular-nums">
                        {new Date(r.triggered_at).toLocaleString("es-CL", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        <br />
                        <span className="text-ink-400">
                          {r.triggered_by === "manual" ||
                          r.triggered_by === "cron"
                            ? r.triggered_by
                            : "manual"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Drag-drop upload — UX hint, no upload directo (los PDFs van a Dropbox manual) */}
      {empresaFilter && (
        <div className="rounded-2xl border-2 border-dashed border-hairline bg-cehta-green/5 p-6 text-center">
          <Banknote
            className="mx-auto h-8 w-8 text-cehta-green/60"
            strokeWidth={1.25}
          />
          <p className="mt-2 text-sm font-medium text-ink-700">
            Subí los PDFs de cartolas a Dropbox antes de sync
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Path:{" "}
            <code className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px]">
              /Cehta Capital/01-Empresas/{empresaFilter}/04-Financiero/Cartolas
              Bancarias/
            </code>
          </p>
          <p className="mt-2 text-xs text-ink-500">
            Después tocá <strong>Sync cartolas · {empresaFilter}</strong>{" "}
            arriba.
          </p>
        </div>
      )}

      {/* Help text */}
      <div className="rounded-2xl border border-hairline bg-ink-50/40 p-4 text-xs text-ink-600">
        <p className="font-semibold mb-2">Convenciones de naming en Dropbox:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            Path:{" "}
            <code className="text-[11px]">
              /Cehta Capital/01-Empresas/{`{COD}`}/04-Financiero/Cartolas
              Bancarias/
            </code>
          </li>
          <li>
            Naming sugerido:{" "}
            <code className="text-[11px]">{`{YYYY-MM}_{banco}.pdf`}</code> (ej:
            <code className="text-[11px]">2026-04_santander.pdf</code>)
          </li>
          <li>
            <strong>Idempotente</strong>: re-correr no duplica. El{" "}
            <code className="text-[11px]">file_hash</code> evita re-procesar.
          </li>
          <li>
            <strong>PDFs escaneados</strong> (imagen, no texto digital) quedan
            como{" "}
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
              Requiere OCR
            </span>{" "}
            — futuro: Claude vision.
          </li>
        </ul>
      </div>
    </div>
  );
}
