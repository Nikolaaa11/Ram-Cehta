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
 *      EXECUTED desde /vouchers/[id] o bulk desde aca (boton "Marcar
 *      EXECUTED" tras descargar el Excel, Etapa A).
 *
 * Por que pagina dedicada y no tab en /aprobaciones:
 *   - Aprobar y pagar son momentos distintos del flujo financiero.
 *   - El user que aprueba (GG / DIRECTOR) puede no ser el mismo que paga
 *     (Tesoreria / Finance). Separar pestañas facilita auditoria.
 *   - Bulk export de N vouchers necesita selector multiple amigable;
 *     mezclarlo con la cola de firma seria ruido.
 */
import React, { useMemo, useRef, useState } from "react";
import { useModalA11y } from "@/lib/use-modal-a11y";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CheckCheck,
  Download,
  ExternalLink,
  Loader2,
  MessageCircle,
  Paperclip,
  Wallet,
  X as XIcon,
} from "lucide-react";
import { buildWaLink, waMessages } from "@/lib/whatsapp";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useSidebarState } from "@/hooks/use-sidebar-state";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { Surface } from "@/components/ui/surface";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PullToRefreshIndicator } from "@/components/shared/PullToRefreshIndicator";
import { FeedbackPrompt } from "@/components/feedback/FeedbackPrompt";
import { toast } from "@/components/ui/toast";
import { toCLP, toDate } from "@/lib/format";
// R152ii — componentes premium de la pestaña.
import { TransferenciasKpiHeader } from "@/components/transferencias/TransferenciasKpiHeader";
import { EmpresaProgressChips } from "@/components/transferencias/EmpresaProgressChips";
import { CajaAlDiaState } from "@/components/transferencias/CajaAlDiaState";
import { TransferenciasSkeleton } from "@/components/transferencias/TransferenciasSkeleton";

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
  // Round 10 — para boton WhatsApp por fila tras ejecutar la transferencia.
  proveedor_telefono: string | null;
  proveedor_contacto: string | null;
  // Round 113 — proyecto contable dominante (primera linea con proyecto)
  proyecto_dominante: string | null;
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

interface BulkExecuteResponse {
  succeeded: number;
  failed: number;
  executed_codes: string[];
  failures: Array<{ voucher_id: number; codigo?: string; reason: string }>;
}

