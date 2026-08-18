"use client";

/**
 * Órdenes de compra eliminadas — la constancia de cada borrado.
 *
 * Desde que una OC se puede borrar SIEMPRE (incluso firmada), ésta es la
 * pantalla que hace que eso sea aceptable: cada borrado deja acá una copia
 * completa del documento, quién lo hizo, cuándo y por qué.
 *
 * El registro se escribe en la misma transacción que el DELETE, así que no
 * existe una OC borrada que no aparezca en esta lista.
 */
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileX2, PenLine, Wallet } from "lucide-react";

import { useApiQuery } from "@/hooks/use-api-query";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";

interface OcEliminada {
  eliminacion_id: number;
  oc_id: number;
  numero_oc: string;
  empresa_codigo: string;
  estado_previo: string;
  proveedor_nombre: string | null;
  proveedor_rut: string | null;
  fecha_emision: string | null;
  moneda: string | null;
  total: string | number | null;
  firmas_puestas: number;
  firmantes: string | null;
  vouchers_con_plata: number;
  voucher_ids: number[];
  motivo: string;
  eliminado_por_email: string | null;
  eliminado_el: string;
}

interface PageResp {
  items: OcEliminada[];
  total: number;
  limit: number;
  offset: number;
}

const POR_PAGINA = 25;

function fmtMonto(total: string | number | null, moneda: string | null) {
  if (total === null || total === undefined) return "—";
  const n = typeof total === "string" ? Number(total) : total;
  if (!Number.isFinite(n)) return "—";
  // La UF lleva decimales; el peso no.
  const conDecimales = (moneda ?? "CLP").toUpperCase() !== "CLP";
  return `${new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: conDecimales ? 2 : 0,
    maximumFractionDigits: conDecimales ? 2 : 0,
  }).format(n)} ${moneda ?? ""}`.trim();
}

function fmtFechaHora(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export default function OrdenesCompraEliminadasPage() {
  const [offset, setOffset] = useState(0);
  const { data, isLoading, error } = useApiQuery<PageResp>(
    ["oc-eliminadas", String(offset)],
    `/ordenes-compra/eliminadas?limit=${POR_PAGINA}&offset=${offset}`,
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

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
        <h1 className="mt-2 text-2xl font-semibold text-ink-900">
          Órdenes de compra eliminadas
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">
          Cada OC borrada deja acá una copia completa del documento —ítems,
          forma de pago, firmas y adjuntos— junto con quién la borró, cuándo y
          por qué. Este registro no se puede editar ni borrar.
        </p>
      </div>

      {isLoading ? (
        <Surface>
          <Surface.Body className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </Surface.Body>
        </Surface>
      ) : error ? (
        <Surface>
          <Surface.Body>
            <p className="text-sm text-negative">
              No se pudo cargar el registro de eliminaciones.
            </p>
          </Surface.Body>
        </Surface>
      ) : items.length === 0 ? (
        <Surface>
          <Surface.Body className="flex flex-col items-center gap-3 py-14 text-center">
            <FileX2 className="h-8 w-8 text-ink-300" strokeWidth={1.25} />
            <p className="text-sm font-medium text-ink-900">
              No se eliminó ninguna orden de compra
            </p>
            <p className="max-w-sm text-sm text-ink-500">
              Cuando alguien borre una OC, va a aparecer acá con su motivo y una
              copia completa del documento.
            </p>
          </Surface.Body>
        </Surface>
      ) : (
        <div className="space-y-3">
          {items.map((e) => (
            <Surface key={e.eliminacion_id}>
              <Surface.Body className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink-900">{e.numero_oc}</p>
                    <p className="text-sm text-ink-500">
                      {e.proveedor_nombre ?? "Sin proveedor"}
                      {e.proveedor_rut ? ` · ${e.proveedor_rut}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-ink-900">
                      {fmtMonto(e.total, e.moneda)}
                    </p>
                    <p className="text-xs uppercase tracking-wide text-ink-300">
                      {e.empresa_codigo} · estaba {e.estado_previo}
                    </p>
                  </div>
                </div>

                {/* Las dos señales que hacen que un borrado importe o no. Se
                    muestran sólo cuando son > 0: un contador en cero no es una
                    advertencia, es el caso normal. */}
                {(e.firmas_puestas > 0 || e.vouchers_con_plata > 0) && (
                  <div className="flex flex-wrap gap-2">
                    {e.firmas_puestas > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-negative/10 px-2.5 py-1 text-xs font-medium text-negative ring-1 ring-negative/20">
                        <PenLine className="h-3.5 w-3.5" strokeWidth={1.5} />
                        Estaba firmada
                        {e.firmantes ? ` por ${e.firmantes}` : ""}
                      </span>
                    )}
                    {e.vouchers_con_plata > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning ring-1 ring-warning/20">
                        <Wallet className="h-3.5 w-3.5" strokeWidth={1.5} />
                        {e.vouchers_con_plata} pago(s) ya aprobados
                        {e.voucher_ids.length > 0
                          ? ` · vouchers ${e.voucher_ids.join(", ")}`
                          : ""}
                      </span>
                    )}
                  </div>
                )}

                <div className="rounded-xl border border-hairline bg-surface-muted px-3 py-2.5">
                  <p className="text-xs uppercase tracking-wide text-ink-300">
                    Motivo
                  </p>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-ink-900">
                    {e.motivo}
                  </p>
                </div>

                <p className="text-xs text-ink-500">
                  Eliminada por{" "}
                  <span className="text-ink-900">
                    {e.eliminado_por_email ?? "usuario desconocido"}
                  </span>{" "}
                  el {fmtFechaHora(e.eliminado_el)}
                </p>
              </Surface.Body>
            </Surface>
          ))}

          {total > POR_PAGINA && (
            <div className="flex items-center justify-between pt-1">
              <p className="text-sm text-ink-500">
                {offset + 1}–{Math.min(offset + POR_PAGINA, total)} de {total}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOffset(Math.max(0, offset - POR_PAGINA))}
                  disabled={offset === 0}
                  className="rounded-xl px-3 py-1.5 text-sm text-ink-700 border border-hairline transition-colors hover:bg-surface-muted disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() => setOffset(offset + POR_PAGINA)}
                  disabled={offset + POR_PAGINA >= total}
                  className="rounded-xl px-3 py-1.5 text-sm text-ink-700 border border-hairline transition-colors hover:bg-surface-muted disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
