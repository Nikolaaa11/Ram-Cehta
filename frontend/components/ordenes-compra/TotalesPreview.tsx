"use client";

/**
 * Los totales de la OC, calculados con la MISMA regla que el servidor.
 *
 * Antes cada pantalla los calculaba a su manera —`moneda === "CLP" ? neto *
 * 0.19 : 0`— y una OC en UF mostraba IVA 0 y salía con 19 % en el PDF. Acá se
 * usa `calcularTotalesOC`, que está atado al backend por un snapshot que
 * verifican las dos suites.
 *
 * También muestra el aviso de conciliación: cuando el documento que leyó la
 * IA dice un neto distinto al que suman sus líneas, hay que decirlo. No se
 * elige por el operador — se le muestran los dos números.
 */
import { AlertTriangle } from "lucide-react";

import {
  calcularTotalesOC,
  decimalesDeMoneda,
  sumarItemizado,
} from "@/lib/oc/totales";

export interface ConciliacionIA {
  neto_documento?: string | null;
  neto_items?: string;
  difieren?: boolean;
  diferencia?: string;
  lineas_descuadradas?: { item: string; descripcion: string; documento: string; calculado: string }[];
}

interface Props {
  items: readonly { cantidad: string; precio_unitario: string }[];
  moneda: string;
  tipoDocumento: string;
  ivaPorcentaje: string;
  retencionPorcentaje: string;
  /** Sólo en las pantallas de IA: qué decía el documento original. */
  conciliacion?: ConciliacionIA | null;
}

function fmt(valor: string, moneda: string): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor;
  const d = decimalesDeMoneda(moneda);
  const num = new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
  return moneda === "CLP" ? `$${num}` : `${num} ${moneda}`;
}

export function TotalesPreview({
  items,
  moneda,
  tipoDocumento,
  ivaPorcentaje,
  retencionPorcentaje,
  conciliacion,
}: Props) {
  const neto = sumarItemizado(items);
  const t = calcularTotalesOC({
    neto,
    moneda,
    tipoDocumento,
    ivaPorcentaje,
    retencionPorcentaje,
  });

  const esHonorarios = tipoDocumento === "HONORARIOS";
  // `!== "0"` sobre el texto exacto y no `Number(...) > 0`: un IVA de 0 puesto
  // a propósito tiene que verse como fila en 0, no desaparecer.
  const muestraIva = t.ivaPorcentaje !== "0" || t.iva !== "0";

  const descuadre =
    conciliacion?.difieren && conciliacion.neto_documento
      ? conciliacion
      : null;
  const lineasMal = conciliacion?.lineas_descuadradas ?? [];

  return (
    <div className="space-y-3">
      {descuadre && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            El documento y sus líneas no cuadran
          </p>
          <p className="mt-1 text-xs text-ink-700">
            El documento dice un neto de{" "}
            <span className="font-medium tabular-nums">
              {fmt(descuadre.neto_documento!, moneda)}
            </span>{" "}
            y las líneas de acá abajo suman{" "}
            <span className="font-medium tabular-nums">
              {fmt(descuadre.neto_items ?? "0", moneda)}
            </span>{" "}
            — una diferencia de{" "}
            <span className="font-medium tabular-nums">
              {fmt(descuadre.diferencia ?? "0", moneda)}
            </span>
            . Puede faltar una línea o haberse leído mal un precio. La OC se va
            a crear por lo que sumen las líneas: revisalas antes de confirmar.
          </p>
        </div>
      )}

      {lineasMal.length > 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {lineasMal.length === 1
              ? "Una línea no cuadra con su total"
              : `${lineasMal.length} líneas no cuadran con su total`}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-700">
            {lineasMal.map((l) => (
              <li key={l.item}>
                Ítem {l.item} ({l.descripcion}): el documento dice{" "}
                <span className="tabular-nums">{fmt(l.documento, moneda)}</span>{" "}
                pero cantidad × precio da{" "}
                <span className="tabular-nums">{fmt(l.calculado, moneda)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-hairline bg-surface-muted px-4 py-3">
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="text-ink-500">
            {esHonorarios ? "Honorarios brutos" : "Neto"}
          </span>
          <span className="font-medium tabular-nums text-ink-900">
            {fmt(t.neto, moneda)}
          </span>
        </div>

        {muestraIva && (
          <div className="mt-1 flex items-baseline justify-between gap-4 text-sm">
            <span className="text-ink-500">IVA {t.ivaPorcentaje}%</span>
            <span className="font-medium tabular-nums text-ink-900">
              {fmt(t.iva, moneda)}
            </span>
          </div>
        )}

        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-hairline pt-2">
          <span className="text-sm font-medium text-ink-900">
            {esHonorarios ? "Total bruto" : "Total"}
          </span>
          <span className="font-semibold tabular-nums text-ink-900">
            {fmt(t.total, moneda)}
          </span>
        </div>

        {esHonorarios && (
          <>
            <div className="mt-1 flex items-baseline justify-between gap-4 text-sm">
              <span className="text-ink-500">
                Retención {t.retencionPorcentaje}%
              </span>
              <span className="font-medium tabular-nums text-negative">
                −{fmt(t.retencionMonto, moneda)}
              </span>
            </div>
            {/* El líquido es el protagonista en honorarios: es la plata que
                efectivamente se transfiere al profesional. El total bruto es
                lo que se compromete, e incluye lo que se entera al SII. */}
            <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-hairline pt-2">
              <span className="text-sm font-medium text-ink-900">
                Líquido a pagar
              </span>
              <span className="font-semibold tabular-nums text-cehta-green">
                {fmt(t.totalAPagar, moneda)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
