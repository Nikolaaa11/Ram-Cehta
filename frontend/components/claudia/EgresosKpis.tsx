"use client";

/**
 * EgresosKpis — los números del mes: total, por fuente, % pagado, y la
 * barra apilada de quién paga qué.
 *
 * Con un mes seleccionado los datos vienen de `GET /claudia/egresos/resumen`
 * (`kpisDesdeResumen`); con "Todos" se agregan las filas cargadas
 * (`kpisDesdeItems`). Las dos van a la misma forma en centavos enteros.
 *
 * Un mes vacío NO muestra ceros en verde: el padre renderiza el vacío
 * honesto y este componente ni aparece (acceptance §6).
 */
import { AnimatedNumber } from "@/components/charts/lazy";
import { SkeletonStat } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toCLP } from "@/lib/format";
import {
  centavosAPesos,
  decimalACentavos,
  ETIQUETAS,
  FUENTES,
  repartoDesdeApi,
} from "@/lib/claudia/reparto";
import type { EgresoRead, Fuente, ResumenResponse } from "@/lib/claudia/types";
import { FUENTE_CLASES, RAYADO_STYLE } from "./RepartoEditor";

export interface KpisData {
  n: number;
  /** Centavos. */
  total: number;
  porFuente: Record<Fuente, number>;
  /** Total de los gastos SIN_CLASIFICAR, en centavos. */
  sinClasificar: number;
  /** 0..100, o null si no hay nada que medir. */
  pctPagado: number | null;
  nPagados: number;
  nDescuadrados: number;
  nSinClasificar: number;
}

export function kpisDesdeResumen(r: ResumenResponse): KpisData {
  const porFuente = {} as Record<Fuente, number>;
  for (const f of FUENTES) porFuente[f] = decimalACentavos(r.por_fuente[f]) ?? 0;
  const total = decimalACentavos(r.total) ?? 0;
  const pagadoMonto = decimalACentavos(r.por_estado.PAGADO?.monto) ?? 0;
  const pctApi =
    r.pct_pagado === null || r.pct_pagado === undefined ? null : Number(r.pct_pagado);
  return {
    n: r.n,
    total,
    porFuente,
    sinClasificar: decimalACentavos(r.por_fuente.sin_clasificar) ?? 0,
    pctPagado:
      r.n === 0
        ? null
        : pctApi !== null && Number.isFinite(pctApi)
          ? pctApi
          : total > 0
            ? (pagadoMonto / total) * 100
            : null,
    nPagados: r.por_estado.PAGADO?.n ?? 0,
    nDescuadrados: r.descuadrados,
    nSinClasificar: r.sin_clasificar,
  };
}

export function kpisDesdeItems(items: EgresoRead[]): KpisData {
  const porFuente = {} as Record<Fuente, number>;
  for (const f of FUENTES) porFuente[f] = 0;
  let total = 0;
  let sinClasificar = 0;
  let pagado = 0;
  let nPagados = 0;
  let nDescuadrados = 0;
  let nSinClasificar = 0;
  for (const it of items) {
    const t = decimalACentavos(it.total) ?? 0;
    total += t;
    if (it.estado_pago === "PAGADO") {
      pagado += t;
      nPagados += 1;
    }
    if (it.reparto_estado === "SIN_CLASIFICAR") {
      sinClasificar += t;
      nSinClasificar += 1;
    } else {
      if (it.reparto_estado === "DESCUADRADO") nDescuadrados += 1;
      const r = repartoDesdeApi(it.reparto);
      for (const f of FUENTES) porFuente[f] += r[f] ?? 0;
    }
  }
  return {
    n: items.length,
    total,
    porFuente,
    sinClasificar,
    pctPagado: items.length === 0 ? null : total > 0 ? (pagado / total) * 100 : null,
    nPagados,
    nDescuadrados,
    nSinClasificar,
  };
}

interface Props {
  data: KpisData | null;
  loading: boolean;
  mostrarTrewaox: boolean;
}

