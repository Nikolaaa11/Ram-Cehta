"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Receipt,
  FileText,
  ScrollText,
  Wallet,
  CalendarClock,
  ChevronRight,
  Loader2,
  Inbox,
  GanttChart,
  Scroll,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { useObligations } from "@/hooks/use-obligations";
import type { ObligationItem } from "@/lib/api/schema";
import { cn } from "@/lib/utils";
import { HeaderBigNumber } from "@/components/action-center/HeaderBigNumber";
import { TrendSparkline } from "@/components/action-center/TrendSparkline";
import { SeverityDonuts } from "@/components/action-center/SeverityDonuts";
import { EmptyStatePremium } from "@/components/action-center/EmptyStatePremium";
import { StickyCriticalBar } from "@/components/action-center/StickyCriticalBar";
import { CuotasProximasWidget } from "@/components/ordenes-compra/CuotasProximasWidget";

type Tipo = ObligationItem["tipo"];

const TIPO_META: Record<
  Tipo,
  { label: string; icon: React.ElementType; color: string }
> = {
  f29: { label: "F29 / Tributario", icon: Receipt, color: "text-warning" },
  f22: { label: "F22 / Renta Anual", icon: Receipt, color: "text-warning" }, // R152z
  legal: { label: "Contratos & Legal", icon: ScrollText, color: "text-info" },
  oc: { label: "Órdenes de Compra", icon: FileText, color: "text-cehta-green" },
  suscripcion: {
    label: "Suscripciones FIP",
    icon: Wallet,
    color: "text-positive",
  },
  event: {
    label: "Eventos manuales",
    icon: CalendarClock,
    color: "text-ink-500",
  },
  hito: {
    label: "Hitos del Gantt",
    icon: GanttChart,
    color: "text-info",
  },
  entregable: {
    label: "Entregables Regulatorios",
    icon: Scroll,
    color: "text-negative",
  },
};

const SEVERITY_META: Record<
  ObligationItem["severity"],
  { label: string; bg: string; text: string; ring: string }
> = {
  critical: {
    label: "Vencido / Urgente",
    bg: "bg-negative/10",
    text: "text-negative",
    ring: "ring-negative/20",
  },
  warning: {
    label: "Esta semana",
    bg: "bg-warning/10",
    text: "text-warning",
    ring: "ring-warning/20",
  },
  info: {
    label: "Próximo",
    bg: "bg-cehta-green/10",
    text: "text-cehta-green",
    ring: "ring-cehta-green/20",
  },
};

const TIPO_ORDER: Tipo[] = [
  "f29",
  "f22", // R152z
  "oc",
  "legal",
  "suscripcion",
  "hito",
  "entregable",
  "event",
];

function formatRelative(daysUntil: number): string {
  if (daysUntil < 0) return `Vencido hace ${Math.abs(daysUntil)}d`;
  if (daysUntil === 0) return "Hoy";
  if (daysUntil === 1) return "Mañana";
  if (daysUntil <= 7) return `En ${daysUntil}d`;
  if (daysUntil <= 30) return `En ${Math.ceil(daysUntil / 7)} sem`;
  return `En ${Math.ceil(daysUntil / 30)} meses`;
}

