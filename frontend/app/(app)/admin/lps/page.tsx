"use client";

/**
 * /admin/lps — Pipeline de LPs (Limited Partners).
 *
 * Lista todos los inversionistas registrados con KPIs agregados, filtros
 * por estado/perfil, y search por nombre/email/empresa.
 *
 * Cada row linkea a /admin/lps/[id] para detalle + edición + ver informes
 * asociados.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  Users,
  TrendingUp,
  Wallet,
  Mail,
  Building2,
  ArrowUpRight,
} from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EstadoLp, LpRead, PerfilInversor } from "@/lib/api/schema";

const ESTADO_LABEL: Record<EstadoLp, string> = {
  pipeline: "Pipeline",
  cualificado: "Cualificado",
  activo: "Activo",
  inactivo: "Inactivo",
  declinado: "Declinado",
};

const ESTADO_VARIANT: Record<
  EstadoLp,
  "success" | "warning" | "neutral" | "danger" | "info"
> = {
  activo: "success",
  cualificado: "info",
  pipeline: "warning",
  inactivo: "neutral",
  declinado: "danger",
};

const PERFIL_LABEL: Record<PerfilInversor, string> = {
  conservador: "Conservador",
  moderado: "Moderado",
  agresivo: "Agresivo",
  esg_focused: "ESG-focused",
};

function formatCLP(amount: number | null | undefined): string {
  if (!amount) return "—";
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(0)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${Math.round(amount)}`;
}

export default function AdminLpsPage() {
  const [search, setSearch] = useState("");
  const [estadoFilter, setEstadoFilter] = useState<EstadoLp | "">("");

  const lpsQ = useApiQuery<LpRead[]>(["lps", "list", estadoFilter || "all"],
    estadoFilter ? `/lps?estado=${estadoFilter}` : "/lps",
  );

  // Memoizar referencia estable para que useMemo de filtros no rompa
  // exhaustive-deps en cada render con `?? []` inline.
  const lps = useMemo(() => lpsQ.data ?? [], [lpsQ.data]);

  const filtered = useMemo(() => {
    if (!search.trim()) return lps;
    const q = search.toLowerCase();
    return lps.filter(
      (lp) =>
        lp.nombre.toLowerCase().includes(q) ||
        (lp.apellido ?? "").toLowerCase().includes(q) ||
        (lp.email ?? "").toLowerCase().includes(q) ||
        (lp.empresa ?? "").toLowerCase().includes(q),
    );
  }, [lps, search]);

  // KPIs agregados
  const kpis = useMemo(() => {
    const out = {
      total: lps.length,
      activos: 0,
      pipeline: 0,
      total_comprometido: 0,
      total_integrado: 0,
    };
    for (const lp of lps) {
      if (lp.estado === "activo") out.activos++;
      if (lp.estado === "pipeline") out.pipeline++;
      out.total_comprometido += lp.aporte_total ?? 0;
      out.total_integrado += lp.aporte_actual ?? 0;
    }
    return out;
  }, [lps]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Surface variant="glass">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cehta-green/15 text-cehta-green">
                <Users className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div>
                <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
                  Inversionistas (LPs)
                </h1>
                <p className="text-xs text-ink-500">
                  Pipeline de Limited Partners — pasados, activos y potenciales
                </p>
              </div>
            </div>
          </div>
          <Link
            href={"/admin/lps/nuevo" as never}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Nuevo LP
          </Link>
        </div>

        {/* KPIs */}
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiTile
            label="Total LPs"
            value={kpis.total}
            sub={`${kpis.activos} activos`}
            Icon={Users}
            tone="cehta"
          />
          <KpiTile
            label="En pipeline"
            value={kpis.pipeline}
            sub="por convertir"
            Icon={TrendingUp}
            tone="info"
          />
          <KpiTile
            label="Comprometido"
            value={formatCLP(kpis.total_comprometido)}
            sub="total fondo"
            Icon={Wallet}
            tone="positive"
          />
          <KpiTile
            label="Integrado"
            value={formatCLP(kpis.total_integrado)}
            sub={
              kpis.total_comprometido > 0
                ? `${Math.round((kpis.total_integrado / kpis.total_comprometido) * 100)}% del compromiso`
                : "—"
            }
            Icon={ArrowUpRight}
            tone="positive"
          />
        </div>
      </Surface>

      {/* Filtros */}
      <Surface>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
              strokeWidth={1.75}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, email, empresa…"
              className="w-full rounded-xl border-0 bg-ink-50 py-2 pl-9 pr-3 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
          <Combobox
            items={[
              { value: "", label: "Todos los estados" },
              { value: "pipeline", label: "Pipeline" },
              { value: "cualificado", label: "Cualificado" },
              { value: "activo", label: "Activo" },
              { value: "inactivo", label: "Inactivo" },
              { value: "declinado", label: "Declinado" },
            ]}
            value={estadoFilter}
            onValueChange={(v) => setEstadoFilter(v as EstadoLp | "")}
            placeholder="Estado"
            triggerClassName="min-w-[180px]"
          />
        </div>
      </Surface>

      {/* Lista */}
      <Surface padding="none">
        {lpsQ.isLoading ? (
          <div className="space-y-2 p-6">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            search={search}
            hasFilters={!!estadoFilter}
            onClear={() => {
              setSearch("");
              setEstadoFilter("");
            }}
          />
        ) : (
          <ul className="divide-y divide-hairline">
            {filtered.map((lp) => (
              <LpRow key={lp.lp_id} lp={lp} />
            ))}
          </ul>
        )}
      </Surface>
    </div>
  );
}

