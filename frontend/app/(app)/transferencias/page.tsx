"use client";

/**
 * /transferencias — Round 11
 *
 * Vouchers APPROVED listos para pago, agrupados por empresa, con bulk
 * select y generación de Excel de transferencia masiva.
 *
 * Flujo del usuario:
 *   1. Llega aca despues de firmar vouchers en /aprobaciones (ya APPROVED)
 *   2. Ve la lista filtrable por empresa
 *   3. Selecciona los que va a pagar hoy (typicamente "todos" o subset)
 *   4. Click "Descargar Excel transferencia masiva" → XLSX descargado
 *   5. Sube el XLSX al portal del banco (BCI / Santander / BancoEstado)
 *   6. Una vez confirmadas las transferencias, marca cada voucher como
 *      EXECUTED desde /vouchers/[id] o desde aca (no implementado aun
 *      bulk, se hace 1 a 1).
 *
 * Por que pagina dedicada y no tab en /aprobaciones:
 *   - Aprobar y pagar son momentos distintos del flujo financiero.
 *   - El user que aprueba (GG / DIRECTOR) puede no ser el mismo que paga
 *     (Tesoreria / Finance). Separar pestañas facilita auditoria.
 *   - Bulk export de N vouchers necesita selector multiple amigable;
 *     mezclarlo con la cola de firma seria ruido.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Wallet,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { Surface } from "@/components/ui/surface";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { toast } from "@/components/ui/toast";
import { toCLP, toDate } from "@/lib/format";

interface TransferenciaItem {
  voucher_id: number;
  codigo: string;
  empresa_codigo: string;
  tipo: string;
  fecha_documento: string | null;
  glosa: string;
  contraparte_rut: string | null;
  contraparte_nombre: string | null;
  monto: string; // viene como string para preservar precision Decimal
  forma_pago: string | null;
  tiene_datos_bancarios: boolean;
}

interface PreviewResponse {
  count: number;
  total_clp: number;
  items: TransferenciaItem[];
  by_empresa: Array<{
    empresa_codigo: string;
    count: number;
    total_clp: number;
  }>;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export default function TransferenciasPage() {
  const { session } = useSession();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [empresaFilter, setEmpresaFilter] = useState<string>("");
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<PreviewResponse>({
    queryKey: ["transferencias-preview"],
    queryFn: () =>
      apiClient.get<PreviewResponse>(
        "/vouchers/transferencia-masiva/preview",
        session,
      ),
    enabled: !!session,
    staleTime: 30_000,
  });

  const items = useMemo(() => {
    const all = data?.items ?? [];
    if (!empresaFilter) return all;
    return all.filter((i) => i.empresa_codigo === empresaFilter);
  }, [data, empresaFilter]);

  const allFilteredSelected =
    items.length > 0 && items.every((i) => selectedIds.has(i.voucher_id));

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        // Deselect all visible
        for (const i of items) next.delete(i.voucher_id);
      } else {
        for (const i of items) next.add(i.voucher_id);
      }
      return next;
    });
  };

  // Totales del set seleccionado
  const selectedSummary = useMemo(() => {
    const sel = items.filter((i) => selectedIds.has(i.voucher_id));
    const total = sel.reduce(
      (acc, i) => acc + parseFloat(i.monto || "0"),
      0,
    );
    const sinBanco = sel.filter((i) => !i.tiene_datos_bancarios).length;
    return { count: sel.length, total, sinBanco };
  }, [items, selectedIds]);

  const handleDownload = async () => {
    if (!session) {
      toast.error("Sesión expirada");
      return;
    }
    if (selectedIds.size === 0) {
      toast.error("Seleccioná al menos un voucher");
      return;
    }
    setDownloading(true);
    try {
      // Llamada directa con fetch para preservar el blob.
      const res = await fetch(
        `${API_BASE}/vouchers/transferencia-masiva`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            voucher_ids: Array.from(selectedIds),
            banco_formato: "GENERICO",
          }),
        },
      );
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          detail = body.detail ?? body.message ?? detail;
        } catch {
          /* non-JSON */
        }
        throw new ApiError(res.status, detail);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Sacar el filename del header Content-Disposition si esta.
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="?([^"]+)"?/.exec(cd);
      a.download = match?.[1] ?? `transferencia_masiva.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const totalClp = res.headers.get("X-Total-CLP");
      const totalRows = res.headers.get("X-Total-Rows");
      const missing = res.headers.get("X-Missing-Voucher-Ids");

      toast.success(
        `Excel descargado · ${totalRows} vouchers · $${parseInt(totalClp ?? "0", 10).toLocaleString("es-CL")} CLP`,
        { duration: 8000 },
      );
      if (missing) {
        toast.info(
          `${missing.split(",").length} vouchers solicitados no se incluyeron (sin scope, sin status APPROVED, o no existen)`,
          { duration: 10000 },
        );
      }
      // Limpiar seleccion
      setSelectedIds(new Set());
      // Refrescar lista (alguno podria haber cambiado de status entre tanto)
      refetch();
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "No se pudo generar el Excel. Reintentá en unos segundos.",
        { duration: 10000 },
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white via-cehta-green/[0.04] to-blue-50/30 ring-1 ring-cehta-green/15 p-6 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-cehta-green/15 blur-3xl"
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-3 py-1 ring-1 ring-cehta-green/20">
            <Wallet className="size-3.5 text-cehta-green" strokeWidth={2} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Round 11 · Transferencias masivas
            </p>
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
            Pagar vouchers aprobados
          </h1>
          <p className="text-sm text-ink-500 mt-1 max-w-2xl">
            Vouchers <strong>APPROVED</strong> (ya firmados por GG +
            Director) listos para pago. Seleccioná los que vas a transferir
            hoy y descargá el Excel para cargar al banco.
          </p>
        </div>
      </div>

      {/* Loading / Error */}
      {isLoading && (
        <Surface className="p-10 text-center">
          <Loader2 className="mx-auto mb-3 size-6 animate-spin text-cehta-green" />
          <p className="text-sm text-ink-500">Cargando vouchers aprobados…</p>
        </Surface>
      )}

      {error && (
        <ErrorState
          title="No se pudo cargar la lista de pagos"
          error={error as Error}
          onRetry={() => refetch()}
        />
      )}

      {/* Empty */}
      {!isLoading && !error && data && data.count === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title="Sin vouchers pendientes de pago"
          description="Todo lo aprobado ya se pagó. Cuando se aprueben nuevos vouchers, aparecerán acá."
          tone="positive"
        />
      )}

      {/* Content */}
      {!isLoading && !error && data && data.count > 0 && (
        <>
          {/* KPI cards + filtro por empresa */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Surface className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="size-5 text-cehta-green" />
                <span className="text-sm font-medium text-ink-700">
                  Total aprobado
                </span>
              </div>
              <div className="text-3xl font-semibold text-ink-900">
                {data.count}
              </div>
              <div className="text-xs text-ink-500 mt-1">
                {toCLP(data.total_clp)}
              </div>
            </Surface>
            <Surface className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="size-5 text-blue-500" />
                <span className="text-sm font-medium text-ink-700">
                  Seleccionados
                </span>
              </div>
              <div className="text-3xl font-semibold text-blue-600">
                {selectedSummary.count}
              </div>
              <div className="text-xs text-ink-500 mt-1">
                {toCLP(selectedSummary.total)} a transferir
              </div>
            </Surface>
            <Surface className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="size-5 text-amber-500" />
                <span className="text-sm font-medium text-ink-700">
                  Sin datos bancarios
                </span>
              </div>
              <div className="text-3xl font-semibold text-amber-600">
                {selectedSummary.sinBanco}
              </div>
              <div className="text-xs text-ink-500 mt-1">
                Filas con campos en blanco — completar manualmente
              </div>
            </Surface>
          </div>

          {/* Empresa chips */}
          {data.by_empresa.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                Por empresa:
              </span>
              <button
                type="button"
                onClick={() => setEmpresaFilter("")}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
                  empresaFilter === ""
                    ? "bg-cehta-green/10 text-cehta-green ring-cehta-green/30"
                    : "bg-white text-ink-600 ring-hairline hover:bg-ink-50"
                }`}
              >
                Todas ({data.count})
              </button>
              {data.by_empresa.map((b) => (
                <button
                  key={b.empresa_codigo}
                  type="button"
                  onClick={() => setEmpresaFilter(b.empresa_codigo)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
                    empresaFilter === b.empresa_codigo
                      ? "bg-blue-50 text-blue-700 ring-blue-200"
                      : "bg-white text-ink-600 ring-hairline hover:bg-ink-50"
                  }`}
                >
                  <Building2 className="inline size-3 -mt-0.5 mr-1" />
                  {b.empresa_codigo} ({b.count})
                </button>
              ))}
            </div>
          )}

          {/* Bulk action bar — sticky bottom */}
          {selectedIds.size > 0 && (
            <div className="sticky bottom-4 z-10 flex items-center justify-between rounded-2xl border border-cehta-green/30 bg-white p-3 shadow-lg backdrop-blur-md">
              <div className="flex items-center gap-3 px-2">
                <div className="text-sm font-medium text-ink-900">
                  {selectedSummary.count} seleccionados
                </div>
                <div className="text-xs text-ink-500">
                  Total: <span className="font-semibold text-ink-900">{toCLP(selectedSummary.total)}</span>
                </div>
                {selectedSummary.sinBanco > 0 && (
                  <div className="text-xs text-amber-700 inline-flex items-center gap-1">
                    <AlertTriangle className="size-3" />
                    {selectedSummary.sinBanco} sin datos bancarios
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  disabled={downloading}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading || selectedIds.size === 0}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow hover:bg-cehta-green-700 disabled:opacity-60"
                >
                  {downloading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {downloading ? "Generando…" : "Descargar Excel transferencia"}
                </button>
              </div>
            </div>
          )}

          {/* Tabla */}
          <Surface padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-hairline text-sm">
                <thead className="sticky top-0 z-10 bg-ink-50/95 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500 backdrop-blur-sm">
                  <tr>
                    <th className="w-8 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleAllVisible}
                        aria-label="Seleccionar todos los visibles"
                        className="h-3.5 w-3.5 rounded border-hairline text-cehta-green focus:ring-cehta-green"
                      />
                    </th>
                    <th className="px-4 py-3">Código</th>
                    <th className="px-4 py-3">Empresa</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Proveedor</th>
                    <th className="px-4 py-3">Glosa</th>
                    <th className="px-4 py-3 text-right">Monto</th>
                    <th className="px-4 py-3">Datos bancarios</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {items.map((v) => {
                    const selected = selectedIds.has(v.voucher_id);
                    return (
                      <tr
                        key={v.voucher_id}
                        className={`transition-colors hover:bg-ink-50/40 ${
                          selected ? "bg-cehta-green/5" : ""
                        }`}
                      >
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleSelect(v.voucher_id)}
                            aria-label={`Seleccionar voucher ${v.codigo}`}
                            className="h-3.5 w-3.5 rounded border-hairline text-cehta-green focus:ring-cehta-green"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/vouchers/${v.voucher_id}` as Route}
                            prefetch={true}
                            className="inline-flex items-center gap-1 font-mono text-xs text-cehta-green hover:underline"
                          >
                            {v.codigo}
                            <ExternalLink className="size-3 text-ink-300" />
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-cehta-green/10 text-cehta-green font-medium">
                            {v.empresa_codigo}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-ink-700 tabular-nums">
                          {v.fecha_documento ? toDate(v.fecha_documento) : "—"}
                        </td>
                        <td className="px-4 py-3 text-ink-700">
                          <div className="max-w-xs truncate">
                            {v.contraparte_nombre || (
                              <span className="text-ink-300">—</span>
                            )}
                          </div>
                          {v.contraparte_rut && (
                            <div className="text-[10px] text-ink-500 font-mono">
                              {v.contraparte_rut}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-ink-600">
                          <div className="max-w-md truncate">{v.glosa}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-ink-900 tabular-nums">
                          {toCLP(parseFloat(v.monto))}
                        </td>
                        <td className="px-4 py-3">
                          {v.tiene_datos_bancarios ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-cehta-green/10 px-2 py-0.5 text-[10px] font-medium text-cehta-green">
                              <CheckCircle2 className="size-3" />
                              Completos
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                              title="Banco / cuenta no estan en el catalogo del proveedor. Vas a tener que llenarlos a mano en el Excel."
                            >
                              <AlertTriangle className="size-3" />
                              Faltan
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Surface>

          {/* Hint footer */}
          <p className="text-xs text-ink-500">
            💡 <strong>Workflow:</strong> seleccioná los vouchers a pagar →
            descargá el Excel → cargá al banco (BCI / Santander /
            BancoEstado) → confirmás las transferencias. Después marcá cada
            voucher como EXECUTED desde su pantalla de detalle.
          </p>
        </>
      )}
    </div>
  );
}
