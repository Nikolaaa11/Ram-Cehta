"use client";

/**
 * /admin/subsidios/[codigo] — Round 89 — Bloque G5
 *
 * Dashboard visual del subsidio CORFO. Responde directamente al pedido
 * del operador en las pizarras de Claudia:
 *
 *   "Yo tengo que saber en donde están las platas asignadas para cada uno"
 *
 * Muestra:
 *   - Header con monto total del subsidio + barra de progreso ejecutado
 *   - Por cada empresa coejecutora: card con presupuesto, ejecutado por
 *     fuente (CORFO / P-tec / Empresa directa) y total
 *   - Cantidad de vouchers ejecutados por empresa
 *   - Lista de proyectos de cada empresa
 */
import { use, useMemo } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  TrendingUp,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import type { SubsidioRead, SubsidioEjecucion } from "@/lib/api/schema";

const fmtCLP = (n: number) =>
  `$${Math.round(n).toLocaleString("es-CL")}`;
const fmtPct = (n: number) =>
  `${n.toFixed(1)}%`;

export default function SubsidioDashboardPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = use(params);
  const { session } = useSession();

  const { data: subsidio, isLoading: l1 } = useQuery<SubsidioRead>({
    queryKey: ["subsidio", codigo],
    queryFn: () =>
      apiClient.get<SubsidioRead>(`/subsidios/${codigo}`, session),
    enabled: !!session,
  });
  const { data: ej, isLoading: l2 } = useQuery<SubsidioEjecucion>({
    queryKey: ["subsidio-ejecucion", codigo],
    queryFn: () =>
      apiClient.get<SubsidioEjecucion>(
        `/subsidios/${codigo}/ejecucion`,
        session,
      ),
    enabled: !!session,
  });

  const coejecutoresOrdenados = useMemo(() => {
    if (!ej) return [];
    return [...ej.coejecutores].sort((a, b) =>
      Number(b.ejecutado_total) - Number(a.ejecutado_total),
    );
  }, [ej]);

  if (l1 || l2 || !subsidio || !ej) {
    return (
      <div className="mx-auto max-w-[1280px] px-6 py-8 space-y-6">
        <Skeleton className="h-32 w-full rounded-3xl" />
        <Skeleton className="h-48 w-full rounded-3xl" />
        <Skeleton className="h-48 w-full rounded-3xl" />
      </div>
    );
  }

  const totalEjec = Number(ej.ejecutado_total);
  const totalMonto = Number(subsidio.monto_total);
  const pctEjec = ej.porcentaje_ejecutado;

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-8 space-y-6">
      <Link
        href={"/vouchers" as Route}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-cehta-green"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver
      </Link>

      {/* Header — Round 95: aplicado patron hero con grid + glow brand. */}
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
            <CircleDollarSign className="size-3.5 text-cehta-green" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Subsidio · {subsidio.programa}
            </p>
          </div>
          <h1 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight bg-gradient-to-br from-ink-900 via-ink-700 to-cehta-green bg-clip-text text-transparent">
            {subsidio.nombre}
          </h1>
          <p className="mt-2 text-sm md:text-base text-ink-500">
            {subsidio.entidad_otorgante} · Vigencia{" "}
            <strong>{subsidio.fecha_inicio} → {subsidio.fecha_termino}</strong>{" "}
            · Estado <strong>{subsidio.estado}</strong>
          </p>
          {subsidio.notas && (
            <p className="mt-2 text-[11px] italic text-ink-500 max-w-2xl">
              {subsidio.notas}
            </p>
          )}

          {/* KPIs */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            <Kpi
              label="Monto total"
              value={fmtCLP(totalMonto)}
              hint="Asignado por el otorgante"
            />
            <Kpi
              label="Presupuesto asignado"
              value={fmtCLP(Number(ej.presupuesto_total_asignado))}
              hint={`En ${ej.coejecutores.length} coejecutor${ej.coejecutores.length === 1 ? "" : "es"}`}
              tone="blue"
            />
            <Kpi
              label="Ejecutado"
              value={fmtCLP(totalEjec)}
              hint={`${fmtPct(pctEjec)} del monto total`}
              tone="cehta"
            />
            <Kpi
              label="Disponible"
              value={fmtCLP(Number(ej.disponible_total))}
              hint="Saldo por ejecutar"
              tone="amber"
            />
          </div>

          {/* Progress bar global */}
          <div className="mt-6">
            <div className="flex items-center justify-between text-xs text-ink-500 mb-1">
              <span>Ejecución global del subsidio</span>
              <span className="font-semibold text-ink-700 tabular-nums">
                {fmtPct(pctEjec)}
              </span>
            </div>
            <div className="relative h-3 overflow-hidden rounded-full bg-ink-100">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-cehta-green-700 via-cehta-green to-positive transition-all duration-500"
                style={{ width: `${Math.min(pctEjec, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Coejecutores */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="size-5 text-cehta-green" />
          <h2 className="text-xl font-semibold text-ink-900">
            Coejecutores ({ej.coejecutores.length})
          </h2>
        </div>

        {ej.coejecutores.length === 0 ? (
          <Surface className="p-12 text-center">
            <p className="text-ink-500">
              No hay empresas coejecutoras vinculadas a este subsidio aún.
            </p>
          </Surface>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {coejecutoresOrdenados.map((c) => (
              <CoejecutorCard key={c.empresa_codigo} c={c} totalMonto={totalMonto} />
            ))}
          </div>
        )}
      </div>

      {/* Footer con desglose por fuente sumado */}
      <Surface className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="size-5 text-cehta-green" />
          <h2 className="text-lg font-semibold text-ink-900">
            Ejecución total por fuente
          </h2>
        </div>
        <p className="text-xs text-ink-500 mb-4">
          Suma agregada de los {ej.coejecutores.length} coejecutores.
          Solo cuenta vouchers ya aprobados/ejecutados (no DRAFT ni PENDING).
        </p>
        {(() => {
          const sum = ej.coejecutores.reduce(
            (acc, c) => ({
              corfo: acc.corfo + Number(c.ejecutado_corfo),
              ptec: acc.ptec + Number(c.ejecutado_ptec),
              empresa: acc.empresa + Number(c.ejecutado_empresa_directa),
            }),
            { corfo: 0, ptec: 0, empresa: 0 },
          );
          const total = sum.corfo + sum.ptec + sum.empresa;
          return (
            <div className="space-y-3">
              <FuenteBar
                label="CORFO (pozo del subsidio)"
                value={sum.corfo}
                total={total}
                color="bg-cehta-green"
              />
              <FuenteBar
                label="P-tec (CEHTA Capital aporte pecuniario)"
                value={sum.ptec}
                total={total}
                color="bg-blue-500"
              />
              <FuenteBar
                label="Empresa directa"
                value={sum.empresa}
                total={total}
                color="bg-ink-500"
              />
            </div>
          );
        })()}
      </Surface>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "cehta" | "blue" | "amber";
}) {
  const valueColor =
    tone === "cehta"
      ? "text-cehta-green"
      : tone === "blue"
        ? "text-blue-600"
        : tone === "amber"
          ? "text-amber-600"
          : "text-ink-900";
  return (
    <Surface className="p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-display font-semibold tabular-nums ${valueColor}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-500">{hint}</p>
    </Surface>
  );
}

function CoejecutorCard({
  c,
  totalMonto,
}: {
  c: {
    empresa_codigo: string;
    empresa_razon_social: string | null;
    proyectos: string[];
    presupuesto_asignado: number;
    ejecutado_corfo: number;
    ejecutado_ptec: number;
    ejecutado_empresa_directa: number;
    ejecutado_total: number;
    cantidad_vouchers: number;
  };
  totalMonto: number;
}) {
  const ejTotal = Number(c.ejecutado_total);
  const presup = Number(c.presupuesto_asignado);
  const pctVsPresup = presup > 0 ? (ejTotal / presup) * 100 : 0;
  const pctVsTotal = totalMonto > 0 ? (ejTotal / totalMonto) * 100 : 0;
  const disponibleVsPresup = presup - ejTotal;
  return (
    <Surface className="p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Coejecutor
          </p>
          <h3 className="text-xl font-semibold text-ink-900 mt-0.5">
            {c.empresa_codigo}
          </h3>
          <p className="text-xs text-ink-500 truncate">
            {c.empresa_razon_social ?? "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-ink-500">
            Vouchers ejec.
          </p>
          <p className="text-2xl font-display font-semibold tabular-nums">
            {c.cantidad_vouchers}
          </p>
        </div>
      </div>

      {/* Presupuesto vs Ejecutado */}
      <div className="rounded-xl bg-ink-50/50 p-3 mb-3">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-ink-600">Presupuesto asignado</span>
          <span className="font-mono font-semibold tabular-nums">
            {fmtCLP(presup)}
          </span>
        </div>
        <div className="relative h-2 overflow-hidden rounded-full bg-white">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-cehta-green transition-all duration-500"
            style={{ width: `${Math.min(pctVsPresup, 100)}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[11px]">
          <span className="text-ink-500">
            Ejec. {fmtCLP(ejTotal)} ({fmtPct(pctVsPresup)})
          </span>
          <span
            className={`font-semibold tabular-nums ${
              disponibleVsPresup > 0 ? "text-positive" : "text-negative"
            }`}
          >
            Disp. {fmtCLP(disponibleVsPresup)}
          </span>
        </div>
      </div>

      {/* Desglose por fuente */}
      <div className="space-y-1.5 text-[12px]">
        <FuenteRow
          label="CORFO"
          value={Number(c.ejecutado_corfo)}
          color="text-cehta-green"
          dot="bg-cehta-green"
        />
        <FuenteRow
          label="P-tec (CEHTA)"
          value={Number(c.ejecutado_ptec)}
          color="text-blue-600"
          dot="bg-blue-500"
        />
        <FuenteRow
          label="Empresa directa"
          value={Number(c.ejecutado_empresa_directa)}
          color="text-ink-700"
          dot="bg-ink-500"
        />
      </div>

      {/* Proyectos */}
      {c.proyectos.length > 0 && (
        <div className="mt-3 pt-3 border-t border-hairline">
          <p className="text-[10px] uppercase tracking-wider text-ink-500 mb-1">
            Proyectos ({c.proyectos.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {c.proyectos.map((p) => (
              <Link
                key={p}
                href={`/admin/proyectos/${p}` as Route}
                className="inline-block rounded-md bg-ink-100 px-2 py-0.5 text-[10px] font-mono text-ink-700 hover:bg-cehta-green/10 hover:text-cehta-green"
              >
                {p}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Footer % del total */}
      <div className="mt-3 pt-3 border-t border-hairline flex items-center justify-between text-[11px] text-ink-500">
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="size-3" />
          Representa {fmtPct(pctVsTotal)} del monto total del subsidio
        </span>
      </div>
    </Surface>
  );
}

function FuenteRow({
  label,
  value,
  color,
  dot,
}: {
  label: string;
  value: number;
  color: string;
  dot: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="inline-flex items-center gap-2">
        <span className={`inline-block size-2 rounded-full ${dot}`} />
        <span className={color}>{label}</span>
      </span>
      <span className="font-mono tabular-nums">{fmtCLP(value)}</span>
    </div>
  );
}

function FuenteBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-ink-700">{label}</span>
        <span className="font-mono tabular-nums text-ink-900 font-semibold">
          {fmtCLP(value)} <span className="text-ink-400 ml-1">({fmtPct(pct)})</span>
        </span>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className={`absolute inset-y-0 left-0 ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
