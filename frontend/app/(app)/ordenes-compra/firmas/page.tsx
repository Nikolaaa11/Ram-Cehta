"use client";

/**
 * Tablero de firmas — la matriz OC × firmante, por empresa.
 *
 * Lo que pidió Nicolás, literal: "un cuadro donde salgan en la línea
 * vertical las OC y en la horizontal firmada por... por empresa, ya que no
 * son tantos los que firman". Cada celda dice si esa persona firmó esa OC
 * (✓ con fecha), la tiene pendiente (reloj ámbar), la rechazó (✗), o no es
 * firmante de esa OC (—).
 *
 * El botón "Recordar por email" dispara los recordatorios YA (el cron los
 * manda solo cada ~44 h): un correo por persona con TODAS sus OC pendientes.
 */
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BellRing,
  Check,
  Clock,
  Loader2,
  PenLine,
  X,
} from "lucide-react";

import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { toCLP } from "@/lib/format";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";

interface Firmante {
  email: string;
  nombre: string;
  cargo: string | null;
  es_externo: boolean;
  sin_email: boolean;
}

interface Celda {
  status: "PENDIENTE" | "FIRMADA" | "RECHAZADA";
  signed_at: string | null;
}

interface OcFila {
  oc_id: number;
  numero_oc: string;
  estado: string;
  moneda: string | null;
  total: string | null;
  fecha_emision: string;
  proveedor: string | null;
  celdas: Record<string, Celda>;
  pendientes: string[];
}

interface Matriz {
  empresa_codigo: string;
  firmantes: Firmante[];
  ocs: OcFila[];
  resumen: { en_firma: number; con_pendientes: number; completas: number };
}

const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  emitida: "Emitida",
  en_firma: "En firma",
  firmada: "Firmada",
  enviada_proveedor: "Enviada",
  parcial: "Parcial",
  pagada: "Pagada",
};