export function EgresosKpis({ data, loading, mostrarTrewaox }: Props) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonStat key={i} className="h-[112px]" />
        ))}
      </div>
    );
  }

  const fuentes = FUENTES.filter((f) => f !== "trewaox" || mostrarTrewaox || data.porFuente.trewaox > 0);
  const base = Math.max(data.total, 1);
  const segmentos = [
    ...fuentes.map((f) => ({
      key: f as string,
      label: ETIQUETAS[f],
      valor: data.porFuente[f],
      clase: FUENTE_CLASES[f].bar,
      rayado: false,
    })),
    {
      key: "sin_clasificar",
      label: "Sin clasificar",
      valor: data.sinClasificar,
      clase: "bg-warning/15 text-warning",
      rayado: true,
    },
  ].filter((s) => s.valor > 0);

  return (
    <section aria-label="Indicadores del período" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Kpi
          label="Total egresos"
          sub={`${data.n} ${data.n === 1 ? "gasto" : "gastos"}`}
          value={<AnimatedNumber value={centavosAPesos(data.total)} format="clp" />}
        />
        {fuentes.map((f) => (
          <Kpi
            key={f}
            label={ETIQUETAS[f]}
            dot={FUENTE_CLASES[f].dot}
            sub={
              data.total > 0
                ? `${((data.porFuente[f] / data.total) * 100).toFixed(1).replace(".", ",")} %`
                : undefined
            }
            value={<AnimatedNumber value={centavosAPesos(data.porFuente[f])} format="clp" />}
          />
        ))}
        <Kpi
          label="Pagado"
          sub={`${data.nPagados} de ${data.n}`}
          tone={data.pctPagado !== null && data.pctPagado >= 99.995 ? "positive" : "default"}
          value={
            data.pctPagado === null ? (
              <span className="text-ink-500">—</span>
            ) : (
              <AnimatedNumber value={data.pctPagado} format="pct" decimals={0} />
            )
          }
        />
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-hairline">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-ink-100/60" aria-hidden>
          {segmentos.map((s) => (
            <div
              key={s.key}
              className={cn("h-full transition-all duration-300", s.clase)}
              style={{ width: `${(s.valor / base) * 100}%` }}
              title={`${s.label}: ${toCLP(centavosAPesos(s.valor))}`}
            >
              {s.rayado && <div className="h-full w-full opacity-70" style={RAYADO_STYLE} />}
            </div>
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-500">
          {segmentos.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span
                className={cn("inline-block size-2 rounded-full", s.rayado ? "bg-warning" : s.clase)}
                aria-hidden
              />
              <span>{s.label}</span>
              <span className="tabular-nums text-ink-700">{toCLP(centavosAPesos(s.valor))}</span>
            </li>
          ))}
          {(data.nDescuadrados > 0 || data.nSinClasificar > 0) && (
            // Contraste AA: el texto en tinta y el ámbar sólo en el punto.
            <li className="ml-auto inline-flex items-center gap-1.5 font-medium text-ink-700">
              <span className="inline-block size-1.5 rounded-full bg-warning" aria-hidden />
              {data.nSinClasificar > 0 && `${data.nSinClasificar} sin clasificar`}
              {data.nSinClasificar > 0 && data.nDescuadrados > 0 && " · "}
              {data.nDescuadrados > 0 && `${data.nDescuadrados} descuadrados`}
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

function Kpi({
  label,
  sub,
  value,
  dot,
  tone = "default",
}: {
  label: string;
  sub?: string;
  value: React.ReactNode;
  dot?: string;
  tone?: "default" | "positive";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white p-4 shadow-card ring-1 transition-shadow duration-200 hover:shadow-card-hover",
        tone === "positive" ? "ring-positive/30" : "ring-hairline",
      )}
    >
      <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {dot && <span className={cn("size-2 rounded-full", dot)} aria-hidden />}
        {label}
      </p>
      <p className="mt-2 truncate font-display text-2xl font-semibold tracking-tight text-ink-900 tabular-nums">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-ink-500 tabular-nums">{sub}</p>}
    </div>
  );
}