export default function TransferenciasPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [empresaFilter, setEmpresaFilter] = useState<string>("");
  const [downloading, setDownloading] = useState(false);
  // Round 103 — selector de formato bancario (GENERICO o SANTANDER)
  const [bancoFormato, setBancoFormato] = useState<"GENERICO" | "SANTANDER">(
    "GENERICO",
  );
  const [cuentaOrigen, setCuentaOrigen] = useState<string>("");
  // Etapa A — bulk execute
  const [executing, setExecuting] = useState(false);
  const [showExecuteConfirm, setShowExecuteConfirm] = useState(false);
  // R152y — NPS feedback prompt tras marcar pagos exitosamente
  const [showFeedbackAfterPaid, setShowFeedbackAfterPaid] = useState(false);
  const [feedbackContext, setFeedbackContext] = useState<{ count: number } | null>(null);
  const [executeNota, setExecuteNota] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [executeFecha, setExecuteFecha] = useState(today);
  // Round 149 — comprobante de pago obligatorio al marcar EXECUTED.
  // Después del bulk-execute exitoso, este archivo se sube como
  // attachment tipo TRANSFERENCIA a CADA voucher seleccionado (loop).
  const [executeFile, setExecuteFile] = useState<File | null>(null);
  const executeFileInputRef = useRef<HTMLInputElement | null>(null);

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

  // Round 74 — empty-state contextual. Cuando no hay APPROVED para pagar,
  // usar los counters del sidebar (cache compartido) para apuntar al
  // operador hacia el proximo paso correcto del flow: si tiene drafts ir
  // a /vouchers; si tiene pendientes de firma ir a /aprobaciones.
  const { data: sidebarState } = useSidebarState();
  const draftsMine = sidebarState?.voucher_drafts_mine ?? 0;
  const pendingMyApproval = sidebarState?.voucher_pending_approvals ?? 0;

  // Etapa C — pull-to-refresh en mobile.
  const pull = usePullToRefresh(async () => {
    await refetch();
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

  // R152ii — selected count por empresa (para el mini-donut del chip).
  // Se cuenta sobre TODO el dataset (no items filtrado) para que el ring
  // refleje "X firmadas → seleccionadas para pagar" por compañía.
  const selectedByEmpresa = useMemo(() => {
    const all = data?.items ?? [];
    const map: Record<string, number> = {};
    for (const it of all) {
      if (selectedIds.has(it.voucher_id)) {
        map[it.empresa_codigo] = (map[it.empresa_codigo] ?? 0) + 1;
      }
    }
    return map;
  }, [data, selectedIds]);

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
            banco_formato: bancoFormato,
            cuenta_origen: cuentaOrigen || null,
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
            : "No se pudo generar el Excel. Reintenta en unos segundos.",
        { duration: 10000 },
      );
    } finally {
      setDownloading(false);
    }
  };

  // Etapa A — bulk mark EXECUTED. Despues de subir el Excel al banco y
  // confirmar transferencias, el user marca aca todos los que se pagaron.
  // Round 149 — ahora exige comprobante de pago (archivo) que se sube
  // como attachment tipo TRANSFERENCIA a cada voucher del batch.
  const handleBulkExecute = async () => {
    if (!session) {
      toast.error("Sesión expirada");
      return;
    }
    if (selectedIds.size === 0) {
      toast.error("Seleccioná al menos un voucher");
      return;
    }
    // Round 150 — comprobante de pago opcional. Si hay archivo, se sube
    // después del bulk-execute. Si no, se confirma sin adjunto (el
    // operador puede subirlo manualmente después desde el detalle).
    setExecuting(true);
    try {
      const resp = await apiClient.post<BulkExecuteResponse>(
        "/vouchers/bulk-execute",
        {
          voucher_ids: Array.from(selectedIds),
          fecha_ejecucion: executeFecha,
          nota: executeNota.trim() || null,
        },
        session,
      );

      // Round 149 — subir el comprobante a cada voucher EXECUTED del
      // batch (loop). Si algún upload falla, lo reportamos pero NO
      // revertimos la marca EXECUTED — el operador puede subir el
      // archivo manualmente desde el detalle del voucher después.
      // Lookup contra data.items (no items filtrado) por si el operador
      // seleccionó vouchers de varias empresas con filtro intermedio.
      const allItems = data?.items ?? [];
      const executedVoucherIds = (resp.executed_codes ?? []).map((codigo) => {
        const v = allItems.find((it) => it.codigo === codigo);
        return v?.voucher_id;
      }).filter((v): v is number => v !== undefined);

      let attachedOk = 0;
      let attachedFail = 0;
      if (executeFile && executedVoucherIds.length > 0) {
        for (const vid of executedVoucherIds) {
          try {
            const fd = new FormData();
            fd.append("file", executeFile);
            fd.append("tipo", "TRANSFERENCIA");
            const r = await fetch(
              `${API_BASE}/vouchers/${vid}/attachments`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${session.access_token}`,
                },
                body: fd,
                cache: "no-store",
              },
            );
            if (r.ok) attachedOk++;
            else attachedFail++;
          } catch {
            attachedFail++;
          }
        }
      }

      const attachMsg =
        attachedFail === 0
          ? attachedOk > 0
            ? ` · comprobante subido a ${attachedOk} voucher${attachedOk === 1 ? "" : "s"}`
            : ""
          : ` · ⚠ comprobante falló en ${attachedFail} voucher${attachedFail === 1 ? "" : "s"} (subir manualmente)`;

      if (resp.failed === 0) {
        // R152ii — toast premium con monto pagado, descripción y CTA a la
        // pestaña de vouchers EXECUTED para validar el resultado.
        const montoLote = selectedSummary.total;
        toast.success(
          `${resp.succeeded} pago${resp.succeeded === 1 ? "" : "s"} confirmado${resp.succeeded === 1 ? "" : "s"}`,
          {
            description: `${toCLP(montoLote)} transferidos${attachMsg ? attachMsg.replace(/^ · /, " · ") : ""}.`,
            duration: 9000,
            action: {
              label: "Ver confirmados",
              onClick: () => {
                // Lista de vouchers ya EXECUTED. Si la ruta tipada falla
                // en strict mode, el fallback es navegación dura.
                if (typeof window !== "undefined") {
                  window.location.href = "/vouchers?status=EXECUTED";
                }
              },
            },
          },
        );
        // R152y — disparar NPS feedback tras pago exitoso (con cooldown 14d).
        setFeedbackContext({ count: resp.succeeded });
        setShowFeedbackAfterPaid(true);
      } else {
        toast.info(
          `${resp.succeeded} marcados · ${resp.failed} fallaron${attachMsg}. Revisa los detalles.`,
          { duration: 10000 },
        );
        // Mostrar primeros 3 errores en toasts adicionales
        for (const f of resp.failures.slice(0, 3)) {
          toast.error(`${f.codigo ?? f.voucher_id}: ${f.reason}`, {
            duration: 8000,
          });
        }
      }
      setShowExecuteConfirm(false);
      setExecuteNota("");
      setExecuteFile(null);
      setSelectedIds(new Set());
      // Round 7 pattern — invalidar caches relacionadas para que la
      // lista refresque automaticamente.
      queryClient.invalidateQueries({
        queryKey: ["transferencias-preview"],
      });
      queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["vouchers-kpis"] });
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "No se pudieron marcar como ejecutados.",
        { duration: 10000 },
      );
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <PullToRefreshIndicator
        pullDistance={pull.pullDistance}
        isRefreshing={pull.isRefreshing}
        isPulling={pull.isPulling}
      />
      {/* Hero — Round 98: pattern unificado con system-status y otras */}
      <div className="relative overflow-hidden rounded-3xl bg-ink-50/40 ring-1 ring-hairline p-8 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(rgba(35,108,79,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(35,108,79,0.04) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at top, black 30%, transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 h-72 w-[600px] rounded-full bg-cehta-green/20 blur-3xl opacity-60"
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-4 py-1.5 ring-1 ring-cehta-green/20">
            <Wallet className="size-3.5 text-cehta-green" strokeWidth={2} />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Confirmar pagos · Planilla bancaria
            </p>
          </div>
          <h1 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight bg-gradient-to-br from-ink-900 via-ink-700 to-cehta-green bg-clip-text text-transparent">
            Validar y pagar
          </h1>
          <p className="text-sm md:text-base text-ink-500 mt-2 max-w-2xl">
            Vouchers <strong>APPROVED</strong> (firmados GG + Director) listos
            para pago. Revisa datos, seleccioná los del día y descargá el
            Excel para cargar al banco.
          </p>
        </div>
      </div>

      {/* Loading skeleton matching layout (R152ii — reemplaza el placeholder
          básico anterior por un skeleton premium que reproduce KPIs +
          chips + tabla con shimmer). */}
      {isLoading && <TransferenciasSkeleton />}

      {error && (
        <ErrorState
          title="No se pudo cargar la lista de pagos"
          error={error as Error}
          onRetry={() => refetch()}
        />
      )}

      {/* Empty — Round 74: guidance contextual segun el estado del pipeline.
          R152ii: cuando NO hay nada pendiente en ningún lado, usamos el
          estado premium "Caja al día". Cuando hay drafts o firmas
          pendientes, mantenemos el EmptyState con CTAs contextuales. */}
      {!isLoading && !error && data && data.count === 0 && (
        pendingMyApproval === 0 && draftsMine === 0 ? (
          <CajaAlDiaState />
        ) : (
          <EmptyState
            icon={CheckCircle2}
            tone="info"
            title={
              pendingMyApproval > 0
                ? `Tienes ${pendingMyApproval} voucher${pendingMyApproval > 1 ? "s" : ""} esperando tu firma`
                : `Tienes ${draftsMine} borrador${draftsMine > 1 ? "es" : ""} sin enviar a aprobación`
            }
            description={
              pendingMyApproval > 0
                ? "Acá aparecen los vouchers APPROVED listos para transferir. Primero firmalos en Aprobaciones — cuando un voucher tenga las 2 firmas (GG + DIRECTOR), pasa a APPROVED y aparece acá."
                : "El flujo es: crear voucher → adjuntar factura → enviar a aprobación → firmar GG y DIRECTOR → aparece acá para transferir. Empezá enviando tus borradores a aprobación."
            }
            primaryAction={
              pendingMyApproval > 0
                ? { label: "Ir a Aprobaciones", href: "/aprobaciones" }
                : { label: "Ver mis vouchers", href: "/vouchers" }
            }
            secondaryAction={{ label: "Crear voucher nuevo", href: "/vouchers/nuevo" }}
          />
        )
      )}

      {/* Content */}
      {!isLoading && !error && data && data.count > 0 && (
        <>
          {/* R152ii — KPI header animado (count, total, promedio, antigüedad).
              Reemplaza al grid de 3 cards anteriores. La info de "seleccionados"
              y "sin banco" sigue viva en el sticky action bar inferior. */}
          <TransferenciasKpiHeader items={data.items} totalClp={data.total_clp} />

          {/* R152ii — chips de empresa con mini-donut de progreso seleccionado/total. */}
          <EmpresaProgressChips
            byEmpresa={data.by_empresa}
            selectedByEmpresa={selectedByEmpresa}
            totalCount={data.count}
            empresaFilter={empresaFilter}
            onChange={setEmpresaFilter}
          />

          {/* Bulk action bar — sticky bottom. Etapa A: agregamos boton
              "Marcar EXECUTED" para cerrar el loop: download Excel →
              banco → confirmar pago aca.
              Round 103 — selector de formato bancario (GENERICO o SANTANDER). */}
          {selectedIds.size > 0 && (
            <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cehta-green/30 bg-white p-3 shadow-lg backdrop-blur-md">
              <div className="flex items-center gap-3 px-2 flex-wrap">
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
                {/* Round 103 — selector formato + cuenta origen */}
                <div className="flex items-center gap-1.5 border-l border-hairline pl-3">
                  <label className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">
                    Banco:
                  </label>
                  <select
                    value={bancoFormato}
                    onChange={(e) =>
                      setBancoFormato(e.target.value as "GENERICO" | "SANTANDER")
                    }
                    className="rounded-md border border-hairline px-2 py-1 text-xs"
                  >
                    <option value="GENERICO">Genérico</option>
                    <option value="SANTANDER">Santander</option>
                  </select>
                </div>
                {bancoFormato === "SANTANDER" && (
                  <input
                    type="text"
                    value={cuentaOrigen}
                    onChange={(e) => setCuentaOrigen(e.target.value)}
                    placeholder="Cuenta origen"
                    className="rounded-md border border-hairline px-2 py-1 text-xs font-mono w-32"
                    title="Cuenta Santander de origen (columna A del template)"
                  />
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  disabled={downloading || executing}
                  className="rounded-xl px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading || executing || selectedIds.size === 0}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-cehta-green/30 bg-white px-4 py-2 text-sm font-semibold text-cehta-green shadow-sm hover:bg-cehta-green/5 disabled:opacity-60"
                  title="Descargar el Excel para cargarlo al banco"
                >
                  {downloading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {downloading ? "Generando…" : "Excel transferencia"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowExecuteConfirm(true)}
                  disabled={downloading || executing || selectedIds.size === 0}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow hover:bg-cehta-green-700 disabled:opacity-60"
                  title="Marcar como pagados — usar despues de confirmar las transferencias en el banco"
                >
                  <CheckCheck className="size-4" />
                  Marcar pagados
                </button>
              </div>
            </div>
          )}

          {/* Modal confirmacion bulk-execute.
              QA fix 14/05/2026 — agregado overflow-y-auto + my-auto + Escape
              key. En mobile con teclado abierto, antes el modal se cortaba
              y no se podia scrollear al boton confirmar. */}
          {showExecuteConfirm && (
            <ExecuteConfirmModalScaffold
              onClose={() => !executing && setShowExecuteConfirm(false)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="my-auto w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
              >
                <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
                  <CheckCheck className="size-3.5" />
                  Confirmar pagos
                </div>
                <p className="text-sm text-ink-700">
                  Vas a marcar como <strong>EXECUTED</strong>{" "}
                  <span className="font-semibold">
                    {selectedSummary.count} voucher
                    {selectedSummary.count === 1 ? "" : "s"}
                  </span>{" "}
                  por un total de{" "}
                  <span className="font-semibold">
                    {toCLP(selectedSummary.total)}
                  </span>
                  .
                </p>
                <p className="text-xs text-ink-500">
                  Haz esto <em>después</em> de confirmar las transferencias
                  en el portal del banco. Una vez marcado, el voucher pasa
                  al historial y deja de aparecer en esta lista.
                </p>

                <div className="space-y-3">
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                      Fecha de transferencia
                    </span>
                    <input
                      type="date"
                      value={executeFecha}
                      max={today}
                      onChange={(e) => setExecuteFecha(e.target.value)}
                      className="mt-1 w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                      Nota interna (opcional)
                    </span>
                    <input
                      type="text"
                      maxLength={300}
                      value={executeNota}
                      onChange={(e) => setExecuteNota(e.target.value)}
                      placeholder="ej. lote BCI 2026-05-14"
                      className="mt-1 w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                    />
                    <span className="mt-1 block text-[10px] text-ink-500">
                      Queda en el audit log de cada voucher.
                    </span>
                  </label>

                  {/* Round 150 — Comprobante de pago OPCIONAL.
                      Si se adjunta, se sube como attachment tipo
                      TRANSFERENCIA a cada voucher del batch después del
                      bulk-execute exitoso. Si no, se confirma igual. */}
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                      Adjunta comprobante de pago (opcional)
                    </span>
                    {!executeFile ? (
                      <button
                        type="button"
                        onClick={() => executeFileInputRef.current?.click()}
                        className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-hairline bg-ink-50/50 px-4 py-4 text-sm font-medium text-ink-600 transition-colors hover:border-cehta-green/50 hover:bg-cehta-green/5 hover:text-cehta-green"
                      >
                        <Paperclip className="size-4" />
                        Adjunta comprobante de pago
                      </button>
                    ) : (
                      <div className="mt-1 flex items-center gap-2 rounded-xl border border-cehta-green/30 bg-cehta-green/5 px-3 py-2.5">
                        <Paperclip className="size-4 shrink-0 text-cehta-green" />
                        <span
                          className="flex-1 truncate text-sm text-ink-900"
                          title={executeFile.name}
                        >
                          {executeFile.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-ink-500">
                          {(executeFile.size / 1024).toFixed(0)} KB
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setExecuteFile(null);
                            if (executeFileInputRef.current)
                              executeFileInputRef.current.value = "";
                          }}
                          disabled={executing}
                          className="shrink-0 rounded-md p-1 text-ink-500 hover:bg-ink-100 hover:text-negative"
                          title="Quitar archivo"
                        >
                          <XIcon className="size-3.5" />
                        </button>
                      </div>
                    )}
                    <input
                      ref={executeFileInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,image/*,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setExecuteFile(f);
                      }}
                    />
                    <span className="mt-1 block text-[10px] text-ink-500">
                      Si tenés el comprobante del banco (PDF, JPG o PNG),
                      adjuntalo. Se va a guardar en los{" "}
                      {selectedSummary.count} voucher
                      {selectedSummary.count === 1 ? "" : "s"} como respaldo.
                      Si no, podés subirlo después desde el detalle.
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowExecuteConfirm(false)}
                    disabled={executing}
                    aria-disabled={executing}
                    className="rounded-xl px-4 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkExecute}
                    disabled={executing}
                    aria-disabled={executing}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-5 py-2 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                    title={
                      executeFile
                        ? "Confirmar y subir comprobante a los vouchers"
                        : "Confirmar pagos (sin comprobante)"
                    }
                  >
                    {executing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CheckCheck className="size-4" />
                    )}
                    {executing ? "Procesando…" : "Confirmar pagos"}
                  </button>
                </div>
              </div>
            </ExecuteConfirmModalScaffold>
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
                    {/* QA fix 14/05/2026 — scope="col" para accesibilidad. */}
                    <th scope="col" className="px-4 py-3">Código</th>
                    <th scope="col" className="px-4 py-3">Empresa</th>
                    <th scope="col" className="px-4 py-3">Fecha</th>
                    <th scope="col" className="px-4 py-3">Proveedor</th>
                    <th scope="col" className="px-4 py-3">Glosa</th>
                    <th scope="col" className="px-4 py-3 text-right">Monto</th>
                    <th scope="col" className="px-4 py-3">Datos bancarios</th>
                    {/* Round 10 — columna WhatsApp para notificar al proveedor
                        tras ejecutar la transferencia. */}
                    <th scope="col" className="px-4 py-3 text-center">WA</th>
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
                          {v.proyecto_dominante && (
                            <div
                              className="mt-0.5 truncate text-[10px] font-mono text-cehta-green"
                              title={`Proyecto contable: ${v.proyecto_dominante}`}
                            >
                              {v.proyecto_dominante}
                            </div>
                          )}
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
                        {/* Round 10 — botón WhatsApp para confirmar pago al
                            proveedor después de ejecutar la transferencia. */}
                        <td className="px-4 py-3 text-center">
                          {(() => {
                            const waLink = buildWaLink(
                              v.proveedor_telefono,
                              waMessages.confirmarTransferencia({
                                nombre: v.proveedor_contacto || v.contraparte_nombre,
                                monto: parseFloat(v.monto),
                                codigo: v.codigo,
                                glosa: v.glosa,
                              }),
                            );
                            if (!waLink) {
                              return (
                                <span
                                  className="text-[10px] text-ink-300"
                                  title="Sin teléfono del proveedor cargado"
                                >
                                  —
                                </span>
                              );
                            }
                            return (
                              <a
                                href={waLink}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 rounded-lg bg-[#25D366] px-2 py-1 text-[10px] font-semibold text-white hover:bg-[#1FB453]"
                                title="Confirmar pago al beneficiario por WhatsApp"
                                aria-label={`Notificar pago a ${v.contraparte_nombre} por WhatsApp`}
                              >
                                <MessageCircle className="size-3" strokeWidth={2.5} />
                                Avisar
                              </a>
                            );
                          })()}
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

      {/* R152y — NPS feedback prompt tras marcar pagos exitosamente.
          El componente tiene cooldown 14d en localStorage, así no spammea. */}
      {showFeedbackAfterPaid && (
        <FeedbackPrompt
          actionType="transferencia.confirmar"
          question="¿Qué tan fácil fue confirmar el pago?"
          context={feedbackContext ?? undefined}
        />
      )}
    </div>
  );
}

/**
 * QA fix 14/05/2026 — wrapper de modal con:
 *   1. overflow-y-auto en el backdrop (mobile keyboard-friendly)
 *   2. Escape key dispara onClose (UX premium)
 *   3. role=dialog + aria-modal
 *
 * El inner card debe tener `my-auto` para centrarse cuando alcanza,
 * pero scroll cuando supera la altura del viewport.
 */
function ExecuteConfirmModalScaffold({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Round 23 — focus trap + ESC + scroll lock + restauración foco previo.
  const ref = useModalA11y({ open: true, onClose });

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
    >
      {children}
    </div>
  );
}