export default function TableroFirmasPage() {
  const { session } = useSession();
  const { data: empresas = [] } = useCatalogoEmpresas();
  const queryClient = useQueryClient();
  const [empresa, setEmpresa] = useState("");
  const [recordando, setRecordando] = useState(false);

  const matriz = useQuery({
    queryKey: ["oc-firmas-matriz", empresa],
    queryFn: () =>
      apiClient.get<Matriz>(
        `/ordenes-compra/firmas-matriz?empresa_codigo=${encodeURIComponent(empresa)}`,
        session,
      ),
    enabled: !!session && !!empresa,
  });

  async function recordar() {
    setRecordando(true);
    try {
      const r = await apiClient.post<{
        enviados: number;
        firmantes: { email: string; ocs: string[] }[];
      }>(
        "/ordenes-compra/recordar-firmas",
        { empresa_codigo: empresa },
        session,
      );
      if (r.enviados === 0) {
        toast.success(
          "Nadie tiene recordatorios vencidos: los avisados hace menos de dos días no se re-spamean.",
        );
      } else {
        toast.success(
          `Recordatorio enviado a ${r.enviados} firmante(s): ` +
            r.firmantes.map((f) => f.email).join(", "),
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["oc-firmas-matriz"] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "No se pudo recordar");
    } finally {
      setRecordando(false);
    }
  }

  const m = matriz.data;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/ordenes-compra"
          className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Órdenes de compra
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink-900">
              <PenLine className="h-6 w-6 text-cehta-green" strokeWidth={1.75} />
              Tablero de firmas
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-500">
              Quién firmó y quién falta, OC por OC. Las que están en firma van
              primero.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div>
              <label
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500"
                htmlFor="tf-empresa"
              >
                Empresa
              </label>
              <select
                id="tf-empresa"
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
                className="rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink-900 focus:border-cehta-green focus:outline-none"
              >
                <option value="">Elegir…</option>
                {empresas.map((e) => (
                  <option key={e.codigo} value={e.codigo}>
                    {e.codigo}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={recordar}
              disabled={!empresa || recordando}
              title="Manda YA un correo a cada firmante con todas sus OC pendientes (el sistema igual recuerda solo cada 2 días)"
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-50"
            >
              {recordando ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
              ) : (
                <BellRing className="h-4 w-4" strokeWidth={1.75} />
              )}
              Recordar por email
            </button>
          </div>
        </div>
      </div>

      {!empresa ? (
        <p className="py-14 text-center text-sm text-ink-500">
          Elegí una empresa: los firmantes se repiten dentro de cada una y el
          cuadro queda angosto.
        </p>
      ) : matriz.isLoading ? (
        <Skeleton className="h-72 w-full rounded-2xl" />
      ) : !m || m.ocs.length === 0 ? (
        <p className="py-14 text-center text-sm text-ink-500">
          {empresa} no tiene órdenes de compra con firmantes asignados.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-lg bg-sf-purple/10 px-2.5 py-1 font-medium text-sf-purple">
              {m.resumen.en_firma} en firma
            </span>
            <span className="rounded-lg bg-warning/10 px-2.5 py-1 font-medium text-warning">
              {m.resumen.con_pendientes} con firmas pendientes
            </span>
            <span className="rounded-lg bg-cehta-green/10 px-2.5 py-1 font-medium text-cehta-green">
              {m.resumen.completas} completas
            </span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-hairline">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted">
                <tr>
                  <th className="sticky left-0 z-10 bg-surface-muted px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Orden de compra
                  </th>
                  {m.firmantes.map((f) => (
                    <th
                      key={f.email}
                      className="px-3 py-3 text-center text-xs font-semibold text-ink-700"
                      title={f.sin_email ? `${f.nombre} — firma en papel` : f.email}
                    >
                      <span className="block max-w-[9rem] truncate">
                        {f.nombre}
                      </span>
                      <span className="block text-[10px] font-normal uppercase tracking-wide text-ink-400">
                        {f.es_externo ? "Externo" : f.cargo || ""}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {m.ocs.map((oc) => (
                  <tr
                    key={oc.oc_id}
                    className={oc.estado === "en_firma" ? "bg-sf-purple/[0.03]" : ""}
                  >
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5">
                      <Link
                        href={`/ordenes-compra/${oc.oc_id}`}
                        className="font-medium text-ink-900 hover:text-cehta-green"
                      >
                        {oc.numero_oc}
                      </Link>
                      <p className="text-xs text-ink-500">
                        {oc.proveedor ?? "Sin proveedor"}
                        {oc.total ? ` · ${toCLP(oc.total)}` : ""}
                        {" · "}
                        <span
                          className={
                            oc.estado === "en_firma"
                              ? "font-medium text-sf-purple"
                              : ""
                          }
                        >
                          {ESTADO_LABEL[oc.estado] ?? oc.estado}
                        </span>
                      </p>
                    </td>
                    {m.firmantes.map((f) => {
                      const c = oc.celdas[f.email];
                      return (
                        <td key={f.email} className="px-3 py-2.5 text-center">
                          {!c ? (
                            <span className="text-ink-200">—</span>
                          ) : c.status === "FIRMADA" ? (
                            <span
                              className="inline-flex flex-col items-center text-cehta-green"
                              title={`Firmó el ${c.signed_at?.slice(0, 10) ?? ""}`}
                            >
                              <Check className="h-4 w-4" strokeWidth={2.5} />
                              <span className="text-[10px] tabular-nums text-ink-400">
                                {c.signed_at?.slice(0, 10) ?? ""}
                              </span>
                            </span>
                          ) : c.status === "RECHAZADA" ? (
                            <span
                              className="inline-flex items-center text-negative"
                              title="Rechazó la firma"
                            >
                              <X className="h-4 w-4" strokeWidth={2.5} />
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center text-warning"
                              title="Firma pendiente"
                            >
                              <Clock className="h-4 w-4" strokeWidth={2} />
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-ink-500">
            <Check className="mr-1 inline h-3.5 w-3.5 text-cehta-green" /> firmó
            · <Clock className="mx-1 inline h-3.5 w-3.5 text-warning" />
            pendiente · <X className="mx-1 inline h-3.5 w-3.5 text-negative" />
            rechazó · — no firma esa OC. El sistema además recuerda por email a
            cada pendiente cada dos días, solo.
          </p>
        </>
      )}
    </div>
  );
}