// ─── Sub-componentes ───────────────────────────────────────────────────────

function LpRow({ lp }: { lp: LpRead }) {
  const nombreCompleto =
    (lp.nombre + (lp.apellido ? ` ${lp.apellido}` : "")).trim();
  const aporteTotal = lp.aporte_total ?? 0;
  const aporteActual = lp.aporte_actual ?? 0;
  const pctIntegrado =
    aporteTotal > 0 ? Math.round((aporteActual / aporteTotal) * 100) : 0;

  return (
    <li>
      <Link
        href={`/admin/lps/${lp.lp_id}` as never}
        className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-ink-50/40"
      >
        {/* Avatar con iniciales */}
        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cehta-green/10 text-sm font-bold text-cehta-green"
          aria-hidden
        >
          {getInitials(nombreCompleto)}
        </span>

        {/* Identidad */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink-900">
              {nombreCompleto}
            </p>
            <Badge variant={ESTADO_VARIANT[lp.estado]}>
              {ESTADO_LABEL[lp.estado]}
            </Badge>
            {lp.perfil_inversor && (
              <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-600">
                {PERFIL_LABEL[lp.perfil_inversor]}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
            {lp.email && (
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3 w-3" strokeWidth={1.5} />
                {lp.email}
              </span>
            )}
            {lp.empresa && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3" strokeWidth={1.5} />
                {lp.empresa}
              </span>
            )}
            {lp.empresas_invertidas && lp.empresas_invertidas.length > 0 && (
              <span className="text-ink-400">
                {lp.empresas_invertidas.length} empresa
                {lp.empresas_invertidas.length === 1 ? "" : "s"} en cartera
              </span>
            )}
          </div>
        </div>

        {/* Aportes */}
        <div className="shrink-0 text-right">
          {aporteTotal > 0 ? (
            <>
              <p className="text-sm font-semibold tabular-nums text-ink-900">
                {formatCLP(aporteActual)}
                <span className="text-ink-400"> / {formatCLP(aporteTotal)}</span>
              </p>
              <p className="text-[10px] text-ink-500">
                {pctIntegrado}% integrado
              </p>
            </>
          ) : (
            <p className="text-xs italic text-ink-400">Sin aporte aún</p>
          )}
        </div>
      </Link>
    </li>
  );
}

function EmptyState({
  search,
  hasFilters,
  onClear,
}: {
  search: string;
  hasFilters: boolean;
  onClear: () => void;
}) {
  if (search.trim() || hasFilters) {
    // Round 10 — empty state accionable. CTA "Limpiar filtros" reset en 1 click.
    return (
      <div className="py-12 text-center">
        <p className="text-sm font-medium text-ink-700">Sin LPs que matcheen</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-ink-500">
          Probaste{" "}
          {[
            search.trim() && `búsqueda="${search.trim()}"`,
            hasFilters && "estado activo",
          ]
            .filter(Boolean)
            .join(", ")}
          . Ajustá los filtros o limpiá todo para ver la lista completa.
        </p>
        <button
          type="button"
          onClick={onClear}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-xs font-semibold text-white hover:bg-cehta-green-700"
        >
          Limpiar filtros
        </button>
      </div>
    );
  }
  return (
    <div className="py-16 text-center">
      <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green">
        <Users className="h-7 w-7" strokeWidth={1.5} />
      </span>
      <p className="mt-3 text-base font-semibold text-ink-900">
        Aún no hay LPs registrados
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">
        Empezá agregando tus primeros inversionistas para poder generar
        informes personalizados.
      </p>
      <Link
        href={"/admin/lps/nuevo" as never}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700"
      >
        <Plus className="h-4 w-4" strokeWidth={2} />
        Crear primer LP
      </Link>
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  Icon,
  tone,
}: {
  label: string;
  value: string | number;
  sub: string;
  Icon: React.ElementType;
  tone: "cehta" | "info" | "positive" | "ink";
}) {
  const colors = {
    cehta: "bg-cehta-green/10 text-cehta-green",
    info: "bg-info/10 text-info",
    positive: "bg-positive/10 text-positive",
    ink: "bg-ink-100 text-ink-600",
  }[tone];
  return (
    <div className="rounded-xl border border-hairline bg-white px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-lg",
            colors,
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <p className="text-[10px] uppercase tracking-wider text-ink-400">
          {label}
        </p>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
        {value}
      </p>
      <p className="text-[11px] text-ink-500">{sub}</p>
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
