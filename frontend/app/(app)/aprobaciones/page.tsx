"use client";

/**
 * /aprobaciones — V5++ ola CI
 *
 * Pantalla dedicada para aprobadores (GG / Director / COO / Contador /
 * Tesoreria). Lista TODOS los vouchers PENDING donde el current user
 * es el proximo aprobador, agrupados por empresa, con todo lo necesario
 * para decidir sin abrir el detalle:
 *
 *   - Codigo + tipo + proveedor + folio + total + dias pendiente
 *   - Glosa truncada
 *   - Link al adjunto (factura/boleta)
 *   - Badge de regla matcheada + reinforced si aplica
 *   - Indicador "Firma X/Y" (progreso del flujo)
 *   - Boton "Firmar como {mi rol}" (con confirmacion + comentario opcional)
 *   - Boton "Ver detalle" para casos que requieran inspeccion
 *
 * El endpoint /vouchers/mis-pendientes filtra server-side: solo vouchers
 * donde el user es el next pending approver. Excluye duplicados, vouchers
 * sin regla, y los que el user ya firmo (anti-doble-firma).
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  Clock,
  FileSignature,
  FileText,
  Inbox,
  PenTool,
  RefreshCw,
  Sparkles,
  Square,
  XCircle,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";

interface MisPendientesItem {
  voucher_id: number;
  codigo: string;
  empresa_codigo: string;
  empresa_razon_social: string | null;
  tipo: string;
  fecha_contable: string;
  fecha_creacion: string;
  contraparte_nombre: string | null;
  contraparte_rut: string | null;
  doc_tributario_tipo: string | null;
  doc_tributario_folio: string | null;
  glosa: string | null;
  moneda: string;
  total: string;
  creador_email: string | null;
  mi_rol_para_firmar: string;
  rol_label: string;
  firmas_hechas: number;
  firmas_totales: number;
  matched_rule_descripcion: string | null;
  reinforced: boolean;
  dias_pendiente: number;
  primer_adjunto_dropbox_path: string | null;
}

interface MisPendientesResponse {
  total: number;
  items: MisPendientesItem[];
}

const fmtMonto = (v: string, moneda: string): string => {
  const n = parseFloat(v);
  if (!n) return "—";
  if (moneda === "CLP") return `$${Math.round(n).toLocaleString("es-CL")}`;
  const prefix = moneda === "USD" ? "US$" : moneda === "UF" ? "UF " : `${moneda} `;
  return `${prefix}${n.toLocaleString("es-CL", { maximumFractionDigits: 2 })}`;
};

const fmtFecha = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString("es-CL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

const urgencyChip = (dias: number) => {
  if (dias >= 7)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-700">
        <AlertTriangle className="size-3" /> Urgente · {dias}d
      </span>
    );
  if (dias >= 3)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700">
        <Clock className="size-3" /> {dias}d esperando
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-600">
      <Clock className="size-3" /> {dias}d
    </span>
  );
};

interface BulkApproveItemResult {
  voucher_id: number;
  success: boolean;
  error: string | null;
  new_status: string | null;
}
interface BulkApproveResponse {
  total: number;
  succeeded: number;
  failed: number;
  items: BulkApproveItemResult[];
}

export default function AprobacionesPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [signingFor, setSigningFor] = useState<MisPendientesItem | null>(null);
  const [showRejectFor, setShowRejectFor] = useState<MisPendientesItem | null>(
    null,
  );
  // V5++ ola CJ — bulk approve UI. Mapa voucher_id -> seleccionado.
  // Permitimos solo bulk APPROVE (rechazo seguimos uno por uno porque cada
  // rechazo necesita su razón > 10 chars).
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkSigningRole, setBulkSigningRole] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } =
    useQuery<MisPendientesResponse>({
      queryKey: ["vouchers", "mis-pendientes"],
      queryFn: () =>
        apiClient.get<MisPendientesResponse>(
          "/vouchers/mis-pendientes",
          session,
        ),
      enabled: !!session,
      staleTime: 60_000,
    });

  // Agrupar por empresa para visual claro
  const grouped = useMemo(() => {
    const map = new Map<string, MisPendientesItem[]>();
    for (const item of data?.items ?? []) {
      const k = item.empresa_codigo;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  // Items seleccionados como objetos completos (para el dialog).
  const selectedItems = useMemo(() => {
    return (data?.items ?? []).filter((i) => selectedIds.has(i.voucher_id));
  }, [data, selectedIds]);

  // Para bulk approve necesitamos que TODOS los seleccionados tengan el
  // mismo rol pendiente (porque el endpoint firma con un solo rol). Si
  // mezclás GG + DIRECTOR no podés bulk — el botón se deshabilita.
  const selectedRoles = useMemo(() => {
    const roles = new Set(selectedItems.map((i) => i.mi_rol_para_firmar));
    return Array.from(roles);
  }, [selectedItems]);
  const bulkRoleConsistente = selectedRoles.length === 1;

  const toggleSelected = (vid: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(vid)) next.delete(vid);
      else next.add(vid);
      return next;
    });
  };
  const selectAllInGroup = (items: MisPendientesItem[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      // Si TODOS estan ya seleccionados → deseleccionar todos del grupo.
      // Si alguno NO esta seleccionado → seleccionar todos.
      const todosSel = items.every((i) => next.has(i.voucher_id));
      if (todosSel) {
        for (const i of items) next.delete(i.voucher_id);
      } else {
        for (const i of items) next.add(i.voucher_id);
      }
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const bulkMut = useMutation({
    mutationFn: async (params: { ids: number[]; role: string }) =>
      apiClient.post<BulkApproveResponse>(
        "/vouchers/bulk-approve",
        { voucher_ids: params.ids, role: params.role },
        session,
      ),
    onSuccess: (resp) => {
      if (resp.failed === 0) {
        toast.success(
          `✓ Firmados ${resp.succeeded} vouchers como ${bulkSigningRole}`,
        );
      } else {
        toast.info(
          `${resp.succeeded} firmados · ${resp.failed} con error. Revisá la lista actualizada.`,
          { duration: 10000 },
        );
      }
      clearSelection();
      setBulkSigningRole(null);
      qc.invalidateQueries({ queryKey: ["vouchers", "mis-pendientes"] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo firmar en bulk",
        { duration: 8000 },
      );
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Cola de aprobaciones
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-900 flex items-center gap-2">
            <PenTool className="size-6 text-cehta-green" />
            Vouchers esperando tu firma
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Solo aparecen los vouchers donde sos el próximo aprobador. La
            cola se ordena por antigüedad — los más viejos primero.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="rounded-full bg-cehta-green/10 px-3 py-1 text-sm font-semibold text-cehta-green">
              {data.total} pendiente{data.total === 1 ? "" : "s"}
            </span>
          )}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-60"
            title="Refrescar"
          >
            <RefreshCw
              className={`size-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            Refrescar
          </button>
        </div>
      </header>

      {isLoading && (
        <Surface className="p-12 text-center text-ink-500">
          Cargando aprobaciones…
        </Surface>
      )}

      {isError && (
        <Surface className="p-6 bg-negative/5 border border-negative/20">
          <p className="text-sm text-negative">
            No pude cargar las aprobaciones. Reintentá en unos segundos.
          </p>
        </Surface>
      )}

      {!isLoading && data && data.total === 0 && (
        <Surface className="p-12 text-center">
          <CheckCircle2 className="mx-auto size-12 text-cehta-green" />
          <p className="mt-3 text-lg font-semibold text-ink-900">
            Sin pendientes
          </p>
          <p className="mt-1 text-sm text-ink-500">
            No tenés vouchers esperando tu firma. Buen trabajo.
          </p>
          <Link
            href={"/vouchers" as Route}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-cehta-green hover:underline"
          >
            <Inbox className="size-4" />
            Ver todos los vouchers
          </Link>
        </Surface>
      )}

      {grouped.length > 0 && (
        <div className="space-y-6">
          {grouped.map(([empresa, items]) => {
            const todosSel = items.every((i) => selectedIds.has(i.voucher_id));
            const algunoSel = items.some((i) => selectedIds.has(i.voucher_id));
            return (
              <section key={empresa} className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => selectAllInGroup(items)}
                      className="inline-flex items-center gap-1 text-ink-500 hover:text-cehta-green"
                      title={todosSel ? "Deseleccionar todos" : "Seleccionar todos del grupo"}
                      aria-label={todosSel ? "Deseleccionar todos" : "Seleccionar todos del grupo"}
                    >
                      {todosSel ? (
                        <CheckSquare className="size-4 text-cehta-green" />
                      ) : algunoSel ? (
                        <CheckSquare className="size-4 text-cehta-green/50" />
                      ) : (
                        <Square className="size-4" />
                      )}
                    </button>
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-700">
                      {empresa}
                      {items[0]?.empresa_razon_social && (
                        <span className="ml-2 font-normal text-ink-500 capitalize">
                          — {items[0].empresa_razon_social}
                        </span>
                      )}
                    </h2>
                  </div>
                  <span className="text-xs text-ink-500">
                    {items.length} pendiente{items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <VoucherApprovalCard
                      key={item.voucher_id}
                      item={item}
                      selected={selectedIds.has(item.voucher_id)}
                      onToggleSelect={() => toggleSelected(item.voucher_id)}
                      onSign={() => setSigningFor(item)}
                      onReject={() => setShowRejectFor(item)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* V5++ ola CJ — Barra flotante de bulk action.
          Aparece cuando hay seleccion. Permite firmar TODAS las
          seleccionadas con un click (si comparten el mismo rol). */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 transform">
          <Surface className="flex items-center gap-3 px-5 py-3 shadow-2xl border border-cehta-green/30 bg-white">
            <span className="text-sm font-medium text-ink-900">
              {selectedIds.size} voucher{selectedIds.size === 1 ? "" : "s"} seleccionado
              {selectedIds.size === 1 ? "" : "s"}
            </span>
            {!bulkRoleConsistente ? (
              <span className="text-xs text-amber-700">
                · Mezcla de roles ({selectedRoles.join(", ")}) — no se puede
                bulk
              </span>
            ) : (
              <span className="text-xs text-ink-500">
                · Firmar como{" "}
                <strong className="text-cehta-green">{selectedRoles[0]}</strong>
              </span>
            )}
            <div className="ml-2 flex items-center gap-2">
              <button
                type="button"
                onClick={clearSelection}
                className="text-xs text-ink-600 hover:text-ink-900"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!bulkRoleConsistente || bulkMut.isPending}
                onClick={() => {
                  if (!bulkRoleConsistente) return;
                  const firstRole = selectedRoles[0];
                  if (firstRole) setBulkSigningRole(firstRole);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-50"
              >
                <FileSignature className="size-4" />
                Firmar {selectedIds.size}
              </button>
            </div>
          </Surface>
        </div>
      )}

      {/* Modal de confirmación bulk */}
      {bulkSigningRole && selectedItems.length > 0 && (
        <BulkSignDialog
          items={selectedItems}
          role={bulkSigningRole}
          isPending={bulkMut.isPending}
          onClose={() => setBulkSigningRole(null)}
          onConfirm={() =>
            bulkMut.mutate({
              ids: Array.from(selectedIds),
              role: bulkSigningRole,
            })
          }
        />
      )}

      {signingFor && (
        <SignDialog
          item={signingFor}
          onClose={() => setSigningFor(null)}
          onSuccess={() => {
            setSigningFor(null);
            qc.invalidateQueries({ queryKey: ["vouchers", "mis-pendientes"] });
            qc.invalidateQueries({ queryKey: ["vouchers"] });
          }}
        />
      )}
      {showRejectFor && (
        <RejectDialog
          item={showRejectFor}
          onClose={() => setShowRejectFor(null)}
          onSuccess={() => {
            setShowRejectFor(null);
            qc.invalidateQueries({ queryKey: ["vouchers", "mis-pendientes"] });
            qc.invalidateQueries({ queryKey: ["vouchers"] });
          }}
        />
      )}
    </div>
  );
}

