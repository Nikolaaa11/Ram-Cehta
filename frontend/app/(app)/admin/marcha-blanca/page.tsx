"use client";

/**
 * /admin/marcha-blanca — Round 128 — Checklist en vivo pre-marcha-blanca
 *
 * Muestra el estado actual de cada criterio para empezar a operar el
 * fondo en producción real. Agrupado en bloqueantes / importantes / nice-to-have.
 *
 * Backend: GET /api/v1/admin/marcha-blanca/checklist
 *
 * Solo admin.
 */
import Link from "next/link";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  PlayCircle,
  Rocket,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

interface CheckResult {
  id: string;
  category: string;
  title: string;
  severity: "BLOCKER" | "IMPORTANT" | "NICE_TO_HAVE";
  status: "OK" | "WARN" | "FAIL" | "SKIPPED";
  detail: string;
  action_url: string | null;
  action_label: string | null;
}

interface CategorySummary {
  code: string;
  name: string;
  total: number;
  ok: number;
  warn: number;
  fail: number;
  skipped: number;
  progress_pct: number;
}

interface MarchaBlancaReport {
  generated_at: string;
  overall_status: "READY" | "ALMOST_READY" | "NOT_READY" | "NEEDS_ATTENTION";
  blockers_total: number;
  blockers_ok: number;
  blockers_fail: number;
  important_total: number;
  important_ok: number;
  important_fail: number;
  nice_total: number;
  nice_ok: number;
  categories: CategorySummary[];
  checks: CheckResult[];
  next_action: string;
}

const STATUS_META: Record<
  CheckResult["status"],
  { color: string; bg: string; icon: typeof CheckCircle2; label: string }
> = {
  OK: {
    color: "text-cehta-green",
    bg: "bg-cehta-green/10 ring-cehta-green/20",
    icon: CheckCircle2,
    label: "OK",
  },
  WARN: {
    color: "text-amber-700",
    bg: "bg-amber-50 ring-amber-200",
    icon: ShieldAlert,
    label: "Atención",
  },
  FAIL: {
    color: "text-red-700",
    bg: "bg-red-50 ring-red-200",
    icon: XCircle,
    label: "Falta",
  },
  SKIPPED: {
    color: "text-ink-400",
    bg: "bg-ink-50 ring-hairline",
    icon: HelpCircle,
    label: "N/A",
  },
};

const SEVERITY_META: Record<
  CheckResult["severity"],
  { label: string; color: string }
> = {
  BLOCKER: { label: "Bloqueante", color: "bg-red-100 text-red-800" },
  IMPORTANT: { label: "Importante", color: "bg-amber-100 text-amber-800" },
  NICE_TO_HAVE: { label: "Nice-to-have", color: "bg-ink-100 text-ink-700" },
};

const OVERALL_META: Record<
  MarchaBlancaReport["overall_status"],
  { label: string; color: string; bg: string; emoji: string }
> = {
  READY: {
    label: "Listo para marcha blanca",
    color: "text-cehta-green",
    bg: "from-cehta-green/15 to-cehta-green/[0.03]",
    emoji: "🚀",
  },
  ALMOST_READY: {
    label: "Casi listo (revisar warnings)",
    color: "text-amber-700",
    bg: "from-amber-100 to-amber-50",
    emoji: "⚡",
  },
  NEEDS_ATTENTION: {
    label: "Listo con observaciones",
    color: "text-amber-700",
    bg: "from-amber-100 to-amber-50",
    emoji: "👁️",
  },
  NOT_READY: {
    label: "Faltan bloqueantes",
    color: "text-red-700",
    bg: "from-red-100 to-red-50",
    emoji: "⛔",
  },
};

