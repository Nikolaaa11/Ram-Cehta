"use client";

/**
 * R152yyy — Sección de cuotas para el detalle de OC.
 *
 * Permite al operador:
 *   - Ver cuotas existentes (estado, voucher asociado, vencimiento)
 *   - Hacer split equitativo (N cuotas iguales, primer vencimiento, frecuencia)
 *   - Editar cuotas custom (drag-free, simple form por cuota)
 *   - Generar vouchers DRAFT por cada cuota PENDIENTE
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Calendar,
  Wallet,
  Split,
  FileText,
  AlertCircle,
  CheckCircle2,
  Plus,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";

interface Cuota {
  cuota_id: number;
  oc_id: number;
  numero_cuota: number;
  monto: string;
  fecha_vencimiento: string;
  descripcion: string | null;
  estado: string;
  voucher_id: number | null;
  voucher_codigo: string | null;
  voucher_status: string | null;
  dias_a_vencer: number | null;
}

const fmtCLP = (v: string | number) => {
  const n = typeof v === "string" ? Number(v) : v;
  return `$${n.toLocaleString("es-CL")}`;
};

const fmtDate = (d: string) => {
  const dt = new Date(d);
  return dt.toLocaleDateString("es-CL", {
    year: "numeric", month: "short", day: "numeric",
  });
};

const ESTADO_COLOR: Record<string, string> = {
  PENDIENTE: "bg-amber-100 text-amber-800 ring-amber-200",
  VOUCHER_GENERADO: "bg-blue-100 text-blue-800 ring-blue-200",
  PAGADA: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  ANULADA: "bg-red-100 text-red-800 ring-red-200",
};

export function OcCuotasSection({
  ocId,
  totalOc,
}: {
  ocId: number;
  totalOc: number;
}) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [showSplit, setShowSplit] = useState(false);
  const [cantidad, setCantidad] = useState(3);
  const [primerVenc, setPrimerVenc] = useState<string>(
    new Date(Date.now() + 30 * 86400_000).toISOString().split("T")[0] ?? "",
  );
  const [diasEntre, setDiasEntre] = useState(30);

  const cuotas = useQuery<Cuota[]>({
    queryKey: ["oc-cuotas", ocId],
    queryFn: () =>
      apiClient.get<Cuota[]>(`/ordenes-compra/${ocId}/cuotas`, session),
    enabled: !!session,
  });

  const splitMut = useMutation({
    mutationFn: async () =>
      apiClient.post<Cuota[]>(
        `/ordenes-compra/${ocId}/cuotas/split-equitativo`,
        {
          cantidad,
          primer_vencimiento: primerVenc,
          dias_entre_cuotas: diasEntre,
        },
        session,
      ),
    onSuccess: () => {
      toast.success(`Cuotas creadas (${cantidad}). Revisalas y generá los vouchers.`);
      qc.invalidateQueries({ queryKey: ["oc-cuotas", ocId] });
      setShowSplit(false);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof ApiError ? e.detail : "Error split"),
  });

  const generarMut = useMutation({
    mutationFn: async () =>
      apiClient.post<{
        cuotas_procesadas: number;
        vouchers_creados: number;
        vouchers_codigos: string[];
      }>(
        `/ordenes-compra/${ocId}/cuotas/generar-vouchers`,
        {},
        session,
      ),
    onSuccess: (data) => {
      if (data.vouchers_creados === 0) {
        toast.info("No había cuotas pendientes. Todos los vouchers ya existen.");
      } else {
        toast.success(
          `${data.vouchers_creados} vouchers DRAFT creados: ${data.vouchers_codigos.join(", ")}. Editalos en /vouchers para imputar.`,
          { duration: 12_000 },
        );
      }
      qc.invalidateQueries({ queryKey: ["oc-cuotas", ocId] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof ApiError ? e.detail : "Error generar"),
  });

  const suma = (cuotas.data ?? []).reduce(
    (acc, c) => acc + Number(c.monto || 0),
    0,
  );
  const balance = totalOc - suma;
  const pendientes = (cuotas.data ?? []).filter((c) => c.estado === "PENDIENTE");
  const generados = (cuotas.data ?? []).filter(
    (c) => c.estado === "VOUCHER_GENERADO" || c.estado === "PAGADA",
  );

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink-900 flex items-center gap-2">
            <Split className="h-5 w-5 text-cehta-green" strokeWidth={1.5} />
            Cuotas y vouchers
          </h2>
          <p className="text-xs text-ink-500 mt-1">
            Dividí el pago en N cuotas. Cada cuota genera un voucher DRAFT.
          </p>
        </div>
        <div className="flex gap-2">
          {!showSplit && (
            <button
              onClick={() => setShowSplit(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-ink-50 px-3 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline hover:bg-ink-100"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              Split equitativo
            </button>
          )}
          {pendientes.length > 0 && (
            <button
              onClick={() => generarMut.mutate()}
              disabled={generarMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-2 text-sm font-semibold text-white hover:bg-cehta-green/90 disabled:opacity-50"
            >
              <FileText className="h-4 w-4" strokeWidth={2} />
              {generarMut.isPending
                ? "Generando…"
                : `Generar ${pendientes.length} voucher${pendientes.length === 1 ? "" : "s"} DRAFT`}
            </button>
          )}
        </div>
      </div>

      {/* Split form */}
      {showSplit && (
        <div className="rounded-2xl border border-cehta-green/30 bg-cehta-green/5 p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-cehta-green">
              Dividir en cuotas iguales
            </h3>
            <button
              onClick={() => setShowSplit(false)}
              className="text-xs text-ink-500 hover:text-ink-900"
            >
              Cancelar
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Cantidad cuotas">
              <input
                type="number"
                min={1}
                max={24}
                value={cantidad}
                onChange={(e) => setCantidad(Number(e.target.value))}
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </Field>
            <Field label="Primer vencimiento">
              <input
                type="date"
                value={primerVenc}
                onChange={(e) => setPrimerVenc(e.target.value)}
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </Field>
            <Field label="Días entre cuotas">
              <input
                type="number"
                min={1}
                max={180}
                value={diasEntre}
                onChange={(e) => setDiasEntre(Number(e.target.value))}
                className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </Field>
          </div>
          <div className="text-xs text-ink-600 bg-white/60 rounded-lg p-2">
            <strong>Preview:</strong> {cantidad} cuotas de ~{fmtCLP(Math.floor(totalOc / cantidad))} cada una.
            Última absorbe redondeo. Vencimientos: {fmtDate(primerVenc)}, +{diasEntre}d…
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => splitMut.mutate()}
              disabled={splitMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white hover:bg-cehta-green/90 disabled:opacity-50"
            >
              {splitMut.isPending ? "Creando…" : "Crear cuotas"}
            </button>
          </div>
        </div>
      )}

      {/* Balance warning */}
      {(cuotas.data?.length ?? 0) > 0 && Math.abs(balance) > 1 && (
        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 p-3 text-xs text-amber-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" strokeWidth={2} />
          <div>
            <strong>Desbalance detectado:</strong> suma de cuotas {fmtCLP(suma)}{" "}
            vs total OC {fmtCLP(totalOc)}{" "}
            (diferencia {fmtCLP(balance)}). Ajustá las cuotas para que sumen el total exacto.
          </div>
        </div>
      )}

      {/* Lista */}
      {cuotas.isLoading ? (
        <div className="rounded-2xl bg-ink-50/40 p-8 text-center text-sm text-ink-500">
          Cargando cuotas…
        </div>
      ) : (cuotas.data?.length ?? 0) === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-hairline bg-ink-50/30 p-8 text-center">
          <Calendar className="mx-auto h-10 w-10 text-ink-300" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-ink-500">
            Esta OC no está dividida en cuotas. Haz split equitativo arriba para
            generar el desglose.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              <tr>
                <th className="px-4 py-2">N°</th>
                <th className="px-4 py-2">Vencimiento</th>
                <th className="px-4 py-2">Descripción</th>
                <th className="px-4 py-2 text-right">Monto</th>
                <th className="px-4 py-2">Estado</th>
                <th className="px-4 py-2">Voucher</th>
              </tr>
            </thead>
            <tbody>
              {(cuotas.data ?? []).map((c) => {
                const vencida =
                  c.dias_a_vencer !== null && c.dias_a_vencer < 0
                  && c.estado === "PENDIENTE";
                return (
                  <tr key={c.cuota_id} className="border-t border-hairline/50">
                    <td className="px-4 py-2 tabular-nums font-medium">
                      {c.numero_cuota}
                    </td>
                    <td className="px-4 py-2">
                      <div className={vencida ? "text-red-700 font-medium" : ""}>
                        {fmtDate(c.fecha_vencimiento)}
                      </div>
                      {c.dias_a_vencer !== null && c.estado === "PENDIENTE" && (
                        <div className="text-[11px] text-ink-500">
                          {c.dias_a_vencer < 0
                            ? `vencida hace ${Math.abs(c.dias_a_vencer)} días`
                            : c.dias_a_vencer === 0
                              ? "vence hoy"
                              : `en ${c.dias_a_vencer} días`}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-ink-600">{c.descripcion ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fmtCLP(c.monto)}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ${
                          ESTADO_COLOR[c.estado] ??
                          "bg-ink-100 text-ink-700 ring-ink-200"
                        }`}
                      >
                        {c.estado}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {c.voucher_id ? (
                        <Link
                          href={`/vouchers/${c.voucher_id}`}
                          className="inline-flex items-center gap-1 text-xs text-cehta-green underline"
                        >
                          {c.voucher_codigo ?? `#${c.voucher_id}`}
                          {c.voucher_status && (
                            <span className="text-ink-500 normal-case">
                              ({c.voucher_status})
                            </span>
                          )}
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-ink-50/40 font-semibold">
                <td className="px-4 py-2" colSpan={3}>
                  Suma
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmtCLP(suma)}
                </td>
                <td className="px-4 py-2 text-xs text-ink-500" colSpan={2}>
                  Total OC: {fmtCLP(totalOc)} ·{" "}
                  {generados.length}/{cuotas.data?.length ?? 0} con voucher
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {generados.length > 0 && (
        <p className="text-xs text-ink-500 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} />
          {generados.length} cuota{generados.length === 1 ? "" : "s"} ya{" "}
          {generados.length === 1 ? "tiene" : "tienen"} voucher DRAFT. Editalo
          desde el link de la columna Voucher para imputar a cuentas + área.
        </p>
      )}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
