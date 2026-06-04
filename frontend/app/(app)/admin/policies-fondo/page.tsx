"use client";

/**
 * /admin/policies-fondo
 *
 * Vault de políticas internas del FIP CEHTA: reglamento interno, manual UAF,
 * código de ética, política PEP, etc. Distinto del legal vault (que es por
 * empresa portfolio). Auditable por CMF — debe ser fácilmente filtrable.
 *
 * Funcionalidad V5 (mínima):
 *  - Lista con filtros por tipo y estado
 *  - Botón crear → modal con form
 *  - Click en row → editar (toggle estado, actualizar próxima revisión)
 *  - Hint de "próximas a revisar" arriba
 *
 * NO hay borrado físico — las políticas se DEROGAN (estado='derogada') para
 * preservar historial regulatorio.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useModalA11y } from "@/lib/use-modal-a11y";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AdminEmptyState,
  AdminFilteredEmpty,
} from "@/components/admin/AdminEmptyState";

const TIPOS = [
  { value: "reglamento_interno", label: "Reglamento interno" },
  { value: "manual_uaf", label: "Manual UAF" },
  { value: "codigo_etica", label: "Código de ética" },
  { value: "politica_pep", label: "Política PEP" },
  { value: "politica_inversion", label: "Política de inversión" },
  { value: "politica_riesgo", label: "Política de riesgo" },
  { value: "politica_conflicto_interes", label: "Conflicto de interés" },
  { value: "manual_compliance", label: "Manual compliance" },
  { value: "otro", label: "Otro" },
] as const;

type Tipo = (typeof TIPOS)[number]["value"];
type Estado = "vigente" | "derogada" | "borrador";

interface Policy {
  policy_id: number;
  tipo: Tipo;
  nombre: string;
  version: string;
  fecha_aprobacion: string;
  fecha_vigencia_desde: string | null;
  fecha_proxima_revision: string | null;
  aprobado_por: string | null;
  dropbox_path: string | null;
  hash_sha256: string | null;
  estado: Estado;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const tipoLabel = (t: Tipo) =>
  TIPOS.find((x) => x.value === t)?.label ?? t;

export default function PoliciesFondoPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [tipoFilter, setTipoFilter] = useState<Tipo | "">("");
  const [estadoFilter, setEstadoFilter] = useState<Estado | "">("");
  const [showCreate, setShowCreate] = useState(false);

  const { data: policies, isLoading } = useQuery<Policy[]>({
    queryKey: ["policies-fondo", tipoFilter, estadoFilter],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (tipoFilter) qs.set("tipo", tipoFilter);
      if (estadoFilter) qs.set("estado", estadoFilter);
      const path = `/policies-fondo${qs.toString() ? `?${qs}` : ""}`;
      return apiClient.get<Policy[]>(path, session);
    },
    enabled: !!session,
  });

  const deroBarMutation = useMutation({
    mutationFn: async (policy_id: number) =>
      apiClient.patch<Policy>(
        `/policies-fondo/${policy_id}`,
        { estado: "derogada" },
        session,
      ),
    onSuccess: () => {
      toast.success("Política derogada");
      qc.invalidateQueries({ queryKey: ["policies-fondo"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error");
    },
  });

  const proximasARevisar = (policies ?? []).filter((p) => {
    if (!p.fecha_proxima_revision || p.estado !== "vigente") return false;
    const days =
      (new Date(p.fecha_proxima_revision).getTime() - Date.now()) /
      (1000 * 60 * 60 * 24);
    return days <= 30;
  });

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Políticas del fondo
          </h1>
          <p className="mt-1 text-sm text-ink-600">
            Reglamento interno, manuales UAF, política PEP, código de ética
            y demás políticas internas del FIP CEHTA. Auditable por CMF.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white hover:bg-cehta-green-700"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Nueva política
        </button>
      </header>

      {/* Hint próximas a revisar */}
      {proximasARevisar.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-ink-900">
              {proximasARevisar.length}{" "}
              {proximasARevisar.length === 1 ? "política vence" : "políticas vencen"}{" "}
              su revisión en los próximos 30 días
            </p>
            <ul className="mt-2 space-y-0.5 text-xs text-ink-600">
              {proximasARevisar.slice(0, 3).map((p) => (
                <li key={p.policy_id}>
                  · <strong>{p.nombre}</strong> ({tipoLabel(p.tipo)}) —{" "}
                  {p.fecha_proxima_revision}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <select
          value={tipoFilter}
          onChange={(e) => setTipoFilter(e.target.value as Tipo | "")}
          className="rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
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
          onChange={(e) => setEstadoFilter(e.target.value as Estado | "")}
          className="rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          <option value="">Todos los estados</option>
          <option value="vigente">Vigente</option>
          <option value="borrador">Borrador</option>
          <option value="derogada">Derogada</option>
        </select>
      </div>

      {/* Lista — QA fix 14/05/2026: skeleton matching layout */}
      {isLoading ? (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60">
              <tr>
                {[
                  "Tipo",
                  "Nombre / versión",
                  "Aprobada",
                  "Próxima revisión",
                  "Estado",
                  "Acción",
                ].map((h) => (
                  <th key={h} className="px-4 py-3 text-left">
                    <Skeleton className="h-3 w-16" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {[1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  <td className="px-4 py-3">
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-3 w-48" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-3 w-24" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-3 w-24" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Skeleton className="ml-auto h-3 w-12" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !policies || policies.length === 0 ? (
        tipoFilter || estadoFilter ? (
          <AdminFilteredEmpty
            message="Ninguna política coincide con esos filtros."
            onClear={() => {
              setTipoFilter("");
              setEstadoFilter("");
            }}
          />
        ) : (
          <AdminEmptyState
            icon={<ShieldCheck strokeWidth={1.5} />}
            eyebrow="Vault de políticas · FIP CEHTA"
            title="Empezá tu compliance documental"
            body="Sube el reglamento interno, el manual UAF, el código de ética y demás políticas internas con su versión y fecha de aprobación. CMF puede pedírtelas en cualquier auditoría."
            ctaLabel="Crear primera política"
            onCta={() => setShowCreate(true)}
            hint="Cuando haya políticas próximas a vencer su revisión, aparecen aquí arriba como hint."
          />
        )
      ) : (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Nombre · versión</th>
                <th className="px-4 py-3">Aprobada</th>
                <th className="px-4 py-3">Próxima revisión</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {policies.map((p) => (
                <tr key={p.policy_id} className="hover:bg-ink-50/40">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-700">
                      <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                      {tipoLabel(p.tipo)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink-900">{p.nombre}</p>
                    <p className="text-xs text-ink-500">v{p.version}</p>
                  </td>
                  <td className="px-4 py-3 text-ink-600">
                    {p.fecha_aprobacion}
                  </td>
                  <td className="px-4 py-3 text-ink-600">
                    {p.fecha_proxima_revision ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <EstadoBadge estado={p.estado} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.estado === "vigente" && (
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            confirm(
                              `Derogar la política "${p.nombre}" v${p.version}? Esto la marca como derogada pero la mantiene en el historial.`,
                            )
                          ) {
                            deroBarMutation.mutate(p.policy_id);
                          }
                        }}
                        className="text-xs font-medium text-negative hover:underline"
                      >
                        Derogar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal crear */}
      {showCreate && (
        <CreatePolicyDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["policies-fondo"] });
          }}
        />
      )}
    </div>
  );
}

function EstadoBadge({ estado }: { estado: Estado }) {
  const styles = {
    vigente: "bg-positive/10 text-positive border-positive/30",
    borrador: "bg-warning/10 text-warning border-warning/30",
    derogada: "bg-ink-100 text-ink-500 border-hairline",
  }[estado];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles}`}
    >
      {estado === "vigente" && <CheckCircle2 className="h-3 w-3" strokeWidth={2} />}
      {estado}
    </span>
  );
}

function CreatePolicyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { session } = useSession();
  const [tipo, setTipo] = useState<Tipo>("reglamento_interno");
  const [nombre, setNombre] = useState("");
  const [version, setVersion] = useState("v1.0");
  const [fechaAprobacion, setFechaAprobacion] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaProximaRevision, setFechaProximaRevision] = useState("");
  const [aprobadoPor, setAprobadoPor] = useState("");
  const [dropboxPath, setDropboxPath] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || loading) return;
    if (!nombre.trim() || !version.trim()) return;
    setLoading(true);
    try {
      await apiClient.post(
        "/policies-fondo",
        {
          tipo,
          nombre: nombre.trim(),
          version: version.trim(),
          fecha_aprobacion: fechaAprobacion,
          fecha_proxima_revision: fechaProximaRevision || null,
          aprobado_por: aprobadoPor.trim() || null,
          dropbox_path: dropboxPath.trim() || null,
        },
        session,
      );
      toast.success("Política creada");
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Error");
    } finally {
      setLoading(false);
    }
  };
  // Round 30 — focus trap + ESC + scroll lock para crear política fondo.
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
          Nueva política
        </h2>

        <Field label="Tipo">
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as Tipo)}
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Nombre" required>
          <input
            type="text"
            required
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Reglamento Interno FIP CEHTA ESG"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Versión" required>
            <input
              type="text"
              required
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="v1.0"
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
          <Field label="Fecha aprobación" required>
            <input
              type="date"
              required
              value={fechaAprobacion}
              onChange={(e) => setFechaAprobacion(e.target.value)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
        </div>

        <Field label="Próxima revisión (opcional)">
          <input
            type="date"
            value={fechaProximaRevision}
            onChange={(e) => setFechaProximaRevision(e.target.value)}
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </Field>

        <Field label="Aprobado por">
          <input
            type="text"
            value={aprobadoPor}
            onChange={(e) => setAprobadoPor(e.target.value)}
            placeholder="Guido Rietta · GP"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </Field>

        <Field label="Path Dropbox (opcional)">
          <input
            type="text"
            value={dropboxPath}
            onChange={(e) => setDropboxPath(e.target.value)}
            placeholder="/Cehta Capital/02-Fondo/Reglamento Interno/v1.0.pdf"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </Field>

        <button
          type="submit"
          disabled={loading || !nombre.trim() || !version.trim()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-60"
        >
          {loading ? "Creando…" : "Crear política"}
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