export default function MarchaBlancaPage() {
  const { session } = useSession();
  const { data, isLoading, error, refetch, isFetching } = useQuery<
    MarchaBlancaReport
  >({
    queryKey: ["marcha-blanca-checklist"],
    queryFn: () =>
      apiClient.get<MarchaBlancaReport>(
        "/admin/marcha-blanca/checklist",
        session,
      ),
    enabled: !!session,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] px-6 py-8">
        <p className="text-sm text-ink-500">Cargando checklist…</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="mx-auto max-w-[1100px] px-6 py-8">
        <p className="text-sm text-red-700">No se pudo cargar el checklist.</p>
      </div>
    );
  }

  const overall = OVERALL_META[data.overall_status];

  const byCategory = data.checks.reduce<Record<string, CheckResult[]>>(
    (acc, c) => {
      (acc[c.category] ||= []).push(c);
      return acc;
    },
    {},
  );

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8 space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={"/admin/system-status" as Route}
          className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-cehta-green"
        >
          <ArrowLeft className="h-4 w-4" />
          Panel admin
        </Link>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs text-ink-500 hover:text-cehta-green disabled:opacity-50"
        >
          {isFetching ? "Actualizando..." : "Refrescar"}
        </button>
      </div>

      {/* Hero — overall status */}
      <div
        className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${overall.bg} ring-1 ring-hairline p-8 shadow-card`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(rgba(35,108,79,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(35,108,79,0.04) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at top, black 30%, transparent 70%)",
          }}
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/60 backdrop-blur px-3 py-1 ring-1 ring-hairline">
            <Rocket className="size-3.5 text-cehta-green" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Marcha Blanca · FIP CEHTA ESG
            </p>
          </div>
          <h1 className="mt-3 font-display text-3xl md:text-4xl font-semibold tracking-tight text-ink-900">
            {overall.emoji} <span className={overall.color}>{overall.label}</span>
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-700 max-w-2xl">
            {data.next_action}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Generado: {new Date(data.generated_at).toLocaleString("es-CL")}
          </p>
        </div>
      </div>

      {/* KPI counts */}
      <div className="grid grid-cols-3 gap-3">
        <KPI
          label="Bloqueantes"
          ok={data.blockers_ok}
          total={data.blockers_total}
          fail={data.blockers_fail}
          color={
            data.blockers_fail > 0 ? "text-red-700" : "text-cehta-green"
          }
        />
        <KPI
          label="Importantes"
          ok={data.important_ok}
          total={data.important_total}
          fail={data.important_fail}
          color={
            data.important_fail > 0 ? "text-amber-700" : "text-cehta-green"
          }
        />
        <KPI
          label="Nice-to-have"
          ok={data.nice_ok}
          total={data.nice_total}
          fail={0}
          color="text-ink-700"
        />
      </div>

      {/* Progress por categoría */}
      <section className="rounded-2xl bg-white ring-1 ring-hairline p-5">
        <h2 className="font-display text-lg font-semibold text-ink-900 mb-3">
          Progreso por categoría
        </h2>
        <div className="space-y-2">
          {data.categories.map((c) => (
            <div key={c.code} className="flex items-center gap-3">
              <span className="font-mono text-[10px] text-ink-400 w-4">
                {c.code}
              </span>
              <span className="text-xs text-ink-700 w-48 truncate">
                {c.name}
              </span>
              <div className="flex-1 h-2 rounded-full bg-ink-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    c.fail > 0
                      ? "bg-red-500"
                      : c.warn > 0
                        ? "bg-amber-500"
                        : "bg-cehta-green"
                  }`}
                  style={{ width: `${c.progress_pct}%` }}
                />
              </div>
              <span className="font-mono text-[10px] text-ink-600 w-16 text-right">
                {c.ok}/{c.total}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Checks agrupados por categoría */}
      {Object.entries(byCategory).map(([cat, checks]) => {
        const meta = data.categories.find((c) => c.code === cat);
        if (!meta) return null;
        return (
          <section
            key={cat}
            className="rounded-2xl bg-white ring-1 ring-hairline overflow-hidden"
          >
            <header className="px-5 py-3 border-b border-hairline flex items-center gap-2">
              <span className="font-mono text-xs text-ink-400">{cat}</span>
              <h2 className="font-display text-sm font-semibold text-ink-900">
                {meta.name}
              </h2>
              <span className="ml-auto text-xs text-ink-500">
                {meta.ok}/{meta.total} OK
              </span>
            </header>
            <div className="divide-y divide-hairline">
              {checks.map((c) => {
                const sm = STATUS_META[c.status];
                const Icon = sm.icon;
                const sev = SEVERITY_META[c.severity];
                return (
                  <div key={c.id} className="px-5 py-3 flex items-start gap-3">
                    <Icon className={`size-4 mt-0.5 shrink-0 ${sm.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-ink-900">
                          {c.title}
                        </p>
                        <span
                          className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${sev.color}`}
                        >
                          {sev.label}
                        </span>
                        <span
                          className={`inline-flex rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${sm.bg} ring-1 ${sm.color}`}
                        >
                          {sm.label}
                        </span>
                      </div>
                      <p className="text-xs text-ink-600 mt-0.5">{c.detail}</p>
                      {c.action_url && (
                        <Link
                          href={c.action_url as Route}
                          className="inline-flex items-center gap-1 mt-1 text-xs text-cehta-green hover:underline"
                        >
                          {c.action_label || "Ir a resolver"}
                          <ExternalLink className="size-3" />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Footer help */}
      <div className="rounded-2xl bg-ink-50/40 ring-1 ring-hairline p-4 text-xs text-ink-600">
        <p className="font-semibold text-ink-900 mb-1 flex items-center gap-1">
          <PlayCircle className="size-3.5 text-cehta-green" />
          ¿Cómo se interpreta esto?
        </p>
        <p>
          <strong>BLOQUEANTE</strong> = no se puede arrancar marcha blanca sin
          esto resuelto (riesgo legal/operativo). <strong>IMPORTANTE</strong> ={" "}
          se puede arrancar, pero hay que resolverlo en la primera semana.{" "}
          <strong>NICE-TO-HAVE</strong> = mejoras de calidad/performance que
          pueden esperar.
        </p>
        <p className="mt-1">
          El checklist se refresca cada 60 segundos. Después de aplicar una
          migración SQL o un fix, recargar la página para ver el estado
          actualizado.
        </p>
      </div>
    </div>
  );
}

function KPI({
  label,
  ok,
  total,
  fail,
  color,
}: {
  label: string;
  ok: number;
  total: number;
  fail: number;
  color: string;
}) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-hairline p-4">
      <p className="text-[10px] uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`font-mono text-2xl font-bold tabular-nums mt-1 ${color}`}>
        {ok}/{total}
      </p>
      {fail > 0 && (
        <p className="text-[10px] text-red-700 mt-1">{fail} en FAIL</p>
      )}
    </div>
  );
}
