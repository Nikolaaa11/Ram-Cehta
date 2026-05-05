"use client";

/**
 * /admin/estados-financieros
 *
 * Vault cross-empresa de Estados Financieros (Balance, EERR, Flujo de
 * Caja, Cambios de Patrimonio, Consolidados, Notas) para las empresas
 * portfolio del FIP CEHTA. Sincroniza desde Dropbox bajo
 * `/Cehta Capital/01-Empresas/{cod}/04-Financiero/Estados Financieros/`
 * (subcarpetas Mensuales, Trimestrales, Semestrales, Anuales).
 *
 * Funcionalidad V5 (mínima):
 *  - Lista cross-empresa con filtros (empresa, tipo, periodo, auditado).
 *  - Botón crear → modal con form (mismo lenguaje visual /policies-fondo).
 *  - Acción rápida: link Dropbox / borrar fila.
 *
 * El sync masivo se dispara desde el ETL principal (no desde esta UI).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileBarChart,
  FileText,
  Layers,
  Plus,
  ScrollText,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import {
  AdminEmptyState,
  AdminFilteredEmpty,
} from "@/components/admin/AdminEmptyState";
import type {
  EstadoFinanciero,
  PeriodoTipo,
  TipoEf,
} from "@/lib/api/schema";

const TIPOS_EF = [
  {
    value: "balance" as const,
    label: "Balance",
    icon: FileBarChart,
    badge: "bg-cehta-green/10 text-cehta-green border-cehta-green/30",
  },
  {
    value: "estado_resultados" as const,
    label: "Estado de Resultados",
    icon: TrendingUp,
    badge: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  },
  {
    value: "flujo_caja" as const,
    label: "Flujo de Caja",
    icon: Activity,
    badge: "bg-violet-500/10 text-violet-700 border-violet-500/30",
  },
  {
    value: "cambios_patrimonio" as const,
    label: "Cambios de Patrimonio",
    icon: Layers,
    badge: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  },
  {
    value: "consolidado" as const,
    label: "Consolidado",
    icon: BookOpen,
    badge: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  },
  {
    value: "notas" as const,
    label: "Notas",
    icon: ScrollText,
    badge: "bg-ink-100 text-ink-600 border-hairline",
  },
] as const;

const PERIODO_TIPOS: { value: PeriodoTipo; label: string }[] = [
  { value: "mensual", label: "Mensual" },
  { value: "trimestral", label: "Trimestral" },
  { value: "semestral", label: "Semestral" },
  { value: "anual", label: "Anual" },
];

const FALLBACK_TIPO = TIPOS_EF[0];

const tipoMeta = (t: TipoEf): (typeof TIPOS_EF)[number] => {
  for (const x of TIPOS_EF) {
    if (x.value === t) return x;
  }
  return FALLBACK_TIPO;
};

interface EmpresaCatalogo {
  codigo: string;
  razon_social: string;
  oc_prefix: string | null;
  rut: string | null;
}

// Paleta de colores estable por hash del código de empresa — Apple-tier:
// cada empresa tiene un badge consistente sin necesidad de configurar uno
// por una.
const EMPRESA_PALETTE = [
  "bg-cehta-green/10 text-cehta-green border-cehta-green/30",
  "bg-blue-500/10 text-blue-700 border-blue-500/30",
  "bg-violet-500/10 text-violet-700 border-violet-500/30",
  "bg-amber-500/10 text-amber-700 border-amber-500/30",
  "bg-rose-500/10 text-rose-700 border-rose-500/30",
  "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  "bg-cyan-500/10 text-cyan-700 border-cyan-500/30",
  "bg-fuchsia-500/10 text-fuchsia-700 border-fuchsia-500/30",
];

const empresaBadge = (codigo: string): string => {
  let hash = 0;
  for (let i = 0; i < codigo.length; i++) {
    hash = (hash * 31 + codigo.charCodeAt(i)) >>> 0;
  }
  // El módulo siempre cae dentro del array (length > 0 y constante).
  return (
    EMPRESA_PALETTE[hash % EMPRESA_PALETTE.length] ?? EMPRESA_PALETTE[0]!
  );
};

export default function EstadosFinancierosPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [empresaFilter, setEmpresaFilter] = useState<string>("");
  const [tipoFilter, setTipoFilter] = useState<TipoEf | "">("");
  const [periodoTipoFilter, setPeriodoTipoFilter] = useState<PeriodoTipo | "">(
    "",
  );
  const [auditadoFilter, setAuditadoFilter] = useState<boolean>(false);
  const [showCreate, setShowCreate] = useState(false);

  // Catálogo de empresas para el dropdown de filtro y form
  const { data: empresas } = useQuery<EmpresaCatalogo[]>({
    queryKey: ["empresas-catalogo"],
    queryFn: async () =>
      apiClient.get<EmpresaCatalogo[]>("/empresas", session),
    enabled: !!session,
    staleTime: 5 * 60 * 1000,
  });

  const { data: efs, isLoading } = useQuery<EstadoFinanciero[]>({
    queryKey: [
      "estados-financieros",
      empresaFilter,
      tipoFilter,
      periodoTipoFilter,
      auditadoFilter,
    ],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (empresaFilter) qs.set("empresa_codigo", empresaFilter);
      if (tipoFilter) qs.set("tipo_ef", tipoFilter);
      if (periodoTipoFilter) qs.set("periodo_tipo", periodoTipoFilter);
      if (auditadoFilter) qs.set("auditado", "true");
      const path = `/estados-financieros${qs.toString() ? `?${qs}` : ""}`;
      return apiClient.get<EstadoFinanciero[]>(path, session);
    },
    enabled: !!session,
  });

  const deleteMutation = useMutation({
    mutationFn: async (ef_id: number) =>
      apiClient.delete<void>(`/estados-financieros/${ef_id}`, session),
    onSuccess: () => {
      toast.success("EEFF eliminado");
      qc.invalidateQueries({ queryKey: ["estados-financieros"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error");
    },
  });

  const filtered = efs ?? [];

  const totalPendientesAuditar = useMemo(
    () => filtered.filter((e) => !e.auditado).length,
    [filtered],
  );

  return (
    <div className="space-y-8 p-6">
      {/* Hero editorial */}
      <header className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
          Estados financieros · Portafolio
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
          EEFF cross-empresa
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-600">
          Balance, Estado de Resultados, Flujo de Caja, Cambios de
          Patrimonio, Consolidados y Notas de las empresas portfolio del
          FIP CEHTA. Sincronizado desde Dropbox{" "}
          <code className="rounded bg-ink-100 px-1 py-0.5 text-[11px] text-ink-700">
            01-Empresas/&#123;cod&#125;/04-Financiero/Estados Financieros/
          </code>{" "}
          y enriquecido con metadata de auditoría y aprobación de directorio.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-cehta-green-700"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Nuevo EEFF
          </button>
        </div>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={empresaFilter}
          onChange={(e) => setEmpresaFilter(e.target.value)}
          className="rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          <option value="">Todas las empresas</option>
          {(empresas ?? []).map((e) => (
            <option key={e.codigo} value={e.codigo}>
              {e.codigo} — {e.razon_social}
            </option>
          ))}
        </select>
        <select
          value={tipoFilter}
          onChange={(e) => setTipoFilter(e.target.value as TipoEf | "")}
          className="rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          <option value="">Todos los tipos</option>
          {TIPOS_EF.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={periodoTipoFilter}
          onChange={(e) =>
            setPeriodoTipoFilter(e.target.value as PeriodoTipo | "")
          }
          className="rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          <option value="">Todos los periodos</option>
          {PERIODO_TIPOS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={auditadoFilter}
            onChange={(e) => setAuditadoFilter(e.target.checked)}
            className="h-4 w-4 rounded border-hairline text-cehta-green focus:ring-cehta-green"
          />
          Solo auditados
        </label>
        {totalPendientesAuditar > 0 && !auditadoFilter && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
            {totalPendientesAuditar} sin auditar en la lista
          </span>
        )}
      </div>

      {/* Lista */}
      {isLoading ? (
        <p className="text-sm text-ink-500">Cargando…</p>
      ) : filtered.length === 0 ? (
        empresaFilter || tipoFilter || periodoTipoFilter || auditadoFilter ? (
          <AdminFilteredEmpty
            message="Ningún EEFF coincide con esos filtros."
            onClear={() => {
              setEmpresaFilter("");
              setTipoFilter("");
              setPeriodoTipoFilter("");
              setAuditadoFilter(false);
            }}
          />
        ) : (
          <AdminEmptyState
            icon={<FileBarChart strokeWidth={1.5} />}
            eyebrow="Estados financieros · Portafolio"
            title="Sincronizá tus EEFF desde Dropbox"
            body="Balance, Estado de Resultados, Flujo de Caja y notas por empresa portfolio + período. El ETL hourly los importa solo desde /04-Financiero/Estados Financieros/, también podés subirlos manualmente."
            ctaLabel="Cargar primer EEFF"
            onCta={() => setShowCreate(true)}
            hint="El próximo run del ETL hourly va a sincronizar los archivos que ya tengas en Dropbox."
          />
        )
      ) : (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Tipo EF</th>
                <th className="px-4 py-3">Periodo</th>
                <th className="px-4 py-3">Fecha corte</th>
                <th className="px-4 py-3">Auditado</th>
                <th className="px-4 py-3">Aprobado dir.</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {filtered.map((ef) => {
                const meta = tipoMeta(ef.tipo_ef);
                const Icon = meta.icon;
                return (
                  <tr key={ef.ef_id} className="hover:bg-ink-50/40">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${empresaBadge(
                          ef.empresa_codigo,
                        )}`}
                      >
                        {ef.empresa_codigo}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${meta.badge}`}
                      >
                        <Icon className="h-3 w-3" strokeWidth={1.75} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-ink-900">
                      {ef.periodo}
                      <span className="ml-1 text-[10px] font-normal uppercase tracking-wider text-ink-400">
                        · {ef.periodo_tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {ef.fecha_corte}
                    </td>
                    <td className="px-4 py-3">
                      {ef.auditado ? (
                        <span className="inline-flex items-center gap-1 text-positive">
                          <CheckCircle2
                            className="h-4 w-4"
                            strokeWidth={2}
                          />
                          {ef.auditor ? (
                            <span className="text-xs">{ef.auditor}</span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {ef.aprobado_directorio ? (
                        <CheckCircle2
                          className="h-4 w-4 text-positive"
                          strokeWidth={2}
                        />
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-3">
                        {ef.dropbox_path ? (
                          <a
                            href={`https://www.dropbox.com/home${ef.dropbox_path}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-cehta-green hover:underline"
                            title={ef.dropbox_path}
                          >
                            <ExternalLink
                              className="h-3.5 w-3.5"
                              strokeWidth={1.75}
                            />
                            Dropbox
                          </a>
                        ) : (
                          <span className="text-xs text-ink-400">—</span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              confirm(
                                `Eliminar EEFF ${meta.label} de ${ef.empresa_codigo} (${ef.periodo})? Esta acción no se puede deshacer.`,
                              )
                            ) {
                              deleteMutation.mutate(ef.ef_id);
                            }
                          }}
                          aria-label="Eliminar EEFF"
                          className="inline-flex items-center text-negative hover:text-rose-700"
                        >
                          <Trash2
                            className="h-3.5 w-3.5"
                            strokeWidth={1.75}
                          />
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
        <CreateEfDialog
          empresas={empresas ?? []}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["estados-financieros"] });
          }}
        />
      )}
    </div>
  );
}

function CreateEfDialog({
  empresas,
  onClose,
  onCreated,
}: {
  empresas: EmpresaCatalogo[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { session } = useSession();
  const [empresaCodigo, setEmpresaCodigo] = useState(
    empresas[0]?.codigo ?? "",
  );
  const [tipoEf, setTipoEf] = useState<TipoEf>("balance");
  const [periodoTipo, setPeriodoTipo] = useState<PeriodoTipo>("trimestral");
  const [periodo, setPeriodo] = useState("");
  const [fechaCorte, setFechaCorte] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [auditado, setAuditado] = useState(false);
  const [auditor, setAuditor] = useState("");
  const [aprobadoDirectorio, setAprobadoDirectorio] = useState(false);
  const [fechaAprobacion, setFechaAprobacion] = useState("");
  const [dropboxPath, setDropboxPath] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || loading) return;
    if (!empresaCodigo || !periodo.trim()) return;
    setLoading(true);
    try {
      await apiClient.post(
        "/estados-financieros",
        {
          empresa_codigo: empresaCodigo,
          tipo_ef: tipoEf,
          periodo_tipo: periodoTipo,
          periodo: periodo.trim(),
          fecha_corte: fechaCorte,
          auditado,
          auditor: auditor.trim() || null,
          aprobado_directorio: aprobadoDirectorio,
          fecha_aprobacion: fechaAprobacion || null,
          dropbox_path: dropboxPath.trim() || null,
        },
        session,
      );
      toast.success("EEFF creado");
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
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
          Nuevo EEFF
        </h2>

        <Field label="Empresa" required>
          <select
            value={empresaCodigo}
            onChange={(e) => setEmpresaCodigo(e.target.value)}
            required
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            {empresas.length === 0 ? (
              <option value="">— sin empresas —</option>
            ) : (
              empresas.map((e) => (
                <option key={e.codigo} value={e.codigo}>
                  {e.codigo} — {e.razon_social}
                </option>
              ))
            )}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo de EEFF">
            <select
              value={tipoEf}
              onChange={(e) => setTipoEf(e.target.value as TipoEf)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              {TIPOS_EF.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tipo de periodo">
            <select
              value={periodoTipo}
              onChange={(e) =>
                setPeriodoTipo(e.target.value as PeriodoTipo)
              }
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              {PERIODO_TIPOS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Periodo" required>
            <input
              type="text"
              required
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
              placeholder="2025-Q4"
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
          <Field label="Fecha de corte" required>
            <input
              type="date"
              required
              value={fechaCorte}
              onChange={(e) => setFechaCorte(e.target.value)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-hairline bg-ink-50/60 px-3 py-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={auditado}
              onChange={(e) => setAuditado(e.target.checked)}
              className="h-4 w-4 rounded border-hairline text-cehta-green focus:ring-cehta-green"
            />
            Auditado
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-hairline bg-ink-50/60 px-3 py-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={aprobadoDirectorio}
              onChange={(e) => setAprobadoDirectorio(e.target.checked)}
              className="h-4 w-4 rounded border-hairline text-cehta-green focus:ring-cehta-green"
            />
            Aprobado directorio
          </label>
        </div>

        {auditado && (
          <Field label="Auditor">
            <input
              type="text"
              value={auditor}
              onChange={(e) => setAuditor(e.target.value)}
              placeholder="Deloitte, PwC, Interno…"
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
        )}

        {aprobadoDirectorio && (
          <Field label="Fecha aprobación">
            <input
              type="date"
              value={fechaAprobacion}
              onChange={(e) => setFechaAprobacion(e.target.value)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
        )}

        <Field label="Path Dropbox (opcional)">
          <input
            type="text"
            value={dropboxPath}
            onChange={(e) => setDropboxPath(e.target.value)}
            placeholder="/Cehta Capital/01-Empresas/REVTECH/04-Financiero/Estados Financieros/Trimestrales/2025-Q4-balance.pdf"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </Field>

        <button
          type="submit"
          disabled={loading || !empresaCodigo || !periodo.trim()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-60"
        >
          <FileText className="h-4 w-4" strokeWidth={2} />
          {loading ? "Creando…" : "Crear EEFF"}
        </button>
      </form>
    </div>
  );
}

function Field({
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
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
        {required && <span className="ml-0.5 text-negative">*</span>}
      </label>
      {children}
    </div>
  );
}