function VoucherApprovalCard({
  item,
  selected,
  onToggleSelect,
  onSign,
  onReject,
}: {
  item: MisPendientesItem;
  selected: boolean;
  onToggleSelect: () => void;
  onSign: () => void;
  onReject: () => void;
}) {
  return (
    <Surface
      className={`p-4 ${selected ? "ring-2 ring-cehta-green/40 bg-cehta-green/[0.02]" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {/* Checkbox bulk */}
          <button
            type="button"
            onClick={onToggleSelect}
            className="mt-0.5 shrink-0 text-ink-400 hover:text-cehta-green"
            aria-label={selected ? "Quitar de seleccion" : "Seleccionar para firma bulk"}
            title={selected ? "Quitar de seleccion" : "Seleccionar para firma bulk"}
          >
            {selected ? (
              <CheckSquare className="size-5 text-cehta-green" />
            ) : (
              <Square className="size-5" />
            )}
          </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <Link
              href={`/vouchers/${item.voucher_id}` as Route}
              className="font-mono text-sm font-semibold text-ink-900 hover:text-cehta-green hover:underline"
            >
              {item.codigo}
            </Link>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              {item.tipo}
            </span>
            {item.doc_tributario_folio && (
              <span className="text-xs text-ink-500">
                · folio{" "}
                <span className="font-mono">{item.doc_tributario_folio}</span>
              </span>
            )}
            {urgencyChip(item.dias_pendiente)}
            {item.reinforced && (
              <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-yellow-800">
                <Sparkles className="size-3" /> Reforzado
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-900">
            <span className="font-medium">
              {item.contraparte_nombre ?? "Sin proveedor"}
            </span>
            {item.contraparte_rut && (
              <span className="ml-1.5 font-mono text-xs text-ink-500">
                {item.contraparte_rut}
              </span>
            )}
          </p>
          {item.glosa && (
            <p className="mt-1 line-clamp-2 text-xs text-ink-600">
              {item.glosa}
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-ink-500">
            Fecha doc: <span className="font-mono">{fmtFecha(item.fecha_contable)}</span>
            {" · "}
            Creado por:{" "}
            <span className="text-ink-700">
              {item.creador_email ?? "—"}
            </span>
            {item.matched_rule_descripcion && (
              <>
                {" · "}
                <span className="italic">{item.matched_rule_descripcion}</span>
              </>
            )}
          </p>
        </div>
        </div>{/* cierre wrapper checkbox+info */}
        <div className="text-right shrink-0">
          <p className="font-mono text-lg font-semibold tabular-nums text-ink-900">
            {fmtMonto(item.total, item.moneda)}
          </p>
          <p className="text-[11px] text-ink-500">
            Firma {item.firmas_hechas + 1}/{item.firmas_totales} ·{" "}
            <span className="font-medium text-cehta-green">
              {item.rol_label}
            </span>
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-3">
        {item.primer_adjunto_dropbox_path && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-ink-500"
            title={item.primer_adjunto_dropbox_path}
          >
            <FileText className="size-3.5" />
            Adjunto disponible
          </span>
        )}
        <Link
          href={`/vouchers/${item.voucher_id}` as Route}
          className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
        >
          Ver detalle
        </Link>
        <button
          type="button"
          onClick={onReject}
          className="inline-flex items-center gap-1.5 rounded-xl border border-negative/20 bg-white px-3 py-1.5 text-xs font-medium text-negative hover:bg-negative/5"
        >
          <XCircle className="size-3.5" />
          Rechazar
        </button>
        <button
          type="button"
          onClick={onSign}
          className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-1.5 text-xs font-semibold text-white shadow-card hover:bg-cehta-green-700"
        >
          <FileSignature className="size-3.5" />
          Firmar como {item.mi_rol_para_firmar}
        </button>
      </div>
    </Surface>
  );
}

function BulkSignDialog({
  items,
  role,
  isPending,
  onClose,
  onConfirm,
}: {
  items: MisPendientesItem[];
  role: string;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const totalGeneral = items.reduce((sum, it) => sum + parseFloat(it.total || "0"), 0);
  const empresas = new Set(items.map((i) => i.empresa_codigo));
  const monedas = new Set(items.map((i) => i.moneda));

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
          <FileSignature className="size-3.5" />
          Confirmar firma en bulk
        </div>
        <p className="text-sm text-ink-700">
          Voy a firmar <strong>{items.length} voucher{items.length === 1 ? "" : "s"}</strong>{" "}
          como{" "}
          <strong className="text-cehta-green">{role}</strong>.
        </p>
        <div className="rounded-xl bg-ink-50 p-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-500">Total vouchers</span>
            <span className="font-mono font-semibold">{items.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-500">Empresas involucradas</span>
            <span className="font-medium">
              {Array.from(empresas).join(", ")}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-500">
              Suma total{monedas.size > 1 ? " (mixto)" : ""}
            </span>
            <span className="font-mono font-semibold">
              {monedas.size === 1 && monedas.has("CLP")
                ? `$${Math.round(totalGeneral).toLocaleString("es-CL")}`
                : `${totalGeneral.toLocaleString("es-CL")} (mixto)`}
            </span>
          </div>
        </div>
        {/* Lista compacta de vouchers para revisar */}
        <div className="max-h-64 overflow-y-auto rounded-xl border border-hairline">
          <table className="w-full text-xs">
            <thead className="bg-ink-50 text-ink-600">
              <tr>
                <th className="px-3 py-2 text-left">Voucher</th>
                <th className="px-3 py-2 text-left">Empresa</th>
                <th className="px-3 py-2 text-left">Proveedor</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {items.map((i) => (
                <tr key={i.voucher_id}>
                  <td className="px-3 py-1.5 font-mono">{i.codigo}</td>
                  <td className="px-3 py-1.5">{i.empresa_codigo}</td>
                  <td className="px-3 py-1.5 truncate max-w-[150px]">
                    {i.contraparte_nombre ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {fmtMonto(i.total, i.moneda)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-500">
          Cada firma queda con tu IP + timestamp + hash SHA-256. Si alguno
          tiene problemas (regla cambiada, ya firmado, etc.), seguirá con
          los siguientes — no se aborta el batch completo.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-5 py-2 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-60"
          >
            <FileSignature className="size-4" />
            {isPending ? `Firmando ${items.length}…` : `Confirmar ${items.length} firmas`}
          </button>
        </div>
      </div>
    </div>
  );
}

function SignDialog({
  item,
  onClose,
  onSuccess,
}: {
  item: MisPendientesItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { session } = useSession();
  const [comments, setComments] = useState("");
  const mut = useMutation({
    mutationFn: async () =>
      apiClient.post(
        `/vouchers/${item.voucher_id}/approve`,
        {
          role: item.mi_rol_para_firmar,
          comments: comments.trim() || undefined,
        },
        session,
      ),
    onSuccess: () => {
      toast.success(`Firmado ${item.codigo} como ${item.rol_label}`);
      onSuccess();
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.detail : "No se pudo firmar", {
        duration: 8000,
      }),
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
          <FileSignature className="size-3.5" />
          Confirmar firma
        </div>
        <div className="space-y-1">
          <p className="text-sm text-ink-700">
            Voy a firmar el voucher{" "}
            <span className="font-mono font-semibold">{item.codigo}</span>{" "}
            como{" "}
            <span className="font-semibold text-cehta-green">
              {item.rol_label}
            </span>
            .
          </p>
          <p className="text-xs text-ink-500">
            La firma queda registrada con tu IP, timestamp y un hash SHA-256
            que sirve de evidencia. No se puede revertir — para invalidar
            habría que anular el voucher (otro flujo).
          </p>
        </div>
        <div className="rounded-xl bg-ink-50 p-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-500">Proveedor</span>
            <span className="font-medium">
              {item.contraparte_nombre ?? "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-500">Total</span>
            <span className="font-mono font-semibold">
              {fmtMonto(item.total, item.moneda)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-500">Empresa</span>
            <span className="font-medium">{item.empresa_codigo}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-500">Tipo doc / Folio</span>
            <span className="font-mono text-xs">
              {item.doc_tributario_tipo ?? "—"}{" "}
              {item.doc_tributario_folio ?? ""}
            </span>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Comentarios (opcional)
          </label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Ej: Verificado contra orden de compra OC-2026-0123"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green resize-none"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={mut.isPending}
            className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            Cancelar
          </button>
          <Button
            type="submit"
            disabled={mut.isPending}
            className="inline-flex items-center gap-1.5 px-5"
          >
            <FileSignature className="size-4" />
            {mut.isPending ? "Firmando…" : "Confirmar firma"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function RejectDialog({
  item,
  onClose,
  onSuccess,
}: {
  item: MisPendientesItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { session } = useSession();
  const [reason, setReason] = useState("");
  const mut = useMutation({
    mutationFn: async () =>
      apiClient.post(
        `/vouchers/${item.voucher_id}/reject`,
        { reason: reason.trim() },
        session,
      ),
    onSuccess: () => {
      toast.success(`Voucher ${item.codigo} rechazado`);
      onSuccess();
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.detail : "Error", {
        duration: 8000,
      }),
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length < 10) {
            toast.error("La razón debe tener al menos 10 caracteres");
            return;
          }
          mut.mutate();
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-negative">
          <XCircle className="size-3.5" />
          Rechazar voucher {item.codigo}
        </div>
        <p className="text-sm text-ink-600">
          El voucher pasa a REJECTED. Para un nuevo intento, el operador
          debe crear un voucher distinto. La razón queda en el audit log.
        </p>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Razón (mín 10 caracteres)
            <span className="ml-0.5 text-negative">*</span>
          </label>
          <textarea
            required
            minLength={10}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Ej: Falta firma del proveedor en la factura adjunta"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-negative resize-none"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={mut.isPending}
            className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={mut.isPending || reason.trim().length < 10}
            className="inline-flex items-center gap-1.5 rounded-xl bg-negative px-4 py-2 text-sm font-semibold text-white hover:bg-negative/90 disabled:opacity-60"
          >
            <XCircle className="size-4" />
            {mut.isPending ? "Rechazando…" : "Rechazar"}
          </button>
        </div>
      </form>
    </div>
  );
}
