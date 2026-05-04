"use client";

/**
 * /admin/lps/[id] — Detalle del LP con edición inline + lista de informes
 * generados para esta persona.
 *
 * Permite:
 * - Ver datos completos del LP (incluyendo aporte, perfil, intereses)
 * - Editar campos (PATCH /lps/{id})
 * - Ver historial de informes asociados con sus métricas
 * - Botón "Generar nuevo informe para este LP" (deep-link al form)
 * - Borrar LP (con confirm)
 */
import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Pencil,
  Save,
  Loader2,
  Trash2,
  Sparkles,
  ExternalLink,
  Mail,
  Building2,
  Phone,
  Calendar,
  Wallet,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  EstadoLp,
  InformeLpListItem,
  LpRead,
  PerfilInversor,
} from "@/lib/api/schema";

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

const ESTADO_LABEL: Record<EstadoLp, string> = {
  pipeline: "Pipeline",
  cualificado: "Cualificado",
  activo: "Activo",
  inactivo: "Inactivo",
  declinado: "Declinado",
};

const PERFIL_LABEL: Record<PerfilInversor, string> = {
  conservador: "Conservador",
  moderado: "Moderado",
  agresivo: "Agresivo",
  esg_focused: "ESG-focused",
};

function formatCLP(amount: number | null | undefined): string {
  if (!amount) return "—";
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${amount.toLocaleString("es-CL")}`;
}

export default function LpDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { session } = useSession();
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Partial<LpRead>>({});

  const lpQ = useApiQuery<LpRead>(["lp", id], `/lps/${id}`);
  const informesQ = useApiQuery<InformeLpListItem[]>(
    ["lp-informes", id],
    `/informes-lp?lp_id=${id}`,
  );

  const updateMutation = useMutation({
    mutationFn: () =>
      apiClient.patch<LpRead>(
        `/lps/${id}`,
        {
          ...draft,
          // Limpiar strings vacíos a null
          email: draft.email?.toString().trim() || null,
          telefono: draft.telefono?.toString().trim() || null,
          empresa: draft.empresa?.toString().trim() || null,
          rol: draft.rol?.toString().trim() || null,
          notas: draft.notas?.toString().trim() || null,
        },
        session,
      ),
    onSuccess: (data) => {
      toast.success("LP actualizado");
      qc.setQueryData(["lp", id], data);
      setEditMode(false);
      setDraft({});
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error al actualizar");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/lps/${id}`, session),
    onSuccess: () => {
      toast.success("LP eliminado");
      router.push(`/admin/lps` as never);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error al eliminar");
    },
  });

  if (lpQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }

  if (lpQ.isError || !lpQ.data) {
    return (
      <Surface className="text-center">
        <p className="text-sm text-negative">No se pudo cargar el LP</p>
        <Link
          href={"/admin/lps" as never}
          className="mt-2 inline-block text-sm text-cehta-green hover:underline"
        >
          Volver al listado
        </Link>
      </Surface>
    );
  }

  const lp = lpQ.data;
  const view: LpRead = editMode ? { ...lp, ...draft } : lp;
  const nombreCompleto = (
    view.nombre + (view.apellido ? ` ${view.apellido}` : "")
  ).trim();
  const aporteTotal = view.aporte_total ?? 0;
  const aporteActual = view.aporte_actual ?? 0;
  const pctIntegrado =
    aporteTotal > 0 ? Math.round((aporteActual / aporteTotal) * 100) : 0;
  const informes = informesQ.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href={"/admin/lps" as never}
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-700"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          Volver al listado
        </Link>
        <div className="flex items-center gap-2">
          {!editMode ? (
            <button
              type="button"
              onClick={() => {
                setDraft(lp);
                setEditMode(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
              Editar
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditMode(false);
                  setDraft({});
                }}
                className="rounded-xl px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-100/40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:bg-cehta-green-700 disabled:opacity-60"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                ) : (
                  <Save className="h-3.5 w-3.5" strokeWidth={2} />
                )}
                Guardar cambios
              </button>
            </>
          )}
          <Link
            href={`/admin/informes-lp/nuevo?lp_id=${lp.lp_id}` as never}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:bg-cehta-green-700"
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            Nuevo informe
          </Link>
        </div>
      </div>

      {/* Hero del LP */}
      <Surface variant="glass">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-cehta-green/10 font-display text-2xl font-bold text-cehta-green">
              {getInitials(nombreCompleto)}
            </span>
            <div className="min-w-0">
              {editMode ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={draft.nombre ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, nombre: e.target.value })
                    }
                    placeholder="Nombre"
                    className="rounded-lg border-0 bg-white px-2 py-1 text-base font-semibold ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                  <input
                    type="text"
                    value={draft.apellido ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, apellido: e.target.value })
                    }
                    placeholder="Apellido"
                    className="rounded-lg border-0 bg-white px-2 py-1 text-base font-semibold ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                </div>
              ) : (
                <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
                  {nombreCompleto}
                </h1>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {editMode ? (
                  <>
                    <select
                      value={draft.estado ?? "pipeline"}
                      onChange={(e) =>
                        setDraft({ ...draft, estado: e.target.value as EstadoLp })
                      }
                      className="rounded-lg border-0 bg-white px-2 py-0.5 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                    >
                      <option value="pipeline">Pipeline</option>
                      <option value="cualificado">Cualificado</option>
                      <option value="activo">Activo</option>
                      <option value="inactivo">Inactivo</option>
                      <option value="declinado">Declinado</option>
                    </select>
                    <select
                      value={draft.perfil_inversor ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          perfil_inversor:
                            (e.target.value || null) as PerfilInversor | null,
                        })
                      }
                      className="rounded-lg border-0 bg-white px-2 py-0.5 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                    >
                      <option value="">Sin perfil</option>
                      <option value="conservador">Conservador</option>
                      <option value="moderado">Moderado</option>
                      <option value="agresivo">Agresivo</option>
                      <option value="esg_focused">ESG-focused</option>
                    </select>
                  </>
                ) : (
                  <>
                    <Badge variant={ESTADO_VARIANT[view.estado]}>
                      {ESTADO_LABEL[view.estado]}
                    </Badge>
                    {view.perfil_inversor && (
                      <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-600">
                        {PERFIL_LABEL[view.perfil_inversor]}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Aportes destacados */}
        {(aporteTotal > 0 || editMode) && (
          <div className="mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-hairline bg-white p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-400">
                Comprometido
              </p>
              {editMode ? (
                <input
                  type="number"
                  value={draft.aporte_total ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      aporte_total: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="mt-1 w-full rounded-lg border-0 bg-white px-2 py-1 font-display text-xl ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              ) : (
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink-900">
                  {formatCLP(aporteTotal)}
                </p>
              )}
            </div>
            <div className="rounded-xl border border-hairline bg-white p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-400">
                Integrado
              </p>
              {editMode ? (
                <input
                  type="number"
                  value={draft.aporte_actual ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      aporte_actual: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                  className="mt-1 w-full rounded-lg border-0 bg-white px-2 py-1 font-display text-xl ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              ) : (
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-positive">
                  {formatCLP(aporteActual)}
                </p>
              )}
            </div>
            <div className="rounded-xl border border-hairline bg-white p-3">
              <p className="text-[10px] uppercase tracking-wider text-ink-400">
                Progreso
              </p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-cehta-green">
                {pctIntegrado}%
              </p>
            </div>
          </div>
        )}
      </Surface>

      {/* Identidad y contacto */}
      <Surface>
        <Surface.Header divider>
          <Surface.Title>Identidad y contacto</Surface.Title>
        </Surface.Header>
        <Surface.Body>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Row
              Icon={Mail}
              label="Email"
              value={view.email}
              edit={
                editMode ? (
                  <input
                    type="email"
                    value={draft.email ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, email: e.target.value })
                    }
                    className="w-full rounded-lg border-0 bg-white px-2 py-1 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                ) : null
              }
            />
            <Row
              Icon={Phone}
              label="Teléfono"
              value={view.telefono}
              edit={
                editMode ? (
                  <input
                    type="text"
                    value={draft.telefono ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, telefono: e.target.value })
                    }
                    className="w-full rounded-lg border-0 bg-white px-2 py-1 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                ) : null
              }
            />
            <Row
              Icon={Building2}
              label="Empresa / FO"
              value={view.empresa}
              edit={
                editMode ? (
                  <input
                    type="text"
                    value={draft.empresa ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, empresa: e.target.value })
                    }
                    className="w-full rounded-lg border-0 bg-white px-2 py-1 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                ) : null
              }
            />
            <Row
              Icon={Users}
              label="Rol"
              value={view.rol}
              edit={
                editMode ? (
                  <input
                    type="text"
                    value={draft.rol ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, rol: e.target.value })
                    }
                    className="w-full rounded-lg border-0 bg-white px-2 py-1 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                ) : null
              }
            />
            <Row
              Icon={Calendar}
              label="Primer contacto"
              value={view.primer_contacto}
            />
            <Row
              Icon={Wallet}
              label="Relationship Manager"
              value={view.relationship_owner}
            />
          </dl>

          {/* Empresas en cartera */}
          {view.empresas_invertidas && view.empresas_invertidas.length > 0 && (
            <div className="mt-6 border-t border-hairline pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-500">
                Empresas en cartera
              </p>
              <div className="flex flex-wrap gap-2">
                {view.empresas_invertidas.map((cod) => (
                  <span
                    key={cod}
                    className="rounded-md bg-cehta-green/10 px-2 py-1 font-mono text-xs font-semibold text-cehta-green"
                  >
                    {cod}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Intereses */}
          {view.intereses && view.intereses.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-500">
                Intereses
              </p>
              <div className="flex flex-wrap gap-2">
                {view.intereses.map((i) => (
                  <span
                    key={i}
                    className="rounded-full bg-ink-100 px-3 py-1 text-xs text-ink-700"
                  >
                    {i}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Notas */}
          {(view.notas || editMode) && (
            <div className="mt-6 border-t border-hairline pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-500">
                Notas internas
              </p>
              {editMode ? (
                <textarea
                  value={draft.notas ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, notas: e.target.value })
                  }
                  rows={3}
                  className="w-full rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
              ) : (
                <p className="text-sm text-ink-700 whitespace-pre-wrap">
                  {view.notas}
                </p>
              )}
            </div>
          )}
        </Surface.Body>
      </Surface>

      {/* Informes asociados */}
      <Surface>
        <Surface.Header divider>
          <div className="flex items-start justify-between gap-3">
            <div>
              <Surface.Title>Informes generados</Surface.Title>
              <Surface.Subtitle>
                {informes.length}{" "}
                {informes.length === 1 ? "informe" : "informes"} en historial
              </Surface.Subtitle>
            </div>
            <Link
              href={`/admin/informes-lp/nuevo?lp_id=${lp.lp_id}` as never}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:bg-cehta-green-700"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              Generar nuevo
            </Link>
          </div>
        </Surface.Header>
        <Surface.Body>
          {informesQ.isLoading ? (
            <Skeleton className="h-20 rounded-xl" />
          ) : informes.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">
              Aún no le generaste ningún informe a {view.nombre}
            </p>
          ) : (
            <ul className="space-y-2">
              {informes.map((inf) => (
                <li
                  key={inf.informe_id}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-white px-4 py-3"
                >
                  <Badge
                    variant={
                      inf.estado === "publicado"
                        ? "success"
                        : inf.estado === "borrador"
                        ? "warning"
                        : "neutral"
                    }
                  >
                    {inf.estado}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {inf.titulo}
                    </p>
                    <p className="text-xs text-ink-500">
                      {inf.tipo.replace("_", " ")}
                      {inf.periodo && ` · ${inf.periodo}`}
                      {" · "}
                      {new Date(inf.created_at).toLocaleDateString("es-CL")}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="font-mono tabular-nums text-ink-900">
                      {inf.veces_abierto} opens · {inf.veces_compartido} shares
                    </p>
                  </div>
                  {inf.estado === "publicado" && (
                    <a
                      href={`/informe/${inf.token}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-50"
                    >
                      Ver
                      <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Surface.Body>
      </Surface>

      {/* Borrar (zona peligrosa) */}
      <Surface className="border-negative/20 bg-negative/[0.02]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink-900">Eliminar LP</p>
            <p className="mt-0.5 text-xs text-ink-500">
              Esta acción es permanente. Los informes generados se conservan
              pero quedan sin LP asignado.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (
                confirm(
                  `¿Eliminar a ${nombreCompleto}? Esta acción no se puede deshacer.`,
                )
              ) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-negative/30 bg-white px-3 py-1.5 text-xs font-medium text-negative hover:bg-negative/5 disabled:opacity-60"
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Eliminar
          </button>
        </div>
      </Surface>
    </div>
  );
}

// ─── Sub-componentes ───────────────────────────────────────────────────────

function Row({
  Icon,
  label,
  value,
  edit,
}: {
  Icon: React.ElementType;
  label: string;
  value: string | null | undefined;
  edit?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-ink-400"
        strokeWidth={1.5}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-ink-400">
          {label}
        </p>
        {edit ?? (
          <p
            className={cn(
              "mt-0.5 truncate text-sm",
              value ? "text-ink-900" : "italic text-ink-400",
            )}
          >
            {value ?? "—"}
          </p>
        )}
      </div>
    </div>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