function ActionRow({ item }: { item: ObligationItem }) {
  const meta = SEVERITY_META[item.severity];
  return (
    <Link
      href={item.link as never}
      className={`group flex items-start gap-3 rounded-xl px-4 py-3 transition-all duration-150 ease-apple hover:bg-ink-100/40`}
    >
      {/* Severity dot */}
      <span
        className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
          item.severity === "critical"
            ? "bg-negative"
            : item.severity === "warning"
            ? "bg-warning"
            : "bg-cehta-green"
        }`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-ink-900">
            {item.title}
          </p>
          {item.empresa_codigo && (
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-ink-100/60 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-600"
              title={item.empresa_codigo}
            >
              <EmpresaLogo
                empresaCodigo={item.empresa_codigo}
                size={16}
                rounded={false}
                className="rounded"
              />
              {item.empresa_codigo}
            </span>
          )}
        </div>
        {item.subtitle && (
          <p className="mt-0.5 truncate text-xs text-ink-500">
            {item.subtitle}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className={`text-[11px] font-medium ${meta.text}`}>
          {formatRelative(item.days_until)}
        </span>
        {item.monto !== null && item.monto !== undefined && (
          <span className="tabular-nums text-[11px] text-ink-500">
            {Number(item.monto).toLocaleString("es-CL")} {item.moneda ?? ""}
          </span>
        )}
      </div>
      <ChevronRight
        className="mt-1 h-4 w-4 shrink-0 text-ink-300 transition-transform duration-150 ease-apple group-hover:translate-x-0.5 group-hover:text-ink-500"
        strokeWidth={1.75}
      />
    </Link>
  );
}

export default function ActionCenterPage() {
  const [empresa, setEmpresa] = useState<string | null>(null);
  const firstCriticalRef = useRef<HTMLDivElement | null>(null);
  const { data, isLoading, error, refetch } = useObligations(
    empresa ? { empresa_codigo: empresa } : {},
  );

  const handleJumpToCritical = () => {
    firstCriticalRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  // Agrupar por tipo, ordenar por severity DESC + days_until ASC
  const grouped = useMemo(() => {
    const m: Record<Tipo, ObligationItem[]> = {
      f29: [],
      f22: [], // R152z
      oc: [],
      legal: [],
      suscripcion: [],
      event: [],
      hito: [],
      entregable: [],
    };
    for (const o of data ?? []) m[o.tipo].push(o);
    // Sort: critical primero, luego warning, luego info; dentro, days_until ASC
    const sevRank = { critical: 0, warning: 1, info: 2 };
    for (const tipo of Object.keys(m) as Tipo[]) {
      m[tipo].sort((a, b) => {
        if (sevRank[a.severity] !== sevRank[b.severity]) {
          return sevRank[a.severity] - sevRank[b.severity];
        }
        return a.days_until - b.days_until;
      });
    }
    return m;
  }, [data]);

  const counts = useMemo(() => {
    const total = data?.length ?? 0;
    const critical = data?.filter((o) => o.severity === "critical").length ?? 0;
    const warning = data?.filter((o) => o.severity === "warning").length ?? 0;
    const info = data?.filter((o) => o.severity === "info").length ?? 0;
    return { total, critical, warning, info };
  }, [data]);

  // Lista plana de empresas presentes en los items para el filtro
  const empresasPresentes = useMemo(() => {
    const s = new Set<string>();
    for (const o of data ?? []) {
      if (o.empresa_codigo) s.add(o.empresa_codigo);
    }
    return Array.from(s).sort();
  }, [data]);

  return (
    <div
      className={cn(
        "mx-auto max-w-[1200px] space-y-6",
        counts.critical > 0 && "pb-24",
      )}
    >
      {/* Header premium con gradient mesh — light mode only (Apple-tier) */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white via-cehta-green/[0.04] to-emerald-50/40 ring-1 ring-cehta-green/15 p-6 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cehta-green/10 blur-3xl"
        />
        {counts.critical > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute -left-12 -bottom-12 h-40 w-40 rounded-full bg-negative/15 blur-3xl"
          />
        )}
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-3 py-1 ring-1 ring-cehta-green/20">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute h-full w-full rounded-full bg-cehta-green/50 animate-pulse-ring" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-cehta-green" />
              </span>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
                Bandeja unificada
              </p>
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
              Action Center
            </h1>
            <p className="mt-1 text-sm text-ink-500 max-w-2xl">
              Todo lo que requiere tu atención hoy — F29, OCs, contratos,
              suscripciones, eventos. Agrupado por tipo, ordenado por urgencia.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {isLoading && (
              <Loader2 className="h-5 w-5 animate-spin text-cehta-green shrink-0" />
            )}
            {!isLoading && !error && counts.total > 0 && (
              <HeaderBigNumber total={counts.total} />
            )}
          </div>
        </div>
      </div>

      {/* Stats tiles premium con gradients + sparkles (light-only) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Surface padding="compact" className="relative overflow-hidden text-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">
            Total
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-ink-900">
            {counts.total}
          </p>
        </Surface>
        <Surface
          padding="compact"
          className={cn(
            "relative overflow-hidden !bg-gradient-to-br from-red-50 via-red-50/60 to-orange-50/40 text-center ring-1 ring-negative/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-glow-red",
            counts.critical > 0 && "shadow-glow-red",
          )}
        >
          {counts.critical > 0 && (
            <div
              aria-hidden
              className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-negative/20 blur-2xl"
            />
          )}
          <p className="relative text-[11px] uppercase tracking-wider text-negative">
            Vencido / Urgente
          </p>
          <p className="relative mt-1 text-3xl font-semibold tabular-nums text-negative">
            {counts.critical}
          </p>
        </Surface>
        <Surface
          padding="compact"
          className="relative overflow-hidden !bg-gradient-to-br from-amber-50 via-amber-50/60 to-yellow-50/40 text-center ring-1 ring-warning/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-glow-gold"
        >
          <p className="text-[11px] uppercase tracking-wider text-warning">
            Esta semana
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-warning">
            {counts.warning}
          </p>
        </Surface>
        <Surface
          padding="compact"
          className="relative overflow-hidden !bg-gradient-to-br from-cehta-green/5 via-emerald-50/50 to-teal-50/30 text-center ring-1 ring-cehta-green/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-glow-green"
        >
          <p className="text-[11px] uppercase tracking-wider text-cehta-green">
            Próximo
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-cehta-green">
            {counts.info}
          </p>
        </Surface>
      </div>

      {/* Donuts por severidad + sparkline de tendencia (R152jj) */}
      {!isLoading && !error && counts.total > 0 && (
        <>
          <SeverityDonuts
            critical={counts.critical}
            warning={counts.warning}
            info={counts.info}
          />
          <TrendSparkline obligations={data ?? []} />
        </>
      )}

      {/* R152DDDD — Widget cuotas próximas a vencer */}
      <CuotasProximasWidget dias={30} limit={6} />

      {/* Filter de empresa */}
      {empresasPresentes.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-ink-400">
            Empresa:
          </span>
          <button
            type="button"
            onClick={() => setEmpresa(null)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150 ease-apple ${
              empresa === null
                ? "bg-ink-900 text-white"
                : "bg-ink-100/60 text-ink-700 hover:bg-ink-100"
            }`}
          >
            Todas
          </button>
          {empresasPresentes.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmpresa(e)}
              className={`inline-flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs font-medium transition-colors duration-150 ease-apple ${
                empresa === e
                  ? "bg-ink-900 text-white"
                  : "bg-ink-100/60 text-ink-700 hover:bg-ink-100"
              }`}
            >
              <EmpresaLogo empresaCodigo={e} size={18} />
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <ErrorState
          title="No se pudo cargar el Action Center"
          error={error}
          onRetry={() => refetch()}
        />
      )}

      {/* Empty state premium — Caja regulatoria al día (R152jj) */}
      {!isLoading && !error && counts.total === 0 && <EmptyStatePremium />}

      {/* Grouped sections */}
      {!isLoading && !error && counts.total > 0 && (
        <div className="space-y-4">
          {(() => {
            let firstCriticalAssigned = false;
            return TIPO_ORDER.map((tipo) => {
              const items = grouped[tipo];
              if (items.length === 0) return null;
              const meta = TIPO_META[tipo];
              const Icon = meta.icon;
              const criticalInGroup = items.filter(
                (i) => i.severity === "critical",
              ).length;
              return (
                <Surface key={tipo} padding="none">
                  <Surface.Header className="border-b border-hairline px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg bg-ink-100/40 ${meta.color}`}
                        >
                          <Icon className="h-4 w-4" strokeWidth={1.75} />
                        </span>
                        <Surface.Title>{meta.label}</Surface.Title>
                        <Badge variant="neutral">{items.length}</Badge>
                        {criticalInGroup > 0 && (
                          <Badge variant="danger">
                            <AlertTriangle
                              className="mr-1 inline h-3 w-3"
                              strokeWidth={2}
                            />
                            {criticalInGroup} urgente
                            {criticalInGroup === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </div>
                      {items.length > 5 && (
                        <span className="text-xs text-ink-400">
                          Mostrando todos los {items.length}
                        </span>
                      )}
                    </div>
                  </Surface.Header>
                  <div className="divide-y divide-hairline p-1">
                    {items.map((item) => {
                      const isFirstCritical =
                        !firstCriticalAssigned && item.severity === "critical";
                      if (isFirstCritical) firstCriticalAssigned = true;
                      return (
                        <div
                          key={item.id}
                          ref={isFirstCritical ? firstCriticalRef : undefined}
                        >
                          <ActionRow item={item} />
                        </div>
                      );
                    })}
                  </div>
                </Surface>
              );
            });
          })()}
        </div>
      )}

      {/* Sticky action bar — solo si hay críticas (R152jj) */}
      <StickyCriticalBar
        count={counts.critical}
        onJump={handleJumpToCritical}
      />

      {/* Footer cue */}
      {!isLoading && !error && counts.total > 0 && (
        <div className="flex items-center justify-center gap-2 pt-4 text-xs text-ink-400">
          <Inbox className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>
            Click en cualquier item para ir al detalle y ejecutar la acción.
            Esta vista se actualiza automáticamente cuando completás algo.
          </span>
        </div>
      )}
    </div>
  );
}
