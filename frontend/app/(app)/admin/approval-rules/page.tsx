"use client";

/**
 * /admin/approval-rules
 *
 * Reglas de aprobación de vouchers por empresa. La migración 0036
 * seedeó 3 reglas default por cada empresa activa:
 *   - 0-5M sin treatment → [GG] (no reforzado)
 *   - 5M+ GASTO → [GG, COO] (reforzado)
 *   - 20M+ ACTIVACION → [GG, DIRECTOR] (reforzado)
 *
 * Esta página permite editar / agregar / eliminar reglas desde la UI.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Gavel,
  Plus,
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
  ApprovalRule,
  CompanyRole,
  VoucherTipo,
} from "@/lib/api/schema";

interface Empresa {
  codigo: string;
  razon_social: string;
}

const ROLES: CompanyRole[] = [
  "GG", "COO", "CONTADOR", "OPERADOR", "DIRECTOR", "TESORERIA",
];

const TIPOS: VoucherTipo[] = [
  "INGRESO", "EGRESO", "TRASPASO", "COMPRA", "VENTA",
  "APERTURA", "CIERRE", "REVERSO",
];

const fmtCLP = (v: number | null) => {
  if (v === null) return "Sin tope";
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  return `$${v.toLocaleString("es-CL")}`;
};

export default function ApprovalRulesPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [empresaFilter, setEmpresaFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const { data: empresas } = useQuery<Empresa[]>({
    queryKey: ["empresas"],
    queryFn: () => apiClient.get<Empresa[]>("/empresa", session),
    enabled: !!session,
  });

  const { data: rules, isLoading } = useQuery<ApprovalRule[]>({
    queryKey: ["approval-rules", empresaFilter],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (empresaFilter) qs.set("empresa_codigo", empresaFilter);
      qs.set("only_active", "false");
      return apiClient.get<ApprovalRule[]>(
        `/admin/approval-rules?${qs}`,
        session,
      );
    },
    enabled: !!session,
  });

  const deleteMut = useMutation({
    mutationFn: async (ruleId: number) =>
      apiClient.delete<void>(
        `/admin/approval-rules/${ruleId}`,
        session,
      ),
    onSuccess: () => {
      toast.success("Regla eliminada");
      qc.invalidateQueries({ queryKey: ["approval-rules"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo eliminar",
      );
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (rule: ApprovalRule) =>
      apiClient.patch<ApprovalRule>(
        `/admin/approval-rules/${rule.rule_id}`,
        { active: !rule.active },
        session,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approval-rules"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error");
    },
  });

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
              Reglas de aprobación · Vouchers
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-[40px] sm:leading-[1.1]">
              Matriz de firmas requeridas
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-600">
              Por empresa, tipo de voucher, monto y tratamiento (gasto vs
              activación). La regla de mayor prioridad (menor número) gana
              cuando varias matchean. Las reglas reforzadas exigen{" "}
              <strong>doble firma</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700"
          >
            <Plus className="h-4 w-4" strokeWidth={2.25} />
            Nueva regla
          </button>
        </header>

        {/* Filtro */}
        <div className="flex items-center gap-2 rounded-2xl border border-hairline bg-white p-4">
          <label className="text-xs font-medium text-ink-600">Empresa:</label>
          <select
            value={empresaFilter}
            onChange={(e) => setEmpresaFilter(e.target.value)}
            className="rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <option value="">Todas</option>
            {(empresas ?? []).map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo}
              </option>
            ))}
          </select>
        </div>

        {/* Lista — QA fix: skeleton matching layout */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-2xl border border-hairline bg-white p-4"
              >
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="ml-auto h-3 w-20" />
              </div>
            ))}
          </div>
        ) : !rules || rules.length === 0 ? (
          <AdminEmptyState
            icon={<Gavel strokeWidth={1.5} />}
            eyebrow="Reglas · Sin configurar"
            title="Definí la matriz de firmas"
            body="Sin reglas, los vouchers PENDING no pueden aprobarse. La migración 0036 seedea 3 reglas default por empresa al deployarse — si llegaste aquí vacío es porque las eliminaste."
            ctaLabel="Crear primera regla"
            onCta={() => setShowCreate(true)}
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
            <table className="w-full text-sm">
              <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Aplica a</th>
                  <th className="px-4 py-3">Rango monto</th>
                  <th className="px-4 py-3">Roles requeridos</th>
                  <th className="px-4 py-3">Prio</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rules.map((r) => (
                  <tr key={r.rule_id} className={!r.active ? "opacity-50" : ""}>
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.empresa_codigo}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-ink-700">
                        {r.voucher_tipo ? `Tipo: ${r.voucher_tipo}` : "Cualquier tipo"}
                      </p>
                      <p className="text-[10px] text-ink-500">
                        {r.balance_treatment ?? "Cualquier treatment"}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      {fmtCLP(r.min_amount)} → {fmtCLP(r.max_amount)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {r.required_roles.map((role, idx) => (
                          <span key={idx} className="inline-flex items-center">
                            <span className="inline-flex rounded-md bg-cehta-green/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-cehta-green ring-1 ring-cehta-green/20">
                              {role}
                            </span>
                            {idx < r.required_roles.length - 1 && (
                              <span className="mx-1 text-ink-300">+</span>
                            )}
                          </span>
                        ))}
                        {r.reinforced && (
                          <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-yellow-800">
                            <Sparkles className="h-2.5 w-2.5" strokeWidth={2.5} />
                            Reforzada
                          </span>
                        )}
                      </div>
                      {r.descripcion && (
                        <p className="mt-1 line-clamp-1 text-[10px] italic text-ink-500">
                          {r.descripcion}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-ink-500">
                      {r.priority}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleActive.mutate(r)}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset ${
                          r.active
                            ? "bg-positive/10 text-positive ring-positive/20"
                            : "bg-ink-100 text-ink-500 ring-hairline"
                        }`}
                      >
                        {r.active ? (
                          <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
                        ) : null}
                        {r.active ? "Activa" : "Inactiva"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            confirm(
                              `Eliminar regla #${r.rule_id}? Para deshabilitar sin perder datos, mejor toggle a Inactiva.`,
                            )
                          ) {
                            deleteMut.mutate(r.rule_id);
                          }
                        }}
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-negative hover:bg-negative/10"
                        title="Eliminar"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal crear */}
        {showCreate && (
          <CreateRuleDialog
            empresas={empresas ?? []}
            onClose={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false);
              qc.invalidateQueries({ queryKey: ["approval-rules"] });
            }}
          />
        )}
      </div>
    </div>
  );
}

