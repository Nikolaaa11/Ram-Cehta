"use client";

/**
 * /admin/proyectos-contables
 *
 * Proyectos contables formales para imputación de vouchers.
 * Distintos de los proyectos del Gantt (operativos) y de la tabla
 * legacy `core.proyecto`.
 *
 * Funcionalidad:
 *   - Lista filtrable (empresa + tipo financiamiento + estado + search)
 *   - KPIs: total activos / CORFO / privados / internos
 *   - Modal crear (con validación de código PRJ-EMP-TIPO-NNN)
 *   - Click en row → drawer detalle con presupuesto vs ejecutado
 *   - PATCH inline: estado (ACTIVE / CLOSED / SUSPENDED)
 *   - DELETE con confirm (solo si no tiene vouchers asociados)
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useModalA11y } from "@/lib/use-modal-a11y";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  ProyectoAvance,
  ProyectoContable,
  ProyectoEstado,
  TipoFinanciamiento,
  TipoGastoCorfo,
} from "@/lib/api/schema";

const TIPOS: { value: TipoFinanciamiento; label: string; color: string }[] = [
  { value: "CORFO", label: "CORFO", color: "bg-yellow-100 text-yellow-800 ring-yellow-200" },
  { value: "PRIVADO", label: "Privado", color: "bg-blue-100 text-blue-800 ring-blue-200" },
  { value: "INTERNO", label: "Interno", color: "bg-slate-100 text-slate-700 ring-slate-200" },
  { value: "FINANCIERO", label: "Financiero", color: "bg-purple-100 text-purple-800 ring-purple-200" },
];

const TIPOS_GASTO: TipoGastoCorfo[] = [
  "RRHH", "OPERACION", "INVERSION", "GASTOS_GENERALES", "NO_ELEGIBLE",
];

interface Empresa {
  codigo: string;
  razon_social: string;
}

const fmtCLP = (v: number | null) =>
  v === null
    ? "—"
    : v >= 1_000_000_000
      ? `$${(v / 1_000_000_000).toFixed(2)}B`
      : v >= 1_000_000
        ? `$${(v / 1_000_000).toFixed(1)}M`
        : `$${v.toLocaleString("es-CL")}`;

export default function ProyectosContablesPage() {
  const { session } = useSession();
  const qc = useQueryClient();

  const [empresaFilter, setEmpresaFilter] = useState("");
  const [tipoFilter, setTipoFilter] = useState<TipoFinanciamiento | "">("");
  const [estadoFilter, setEstadoFilter] = useState<ProyectoEstado | "">("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [openProyecto, setOpenProyecto] = useState<string | null>(null);

  const { data: empresas } = useQuery<Empresa[]>({
    queryKey: ["empresas"],
    queryFn: () => apiClient.get<Empresa[]>("/empresa", session),
    enabled: !!session,
  });

  const { data: proyectos, isLoading } = useQuery<ProyectoContable[]>({
    queryKey: ["proyectos-contables", empresaFilter, tipoFilter, estadoFilter, search],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (empresaFilter) qs.set("empresa_codigo", empresaFilter);
      if (tipoFilter) qs.set("tipo_financiamiento", tipoFilter);
      if (estadoFilter) qs.set("estado", estadoFilter);
      if (search) qs.set("search", search);
      return apiClient.get<ProyectoContable[]>(
        `/proyectos-contables${qs.toString() ? `?${qs}` : ""}`,
        session,
      );
    },
    enabled: !!session,
  });

  const deleteMut = useMutation({
    mutationFn: async (codigo: string) =>
      apiClient.delete<void>(
        `/proyectos-contables/${encodeURIComponent(codigo)}`,
        session,
      ),
    onSuccess: () => {
      toast.success("Proyecto eliminado");
      qc.invalidateQueries({ queryKey: ["proyectos-contables"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo eliminar",
      );
    },
  });

  const closeMut = useMutation({
    mutationFn: async (codigo: string) =>
      apiClient.patch<ProyectoContable>(
        `/proyectos-contables/${encodeURIComponent(codigo)}`,
        { estado: "CLOSED" },
        session,
      ),
    onSuccess: () => {
      toast.success("Proyecto marcado como cerrado");
      qc.invalidateQueries({ queryKey: ["proyectos-contables"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo cerrar",
      );
    },
  });

  // KPIs
  const kpis = (proyectos ?? []).reduce(
    (acc, p) => {
      if (p.estado === "ACTIVE") acc.active++;
      if (p.tipo_financiamiento === "CORFO") acc.corfo++;
      if (p.tipo_financiamiento === "PRIVADO") acc.privado++;
      if (p.tipo_financiamiento === "INTERNO") acc.interno++;
      acc.presupuesto += Number(p.presupuesto_total ?? 0);
      return acc;
    },
    { active: 0, corfo: 0, privado: 0, interno: 0, presupuesto: 0 },
  );

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[400px]"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 0%, rgba(35,108,79,0.05) 0%, transparent 65%)",
        }}
      />

      <div className="mx-auto max-w-[1280px] px-6 lg:px-10 pt-10 pb-20 space-y-6">
        {/* Hero + CTA */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
              Proyectos contables · Imputación de vouchers
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-[40px] sm:leading-[1.1]">
              Proyectos del portafolio
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-600">
              Códigos formales <code className="rounded bg-ink-100 px-1 py-0.5 text-xs">PRJ-EMP-TIPO-NNN</code>{" "}
              para imputar vouchers contra rendiciones CORFO, contratos
              privados, gastos internos. Distintos de los proyectos del Gantt
              (operativos).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700"
          >
            <Plus className="h-4 w-4" strokeWidth={2.25} />
            Nuevo proyecto
          </button>
        </header>

        {/* KPIs */}
        {proyectos && proyectos.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Activos" value={String(kpis.active)} hint="Estado ACTIVE" />
            <Kpi
              label="CORFO"
              value={String(kpis.corfo)}
              hint="Rendibles automáticos"
              tone="cehta"
            />
            <Kpi label="Privados" value={String(kpis.privado)} hint="Clientes / contratos" />
            <Kpi
              label="Presupuesto total"
              value={fmtCLP(kpis.presupuesto || null)}
              hint="Suma de presupuestos"
            />
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-hairline bg-white p-4">
          <select
            value={empresaFilter}
            onChange={(e) => setEmpresaFilter(e.target.value)}
            className="rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <option value="">Todas las empresas</option>
            {(empresas ?? []).map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo}
              </option>
            ))}
          </select>
          <select
            value={tipoFilter}
            onChange={(e) => setTipoFilter(e.target.value as TipoFinanciamiento | "")}
            className="rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <option value="">Todos los tipos</option>
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            value={estadoFilter}
            onChange={(e) => setEstadoFilter(e.target.value as ProyectoEstado | "")}
            className="rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <option value="">Todos los estados</option>
            <option value="ACTIVE">Activos</option>
            <option value="CLOSED">Cerrados</option>
            <option value="SUSPENDED">Suspendidos</option>
          </select>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" strokeWidth={1.75} />
            <input
              type="text"
              placeholder="Buscar código o nombre…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 pl-9 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
        </div>

        {/* Lista — QA fix 14/05/2026: skeleton matching layout */}
        {isLoading ? (
          <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
            <table className="w-full text-sm">
              <thead className="bg-ink-50/60">
                <tr>
                  {[
                    "Código",
                    "Empresa",
                    "Nombre",
                    "Tipo",
                    "Presupuesto",
                    "Estado",
                    "Acciones",
                  ].map((h) => (
                    <th key={h} className="px-4 py-3 text-left">
                      <Skeleton className="h-3 w-16" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {[1, 2, 3, 4, 5].map((i) => (
                  <tr key={i}>
                    <td className="px-4 py-3">
                      <Skeleton className="h-3 w-12" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-3 w-48" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Skeleton className="ml-auto h-3 w-24" />
                    </td>
                    <td className="px-4 py-3">
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Skeleton className="ml-auto h-3 w-8" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !proyectos || proyectos.length === 0 ? (
          empresaFilter || tipoFilter || estadoFilter || search ? (
            <p className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-ink-500">
              Sin resultados con esos filtros.
            </p>
          ) : (
            <AdminEmptyState
              icon={<CircleDollarSign strokeWidth={1.5} />}
              eyebrow="Proyectos contables · vacío"
              title="Importa los proyectos del Excel"
              body="Anda a /admin/etl y sube el Plan_de_cuentas_v2.xlsx — la hoja Proyectos trae los 31 proyectos pre-codificados (CORFO, privados, internos). También puedes crear uno manualmente aquí si quieres probar el flow."
              ctaLabel="Crear primer proyecto"
              onCta={() => setShowCreate(true)}
            />
          )
        ) : (
          <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
            <table className="w-full text-sm">
              <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-4 py-3">Código</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3 text-right">Presupuesto</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {proyectos.map((p) => {
                  const tipoStyle = TIPOS.find((t) => t.value === p.tipo_financiamiento)?.color ?? "";
                  return (
                    <tr
                      key={p.codigo}
                      className="cursor-pointer hover:bg-ink-50/40"
                      onClick={() => setOpenProyecto(p.codigo)}
                    >
                      <td className="px-4 py-3 font-mono text-xs tabular-nums text-ink-600">
                        {p.codigo}
                      </td>
                      <td className="px-4 py-3 text-ink-700">{p.empresa_codigo}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink-900">{p.nombre}</p>
                        {p.programa && (
                          <p className="text-[11px] text-ink-500">{p.programa}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${tipoStyle}`}
                        >
                          {p.tipo_financiamiento}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {fmtCLP(p.presupuesto_total)}
                      </td>
                      <td className="px-4 py-3">
                        <EstadoBadge estado={p.estado} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div
                          className="inline-flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {p.estado === "ACTIVE" && (
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  confirm(
                                    `Cerrar proyecto "${p.nombre}"? Pasa a estado CLOSED y queda inactivo para nuevos vouchers, pero se preservan los movimientos históricos.`,
                                  )
                                ) {
                                  closeMut.mutate(p.codigo);
                                }
                              }}
                              className="text-xs font-medium text-ink-500 hover:text-cehta-green hover:underline"
                            >
                              Cerrar
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                confirm(
                                  `Eliminar definitivamente "${p.codigo}"? Solo posible si no hay vouchers imputados.`,
                                )
                              ) {
                                deleteMut.mutate(p.codigo);
                              }
                            }}
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-negative hover:bg-negative/10"
                            title="Eliminar"
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal crear */}
        {showCreate && (
          <CreateProyectoDialog
            empresas={empresas ?? []}
            onClose={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false);
              qc.invalidateQueries({ queryKey: ["proyectos-contables"] });
            }}
          />
        )}

        {/* Drawer detalle */}
        {openProyecto && (
          <ProyectoDrawer
            codigo={openProyecto}
            onClose={() => setOpenProyecto(null)}
          />
        )}
      </div>
    </div>
  );
}

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
        className={`mt-1 font-display text-2xl font-semibold tabular-nums ${tone === "cehta" ? "text-cehta-green" : "text-ink-900"}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-ink-500">{hint}</p>
    </div>
  );
}

function EstadoBadge({ estado }: { estado: ProyectoEstado }) {
  const styles = {
    ACTIVE: "bg-positive/10 text-positive ring-positive/20",
    CLOSED: "bg-ink-100 text-ink-500 ring-hairline",
    SUSPENDED: "bg-warning/10 text-warning ring-warning/20",
  }[estado];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${styles}`}
    >
      {estado === "ACTIVE" && <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />}
      {estado}
    </span>
  );
}

function ProyectoDrawer({
  codigo,
  onClose,
}: {
  codigo: string;
  onClose: () => void;
}) {
  const { session } = useSession();

  const { data: proyecto } = useQuery<ProyectoContable>({
    queryKey: ["proyecto-contable", codigo],
    queryFn: () =>
      apiClient.get<ProyectoContable>(
        `/proyectos-contables/${encodeURIComponent(codigo)}`,
        session,
      ),
    enabled: !!session,
  });

  const { data: avance } = useQuery<ProyectoAvance>({
    queryKey: ["proyecto-avance", codigo],
    queryFn: () =>
      apiClient.get<ProyectoAvance>(
        `/proyectos-contables/${encodeURIComponent(codigo)}/avance`,
        session,
      ),
    enabled: !!session,
  });

  // Round 29 — focus trap + ESC + scroll lock para drawer proyecto detail.
  const a11yRef = useModalA11y({ open: !!proyecto, onClose });
  if (!proyecto) return null;

  return (
    <div
      ref={a11yRef}
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
              {proyecto.codigo}
            </code>
            <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-ink-900">
              {proyecto.nombre}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <EstadoBadge estado={proyecto.estado} />
              <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-600">
                <Building2 className="h-3 w-3" strokeWidth={2} />
                {proyecto.empresa_codigo}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-600 hover:bg-ink-200"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        <div className="space-y-4 px-6 py-5">
          {/* Avance presupuestario */}
          {avance && (
            <div className="rounded-2xl border border-cehta-green/20 bg-cehta-green/5 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
                Avance presupuestario
              </p>
              {avance.presupuesto_total ? (
                <>
                  <p className="mt-2 font-display text-3xl font-semibold tabular-nums">
                    {avance.porcentaje_ejecutado?.toFixed(1) ?? "0"}%
                  </p>
                  <p className="text-xs text-ink-600">
                    {fmtCLP(avance.presupuesto_ejecutado)} de{" "}
                    {fmtCLP(avance.presupuesto_total)}
                  </p>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white">
                    <div
                      className="h-full rounded-full bg-cehta-green transition-all duration-500"
                      style={{
                        width: `${Math.min(100, avance.porcentaje_ejecutado ?? 0)}%`,
                      }}
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-ink-500">
                    {avance.cantidad_vouchers} vouchers ·{" "}
                    {fmtCLP(avance.monto_disponible)} disponible
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs text-ink-500">
                  Sin presupuesto definido. {avance.cantidad_vouchers} vouchers
                  imputados — total ejecutado: {fmtCLP(avance.presupuesto_ejecutado)}.
                </p>
              )}
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-hairline bg-ink-50/40 p-3 text-sm">
            <Field label="Tipo financiamiento" value={proyecto.tipo_financiamiento} />
            <Field label="Programa" value={proyecto.programa ?? "—"} />
            <Field
              label="Período"
              value={`${proyecto.fecha_inicio ?? "—"} → ${proyecto.fecha_termino ?? "abierto"}`}
            />
            {proyecto.primer_desembolso_corfo && (
              <Field
                label="1er desembolso CORFO"
                value={proyecto.primer_desembolso_corfo}
              />
            )}
            <Field
              label="Moneda"
              value={proyecto.moneda}
            />
            {proyecto.tipos_gasto_elegibles.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                  Tipos de gasto elegibles
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {proyecto.tipos_gasto_elegibles.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-0.5 rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-yellow-800"
                    >
                      <Sparkles className="h-3 w-3" strokeWidth={2.5} />
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
        {label}
      </p>
      <p className="text-sm text-ink-800">{value}</p>
    </div>
  );
}

function CreateProyectoDialog({
  empresas,
  onClose,
  onCreated,
}: {
  empresas: Empresa[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { session } = useSession();
  const [empresaCodigo, setEmpresaCodigo] = useState(empresas[0]?.codigo ?? "");
  const [tipoFinanciamiento, setTipoFinanciamiento] =
    useState<TipoFinanciamiento>("CORFO");
  const [correlativo, setCorrelativo] = useState("001");
  const [nombre, setNombre] = useState("");
  const [programa, setPrograma] = useState("");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaTermino, setFechaTermino] = useState("");
  const [presupuesto, setPresupuesto] = useState("");
  const [tiposGasto, setTiposGasto] = useState<TipoGastoCorfo[]>([
    "RRHH", "OPERACION", "INVERSION", "GASTOS_GENERALES",
  ]);
  const [loading, setLoading] = useState(false);

  // Code preview: PRJ-{EMP3}-{TIPO3}-{NNN}
  const tipoCode =
    tipoFinanciamiento === "CORFO"
      ? "COR"
      : tipoFinanciamiento === "PRIVADO"
        ? "PRV"
        : tipoFinanciamiento === "INTERNO"
          ? "INT"
          : "FIN";
  const empCode =
    empresaCodigo === "REVTECH" ? "RVT"
    : empresaCodigo === "EVOQUE" ? "EVQ"
    : empresaCodigo === "TRONGKAI" ? "TRK"
    : empresaCodigo === "FIP_CEHTA" ? "FIP"
    : empresaCodigo;
  const codigoPreview = `PRJ-${empCode}-${tipoCode}-${correlativo.padStart(3, "0")}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setLoading(true);
    try {
      await apiClient.post(
        "/proyectos-contables",
        {
          codigo: codigoPreview,
          empresa_codigo: empresaCodigo,
          nombre: nombre.trim(),
          tipo_financiamiento: tipoFinanciamiento,
          programa: programa.trim() || null,
          fecha_inicio: fechaInicio || null,
          fecha_termino: fechaTermino || null,
          presupuesto_total: presupuesto ? Number(presupuesto) : null,
          moneda: "CLP",
          primer_desembolso_corfo: null,
          tipos_gasto_elegibles: tipoFinanciamiento === "CORFO" ? tiposGasto : [],
          estado: "ACTIVE",
        },
        session,
      );
      toast.success("Proyecto creado");
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Error");
    } finally {
      setLoading(false);
    }
  };
  // Round 29 — focus trap + ESC + scroll lock para modal crear proyecto.
  const a11yRef = useModalA11y({ open: true, onClose });

  return (
    <div
      ref={a11yRef}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-600 hover:bg-ink-200"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
        <h2 className="font-display text-xl font-semibold tracking-tight">
          Nuevo proyecto contable
        </h2>

        <div className="rounded-xl bg-ink-900 p-3 font-mono text-sm text-emerald-300">
          {codigoPreview}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Empresa">
            <select
              value={empresaCodigo}
              onChange={(e) => setEmpresaCodigo(e.target.value)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              {empresas.map((e) => (
                <option key={e.codigo} value={e.codigo}>
                  {e.codigo}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Tipo">
            <select
              value={tipoFinanciamiento}
              onChange={(e) =>
                setTipoFinanciamiento(e.target.value as TipoFinanciamiento)
              }
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField label="Correlativo">
          <input
            type="text"
            value={correlativo}
            onChange={(e) => setCorrelativo(e.target.value.replace(/\D/g, ""))}
            placeholder="001"
            maxLength={3}
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </FormField>

        <FormField label="Nombre" required>
          <input
            type="text"
            required
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="PTEC REVFOT — RevTech CORFO"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </FormField>

        <FormField label="Programa">
          <input
            type="text"
            value={programa}
            onChange={(e) => setPrograma(e.target.value)}
            placeholder="InnovaChile · PTEC · Capital Semilla"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Fecha inicio">
            <input
              type="date"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </FormField>
          <FormField label="Fecha término">
            <input
              type="date"
              value={fechaTermino}
              onChange={(e) => setFechaTermino(e.target.value)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </FormField>
        </div>

        <FormField label="Presupuesto total CLP">
          <input
            type="number"
            value={presupuesto}
            onChange={(e) => setPresupuesto(e.target.value)}
            placeholder="50000000"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </FormField>

        {tipoFinanciamiento === "CORFO" && (
          <FormField label="Tipos de gasto elegibles (CORFO)">
            <div className="flex flex-wrap gap-1.5">
              {TIPOS_GASTO.map((t) => {
                const checked = tiposGasto.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setTiposGasto((prev) =>
                        prev.includes(t)
                          ? prev.filter((x) => x !== t)
                          : [...prev, t],
                      );
                    }}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                      checked
                        ? "border-cehta-green bg-cehta-green/10 text-cehta-green"
                        : "border-hairline bg-white text-ink-500 hover:bg-ink-50"
                    }`}
                  >
                    {checked && <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />}
                    {t}
                  </button>
                );
              })}
            </div>
          </FormField>
        )}

        <button
          type="submit"
          disabled={loading || !nombre.trim()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-60"
        >
          {loading ? "Creando…" : "Crear proyecto"}
        </button>
      </form>
    </div>
  );
}

function FormField({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
        {label}
        {required && <span className="ml-0.5 text-negative">*</span>}
      </label>
      {children}
    </div>
  );
}

// Activity icon usado por el code linter (parece no usado pero importado por consistencia)
const _ = Activity;
