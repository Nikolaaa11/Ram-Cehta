"use client";

/**
 * /admin/user-company-roles
 *
 * Asignación de roles operativos por empresa: GG, COO, CONTADOR,
 * OPERADOR, DIRECTOR, TESORERIA. Un usuario puede tener distintos
 * roles en distintas empresas.
 *
 * Vista: tabla agrupada por empresa, cada fila = un (user × empresa × rol).
 * Acciones: crear asignación + revocar (soft-delete preserva audit).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { AdminEmptyState } from "@/components/admin/AdminEmptyState";
import type { CompanyRole, UserCompanyRole } from "@/lib/api/schema";

interface Empresa {
  codigo: string;
  razon_social: string;
}

const ROLES: { value: CompanyRole; label: string }[] = [
  { value: "GG", label: "Gerente General" },
  { value: "COO", label: "COO / Compliance" },
  { value: "CONTADOR", label: "Contador" },
  { value: "OPERADOR", label: "Operador" },
  { value: "DIRECTOR", label: "Director" },
  { value: "TESORERIA", label: "Tesorería" },
];

const ROLE_COLOR: Record<CompanyRole, string> = {
  GG: "bg-cehta-green/10 text-cehta-green ring-cehta-green/20",
  COO: "bg-purple-100 text-purple-700 ring-purple-200",
  CONTADOR: "bg-amber-100 text-amber-700 ring-amber-200",
  OPERADOR: "bg-slate-100 text-slate-700 ring-slate-200",
  DIRECTOR: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  TESORERIA: "bg-cyan-100 text-cyan-700 ring-cyan-200",
};

export default function UserCompanyRolesPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [empresaFilter, setEmpresaFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const { data: empresas } = useQuery<Empresa[]>({
    queryKey: ["empresas"],
    queryFn: () => apiClient.get<Empresa[]>("/empresa", session),
    enabled: !!session,
  });

  const { data: assignments, isLoading } = useQuery<UserCompanyRole[]>({
    queryKey: ["user-company-roles", empresaFilter],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (empresaFilter) qs.set("empresa_codigo", empresaFilter);
      qs.set("only_active", "true");
      return apiClient.get<UserCompanyRole[]>(
        `/admin/user-company-roles?${qs}`,
        session,
      );
    },
    enabled: !!session,
  });

  const revokeMut = useMutation({
    mutationFn: async (params: {
      user_id: string;
      empresa_codigo: string;
      role: CompanyRole;
    }) => {
      const qs = new URLSearchParams({
        user_id: params.user_id,
        empresa_codigo: params.empresa_codigo,
        role: params.role,
      });
      return apiClient.delete<void>(
        `/admin/user-company-roles?${qs}`,
        session,
      );
    },
    onSuccess: () => {
      toast.success("Rol revocado");
      qc.invalidateQueries({ queryKey: ["user-company-roles"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo revocar",
      );
    },
  });

  // Filtro local por search en user_id
  const filtered = useMemo(() => {
    if (!assignments) return [];
    if (!search.trim()) return assignments;
    const q = search.toLowerCase();
    return assignments.filter((a) =>
      a.user_id.toLowerCase().includes(q),
    );
  }, [assignments, search]);

  // Agrupar por empresa
  const grouped = useMemo(() => {
    const map = new Map<string, UserCompanyRole[]>();
    for (const a of filtered) {
      if (!map.has(a.empresa_codigo)) map.set(a.empresa_codigo, []);
      map.get(a.empresa_codigo)!.push(a);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // KPIs
  const kpis = useMemo(() => {
    const counters: Record<CompanyRole, number> = {
      GG: 0, COO: 0, CONTADOR: 0, OPERADOR: 0, DIRECTOR: 0, TESORERIA: 0,
    };
    for (const a of filtered) counters[a.role]++;
    return counters;
  }, [filtered]);

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
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
              Roles operativos por empresa
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-[40px] sm:leading-[1.1]">
              Asignaciones GG / COO / Director / etc.
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-600">
              Cada usuario puede ser GG en una empresa y OPERADOR en otra.
              Estos roles determinan quién puede firmar vouchers según las
              reglas de aprobación.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700"
          >
            <Plus className="h-4 w-4" strokeWidth={2.25} />
            Asignar rol
          </button>
        </header>

        {/* KPIs */}
        {filtered.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {(Object.keys(kpis) as CompanyRole[]).map((role) => (
              <div
                key={role}
                className={`rounded-xl px-3 py-2 ring-1 ring-inset ${ROLE_COLOR[role]}`}
              >
                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] opacity-70">
                  {ROLES.find((r) => r.value === role)?.label}
                </p>
                <p className="mt-0.5 font-display text-xl font-semibold tabular-nums">
                  {kpis[role]}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-hairline bg-white p-4">
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
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" strokeWidth={1.75} />
            <input
              type="text"
              placeholder="Buscar por user_id (UUID)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 pl-9 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
        </div>

        {/* Lista agrupada por empresa */}
        {isLoading ? (
          <p className="text-sm text-ink-500">Cargando asignaciones…</p>
        ) : grouped.length === 0 ? (
          empresaFilter || search ? (
            <p className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-ink-500">
              Sin resultados con esos filtros.
            </p>
          ) : (
            <AdminEmptyState
              icon={<UserCog strokeWidth={1.5} />}
              eyebrow="Roles · Sin asignaciones"
              title="Asigná roles para habilitar firmas"
              body="Sin roles, los vouchers PENDING no pueden aprobarse aunque las reglas estén configuradas. Asigná al menos un GG por empresa para empezar."
              ctaLabel="Asignar primer rol"
              onCta={() => setShowCreate(true)}
              hint="user_id es el UUID de Supabase Auth — copialo desde /admin/usuarios."
            />
          )
        ) : (
          <div className="space-y-4">
            {grouped.map(([empresaCodigo, items]) => (
              <div
                key={empresaCodigo}
                className="overflow-hidden rounded-2xl border border-hairline bg-white"
              >
                <header className="flex items-center gap-2 border-b border-hairline bg-ink-50/40 px-4 py-2">
                  <Building2 className="h-3.5 w-3.5 text-ink-500" strokeWidth={1.75} />
                  <span className="font-mono text-xs font-semibold tabular-nums text-ink-700">
                    {empresaCodigo}
                  </span>
                  <span className="text-[10px] text-ink-500">
                    · {items.length} {items.length === 1 ? "asignación" : "asignaciones"}
                  </span>
                </header>
                <table className="w-full text-sm">
                  <thead className="text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                    <tr>
                      <th className="px-4 py-2">Rol</th>
                      <th className="px-4 py-2">User ID</th>
                      <th className="px-4 py-2">Asignado</th>
                      <th className="px-4 py-2">Notas</th>
                      <th className="px-4 py-2 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {items.map((a) => (
                      <tr key={`${a.user_id}-${a.role}`}>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${ROLE_COLOR[a.role]}`}
                          >
                            {a.role}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-[10px] tabular-nums text-ink-600">
                          {a.user_id}
                        </td>
                        <td className="px-4 py-2 font-mono text-[10px] tabular-nums text-ink-500">
                          {new Date(a.assigned_at).toLocaleDateString("es-CL")}
                        </td>
                        <td className="px-4 py-2 text-xs text-ink-600">
                          {a.notas ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              if (
                                confirm(
                                  `Revocar rol ${a.role} de este usuario en ${empresaCodigo}? Soft-delete (preserva audit).`,
                                )
                              ) {
                                revokeMut.mutate({
                                  user_id: a.user_id,
                                  empresa_codigo: a.empresa_codigo,
                                  role: a.role,
                                });
                              }
                            }}
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-negative hover:bg-negative/10"
                            title="Revocar"
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}

        {showCreate && (
          <CreateAssignmentDialog
            empresas={empresas ?? []}
            onClose={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false);
              qc.invalidateQueries({ queryKey: ["user-company-roles"] });
            }}
          />
        )}
      </div>
    </div>
  );
}

function CreateAssignmentDialog({
  empresas,
  onClose,
  onCreated,
}: {
  empresas: Empresa[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { session } = useSession();
  const [userId, setUserId] = useState("");
  const [empresa, setEmpresa] = useState(empresas[0]?.codigo ?? "");
  const [role, setRole] = useState<CompanyRole>("GG");
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    if (!userId.trim()) {
      toast.error("Ingresá el UUID del usuario");
      return;
    }
    setLoading(true);
    try {
      await apiClient.post(
        "/admin/user-company-roles",
        {
          user_id: userId.trim(),
          empresa_codigo: empresa,
          role,
          notas: notas.trim() || null,
        },
        session,
      );
      toast.success("Rol asignado");
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
        className="relative w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
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
          Asignar rol operativo
        </h2>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            User ID (UUID Supabase) <span className="text-negative">*</span>
          </label>
          <input
            type="text"
            required
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="b4307866-f9c9-4230-aad6-41b61d07a830"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 font-mono text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
          <p className="mt-1 text-[10px] italic text-ink-400">
            Copialo desde /admin/usuarios — columna ID
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              Empresa <span className="text-negative">*</span>
            </label>
            <select
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              required
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              {empresas.map((e) => (
                <option key={e.codigo} value={e.codigo}>
                  {e.codigo}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              Rol <span className="text-negative">*</span>
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as CompanyRole)}
              required
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.value} · {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            Notas (opcional)
          </label>
          <input
            type="text"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Asignación temporal hasta fin de Q1"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !userId.trim()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-60"
        >
          <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
          {loading ? "Asignando…" : "Asignar rol"}
        </button>

        <CheckCircle2 className="hidden" />
      </form>
    </div>
  );
}
