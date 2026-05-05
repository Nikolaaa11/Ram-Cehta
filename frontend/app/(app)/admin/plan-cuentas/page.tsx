"use client";

/**
 * /admin/plan-cuentas
 *
 * Plan de cuentas chileno V5 con jerarquía 4 niveles X-XX-XX-XX.
 *
 *   Nivel 1: 1-00-00-00 (grupo: Activos / Pasivos / Resultados / Orden)
 *   Nivel 2: 1-01-00-00 (subgrupo: Activos Circulantes...)
 *   Nivel 3: 1-01-01-00 (categoría: Disponible...)
 *   Nivel 4: 1-01-01-04 (cuenta imputable: Banco BCI) ← solo este acepta líneas
 *
 * Vista:
 *   - Hero editorial Apple-tier
 *   - 4 KPIs strip (total / imputables / CORFO / habilitaciones)
 *   - Filtros: empresa + tipo + búsqueda live
 *   - Árbol expandible con dots de color por estado (verde imputable,
 *     dorado CORFO, gris inactiva)
 *   - Click en cuenta nivel 4 → drawer con detalle + flags + nubox
 *
 * Apple-tier estético: tipografía display, mesh gradient sutil,
 * micro-interacciones, motion-reduce respetado.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  Search,
  Sparkles,
  TreePine,
  XCircle,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import type {
  Area,
  PlanCuenta,
  PlanCuentaTreeNode,
  PlanCuentasSummary,
} from "@/lib/api/schema";

const TIPO_COLORS: Record<string, string> = {
  ACTIVO: "text-emerald-700 bg-emerald-50 ring-emerald-200",
  PASIVO: "text-rose-700 bg-rose-50 ring-rose-200",
  PATRIMONIO: "text-purple-700 bg-purple-50 ring-purple-200",
  INGRESO: "text-cyan-700 bg-cyan-50 ring-cyan-200",
  GASTO: "text-amber-700 bg-amber-50 ring-amber-200",
  RESULTADO: "text-indigo-700 bg-indigo-50 ring-indigo-200",
  ORDEN: "text-slate-700 bg-slate-100 ring-slate-200",
};

interface Empresa {
  codigo: string;
  razon_social: string;
}

export default function PlanCuentasPage() {
  const { session } = useSession();
  const [empresaFilter, setEmpresaFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selectedCuenta, setSelectedCuenta] = useState<string | null>(null);

  const { data: summary } = useQuery<PlanCuentasSummary>({
    queryKey: ["plan-cuentas-summary"],
    queryFn: () =>
      apiClient.get<PlanCuentasSummary>(
        "/admin/plan-cuentas/summary",
        session,
      ),
    enabled: !!session,
  });

  const { data: empresas } = useQuery<Empresa[]>({
    queryKey: ["empresas"],
    queryFn: () => apiClient.get<Empresa[]>("/empresa", session),
    enabled: !!session,
  });

  const { data: tree, isLoading } = useQuery<PlanCuentaTreeNode[]>({
    queryKey: ["plan-cuentas-tree", empresaFilter],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (empresaFilter) qs.set("empresa_codigo", empresaFilter);
      qs.set("only_active", "true");
      return apiClient.get<PlanCuentaTreeNode[]>(
        `/plan-cuentas/tree?${qs}`,
        session,
      );
    },
    enabled: !!session,
  });

  const { data: detail } = useQuery<PlanCuenta>({
    queryKey: ["plan-cuenta", selectedCuenta],
    queryFn: () =>
      apiClient.get<PlanCuenta>(
        `/plan-cuentas/${encodeURIComponent(selectedCuenta!)}`,
        session,
      ),
    enabled: !!session && !!selectedCuenta,
  });

  // Filtro local por search — más rápido que round-trip a backend
  const filteredTree = useMemo(() => {
    if (!tree) return [];
    if (!search.trim()) return tree;
    const q = search.toLowerCase();
    const filterNode = (node: PlanCuentaTreeNode): PlanCuentaTreeNode | null => {
      const matchesSelf =
        node.codigo.toLowerCase().includes(q) ||
        node.nombre.toLowerCase().includes(q);
      const filteredChildren = node.children
        .map(filterNode)
        .filter((n): n is PlanCuentaTreeNode => n !== null);
      if (matchesSelf || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }
      return null;
    };
    return tree
      .map(filterNode)
      .filter((n): n is PlanCuentaTreeNode => n !== null);
  }, [tree, search]);

  return (
    <div className="relative">
      {/* Mesh gradient ambient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[400px]"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 0%, rgba(35,108,79,0.05) 0%, transparent 65%)",
        }}
      />

      <div className="mx-auto max-w-[1280px] px-6 lg:px-10 pt-10 pb-20 space-y-8">
        {/* Hero editorial */}
        <header className="max-w-3xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
            Plan de cuentas · FIP CEHTA
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-[40px] sm:leading-[1.1]">
            Plan maestro de 4 niveles
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-600">
            Catálogo único de cuentas contables compartido por las 9 entidades.
            Solo cuentas de nivel 4 (X-XX-XX-XX) aceptan imputaciones de
            voucher. Las cuentas marcadas CORFO habilitan rendiciones automáticas
            cuando se imputan a proyectos del programa.
          </p>
        </header>

        {/* KPI strip */}
        {summary && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi
              label="Total cuentas"
              value={summary.total_cuentas.toLocaleString("es-CL")}
              hint={
                summary.last_imported
                  ? `Actualizado ${new Date(summary.last_imported).toLocaleDateString("es-CL")}`
                  : "Sin importar todavía"
              }
            />
            <Kpi
              label="Imputables"
              value={summary.cuentas_imputables.toLocaleString("es-CL")}
              hint="Solo nivel 4 acepta líneas"
            />
            <Kpi
              label="CORFO elegibles"
              value={summary.cuentas_corfo.toLocaleString("es-CL")}
              hint="Habilitan rendición auto"
              tone="cehta"
            />
            <Kpi
              label="Habilitaciones"
              value={summary.habilitaciones_total.toLocaleString("es-CL")}
              hint="Pares cuenta × empresa"
            />
          </div>
        )}

        {/* Onboarding empty si no hay cuentas */}
        {summary && summary.total_cuentas === 0 && (
          <AdminEmptyState
            icon={<FileSpreadsheet strokeWidth={1.5} />}
            eyebrow="Plan de cuentas vacío"
            title="Importá el plan desde Excel"
            body="Andá a /admin/etl y subí Plan_de_cuentas_v2.xlsx. El importer carga las 469 cuentas + habilitación por empresa + proyectos contables + áreas en una sola pasada. Idempotente: re-correr con el Excel actualizado no duplica nada."
            ctaLabel="Ir a Importar"
            onCta={() => {
              window.location.href = "/admin/etl";
            }}
          />
        )}

        {/* Tree view (solo si hay datos) */}
        {summary && summary.total_cuentas > 0 && (
          <>
            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-hairline bg-white p-4">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-ink-600">
                  Empresa:
                </label>
                <select
                  value={empresaFilter}
                  onChange={(e) => setEmpresaFilter(e.target.value)}
                  className="rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                >
                  <option value="">Todas (plan canónico)</option>
                  {(empresas ?? []).map((e) => (
                    <option key={e.codigo} value={e.codigo}>
                      {e.codigo} — {e.razon_social}
                    </option>
                  ))}
                </select>
              </div>
              <div className="relative flex-1 min-w-[200px]">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
                  strokeWidth={1.75}
                />
                <input
                  type="text"
                  placeholder="Buscar por código o nombre…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 pl-9 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              </div>
              <div className="ml-auto flex items-center gap-3 text-[10px] text-ink-500">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-positive" />
                  Imputable
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-400" />
                  CORFO
                </span>
              </div>
            </div>

            {/* Árbol */}
            {isLoading ? (
              <p className="text-sm text-ink-500">Cargando árbol…</p>
            ) : filteredTree.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-ink-500">
                Sin resultados con esos filtros.
              </p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
                {filteredTree.map((node) => (
                  <TreeRow
                    key={node.codigo}
                    node={node}
                    depth={0}
                    expandedDefault={node.nivel <= 1}
                    onSelectImputable={setSelectedCuenta}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Drawer detalle */}
        {selectedCuenta && detail && (
          <CuentaDetailDrawer
            cuenta={detail}
            onClose={() => setSelectedCuenta(null)}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------

function Kpi({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "ink" | "cehta";
}) {
  const accent =
    tone === "cehta"
      ? "border-cehta-green/30 bg-cehta-green/5"
      : "border-hairline bg-white";
  return (
    <div className={`rounded-2xl border ${accent} p-4 shadow-card`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
        {label}
      </p>
      <p
        className={`mt-1 font-display text-2xl font-semibold tabular-nums ${
          tone === "cehta" ? "text-cehta-green" : "text-ink-900"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-ink-500">{hint}</p>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  expandedDefault,
  onSelectImputable,
}: {
  node: PlanCuentaTreeNode;
  depth: number;
  expandedDefault: boolean;
  onSelectImputable: (codigo: string) => void;
}) {
  const [expanded, setExpanded] = useState(expandedDefault);
  const hasChildren = node.children.length > 0;
  const indent = depth * 18;

  const tipoBadge = TIPO_COLORS[node.tipo] ?? TIPO_COLORS.ORDEN;

  return (
    <>
      <div
        className={`group flex items-center gap-2 border-b border-hairline/50 px-4 py-2 transition-colors ${
          node.imputable ? "cursor-pointer hover:bg-cehta-green/5" : "hover:bg-ink-50/40"
        } ${!node.activa ? "opacity-50" : ""}`}
        style={{ paddingLeft: 16 + indent }}
        onClick={() => {
          if (node.imputable) {
            onSelectImputable(node.codigo);
          } else if (hasChildren) {
            setExpanded((e) => !e);
          }
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((x) => !x);
            }}
            aria-label={expanded ? "Colapsar" : "Expandir"}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-400 hover:bg-ink-100"
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
              strokeWidth={2}
            />
          </button>
        ) : (
          <span className="inline-block h-5 w-5 shrink-0" />
        )}

        {/* Dots de estado */}
        <span className="flex shrink-0 items-center gap-0.5">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              node.imputable ? "bg-positive" : "bg-ink-200"
            }`}
            aria-label={node.imputable ? "Imputable" : "Agrupador"}
          />
          {node.corfo_elegible && (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-400"
              aria-label="CORFO elegible"
            />
          )}
        </span>

        <code className="shrink-0 font-mono text-[12.5px] tabular-nums text-ink-500">
          {node.codigo}
        </code>

        <span
          className={`ml-2 text-sm ${node.imputable ? "font-medium text-ink-900" : "text-ink-700"}`}
        >
          {node.nombre}
        </span>

        <span
          className={`ml-auto inline-flex shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset ${tipoBadge}`}
        >
          {node.tipo}
        </span>
      </div>

      {expanded &&
        node.children.map((child) => (
          <TreeRow
            key={child.codigo}
            node={child}
            depth={depth + 1}
            expandedDefault={false}
            onSelectImputable={onSelectImputable}
          />
        ))}
    </>
  );
}

function CuentaDetailDrawer({
  cuenta,
  onClose,
}: {
  cuenta: PlanCuenta;
  onClose: () => void;
}) {
  const flags = [
    { key: "flag_caja", label: "Caja" },
    { key: "flag_activo_fijo", label: "Activo Fijo" },
    { key: "flag_documento", label: "Documento" },
    { key: "flag_control_gestion", label: "Control de Gestión" },
    { key: "flag_partida", label: "Partida" },
    { key: "flag_concepto", label: "Concepto" },
    { key: "flag_capital", label: "Capital" },
    { key: "flag_activo_neto", label: "Activo Neto" },
    { key: "flag_marca_14d", label: "Marca 14D" },
    { key: "flag_percepcion", label: "Percepción" },
  ] as const;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="fixed right-0 top-0 h-screen w-full max-w-md overflow-y-auto bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-hairline bg-white/85 px-6 py-4 backdrop-blur-xl">
          <div>
            <code className="font-mono text-xs tabular-nums text-ink-500">
              {cuenta.codigo}
            </code>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-ink-900">
              {cuenta.nombre}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 font-semibold uppercase tracking-wider ring-1 ring-inset ${TIPO_COLORS[cuenta.tipo] ?? TIPO_COLORS.ORDEN}`}
              >
                {cuenta.tipo}
              </span>
              <span className="rounded-full bg-ink-100 px-2 py-0.5 font-semibold uppercase tracking-wider text-ink-600">
                Nivel {cuenta.nivel}
              </span>
              {cuenta.imputable && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-positive/10 px-2 py-0.5 font-semibold uppercase tracking-wider text-positive">
                  <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
                  Imputable
                </span>
              )}
              {cuenta.corfo_elegible && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-yellow-100 px-2 py-0.5 font-semibold uppercase tracking-wider text-yellow-800">
                  <Sparkles className="h-3 w-3" strokeWidth={2.5} />
                  CORFO {cuenta.tipo_gasto_corfo ?? ""}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-600 transition-colors hover:bg-ink-200"
          >
            <XCircle className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        <div className="space-y-4 px-6 py-5 text-sm">
          <Section title="Tratamiento IVA">
            <p className="font-mono text-xs">
              {cuenta.iva_tratamiento}
            </p>
          </Section>

          <Section title="Códigos externos">
            <dl className="grid grid-cols-2 gap-y-2 text-xs">
              <dt className="text-ink-500">Nubox</dt>
              <dd className="font-mono">
                {cuenta.nubox_code ?? "—"}
              </dd>
              <dt className="text-ink-500">F22 (renta SII)</dt>
              <dd className="font-mono">
                {cuenta.codigo_f22 ?? "—"}
              </dd>
              <dt className="text-ink-500">Ajuste 14D</dt>
              <dd className="font-mono">
                {cuenta.ajuste_14d ?? "—"}
              </dd>
            </dl>
          </Section>

          <Section title="Flags contables">
            <ul className="grid grid-cols-2 gap-1 text-xs">
              {flags.map((f) => {
                const enabled = (cuenta as any)[f.key] as boolean;
                return (
                  <li
                    key={f.key}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${
                      enabled
                        ? "bg-cehta-green/8 text-cehta-green"
                        : "bg-ink-50 text-ink-400"
                    }`}
                  >
                    {enabled ? (
                      <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                    ) : (
                      <span className="inline-block h-3 w-3 rounded-full ring-1 ring-current opacity-30" />
                    )}
                    {f.label}
                  </li>
                );
              })}
            </ul>
          </Section>

          {cuenta.codigo_padre && (
            <Section title="Cuenta padre">
              <code className="font-mono text-xs">{cuenta.codigo_padre}</code>
            </Section>
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-ink-50/40 p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
        {title}
      </p>
      {children}
    </div>
  );
}