function CreateRuleDialog({
  empresas,
  onClose,
  onCreated,
}: {
  empresas: Empresa[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { session } = useSession();
  const [empresa, setEmpresa] = useState(empresas[0]?.codigo ?? "");
  const [tipo, setTipo] = useState<VoucherTipo | "">("");
  const [minAmount, setMinAmount] = useState("0");
  const [maxAmount, setMaxAmount] = useState("");
  const [balanceTreatment, setBalanceTreatment] = useState<"GASTO" | "ACTIVACION" | "">("");
  const [requiredRoles, setRequiredRoles] = useState<CompanyRole[]>(["GG"]);
  const [reinforced, setReinforced] = useState(false);
  const [priority, setPriority] = useState("100");
  const [descripcion, setDescripcion] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    if (requiredRoles.length === 0) {
      toast.error("Elige al menos un rol");
      return;
    }
    setLoading(true);
    try {
      await apiClient.post(
        "/admin/approval-rules",
        {
          empresa_codigo: empresa,
          voucher_tipo: tipo || null,
          min_amount: Number(minAmount),
          max_amount: maxAmount ? Number(maxAmount) : null,
          balance_treatment: balanceTreatment || null,
          required_roles: requiredRoles,
          reinforced,
          priority: Number(priority),
          active: true,
          descripcion: descripcion.trim() || null,
        },
        session,
      );
      toast.success("Regla creada");
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Error");
    } finally {
      setLoading(false);
    }
  };
  // Round 26 — focus trap + ESC + scroll lock para modal crear approval rule.
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
          Nueva regla de aprobación
        </h2>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Empresa" required>
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
          </FormField>
          <FormField label="Prioridad (1-999, menor = más específica)">
            <input
              type="number"
              min={1}
              max={999}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </FormField>
        </div>

        <FormField label="Tipo de voucher (vacío = cualquier tipo)">
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as VoucherTipo | "")}
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <option value="">Cualquier tipo</option>
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Monto mínimo CLP" required>
            <input
              type="number"
              min="0"
              required
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </FormField>
          <FormField label="Monto máximo CLP (vacío = sin tope)">
            <input
              type="number"
              min="0"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              placeholder="(sin tope)"
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </FormField>
        </div>

        <FormField label="Tratamiento (vacío = cualquiera)">
          <select
            value={balanceTreatment}
            onChange={(e) =>
              setBalanceTreatment(e.target.value as "GASTO" | "ACTIVACION" | "")
            }
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            <option value="">Cualquiera (gasto o activación)</option>
            <option value="GASTO">GASTO (al ejercicio)</option>
            <option value="ACTIVACION">ACTIVACION (activo fijo)</option>
          </select>
        </FormField>

        <FormField label="Roles requeridos (en orden)" required>
          <div className="flex flex-wrap gap-1.5">
            {ROLES.map((role) => {
              const idx = requiredRoles.indexOf(role);
              const isSelected = idx >= 0;
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => {
                    if (isSelected) {
                      setRequiredRoles(requiredRoles.filter((r) => r !== role));
                    } else {
                      setRequiredRoles([...requiredRoles, role]);
                    }
                  }}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                    isSelected
                      ? "border-cehta-green bg-cehta-green/10 text-cehta-green"
                      : "border-hairline bg-white text-ink-500 hover:bg-ink-50"
                  }`}
                >
                  {isSelected && (
                    <span className="font-mono text-[9px]">{idx + 1}.</span>
                  )}
                  {role}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[10px] italic text-ink-400">
            Las firmas se requieren en este orden
          </p>
        </FormField>

        <FormField label="Descripción (opcional)">
          <input
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Reforzado: gastos sobre 5M CLP requieren GG + COO"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </FormField>

        <label className="inline-flex items-center gap-2 rounded-xl border border-yellow-200 bg-yellow-50/40 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={reinforced}
            onChange={(e) => setReinforced(e.target.checked)}
            className="h-4 w-4 accent-yellow-600"
          />
          <Sparkles className="h-3.5 w-3.5 text-yellow-700" strokeWidth={2.25} />
          Marcar como <strong>reforzada</strong> (badge especial en voucher)
        </label>

        <button
          type="submit"
          disabled={loading || requiredRoles.length === 0}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-60"
        >
          {loading ? "Creando…" : "Crear regla"}
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
