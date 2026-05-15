"use client";

/**
 * /admin/fondo-actas
 *
 * Vault de actas formales del FIP CEHTA: Directorio AFIS, Comité de
 * Inversión, Asamblea de LPs, Comités de Vigilancia y Riesgo. Distinto
 * del legal vault (que tiene `categoria='acta'` por empresa portfolio).
 * Auditable por CMF — debe ser fácilmente filtrable y trazable.
 *
 * Funcionalidad V5 (mínima):
 *  - Lista con filtros por tipo de órgano y estado
 *  - Botón crear → modal con form (sin acuerdos en V1)
 *  - Click en row → detalle con acuerdos / quórum (read-only V1)
 *
 * Los acuerdos se editan vía PATCH posterior — la UI completa con
 * ítems del orden del día se difiere a V2.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  Gavel,
  Plus,
  Scale,
  Shield,
  ShieldAlert,
  Sparkles,
  Trash2,
  Users,
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
  {
    value: "directorio_afis",
    label: "Directorio AFIS",
    icon: Gavel,
    badge: "bg-cehta-green/10 text-cehta-green border-cehta-green/30",
  },
  {
    value: "comite_inversion",
    label: "Comité de Inversión",
    icon: Sparkles,
    badge: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  },
  {
    value: "asamblea_lps",
    label: "Asamblea de LPs",
    icon: Users,
    badge: "bg-violet-500/10 text-violet-700 border-violet-500/30",
  },
  {
    value: "comite_vigilancia",
    label: "Comité de Vigilancia",
    icon: Shield,
    badge: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  },
  {
    value: "comite_riesgo",
    label: "Comité de Riesgo",
    icon: ShieldAlert,
    badge: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  },
  {
    value: "otro",
    label: "Otro",
    icon: Scale,
    badge: "bg-ink-100 text-ink-600 border-hairline",
  },
] as const;

type Tipo = (typeof TIPOS)[number]["value"];
type Estado = "borrador" | "aprobada" | "firmada" | "archivada";

interface Acuerdo {
  orden_dia: string;
  descripcion: string;
  votos_a_favor: number;
  votos_en_contra: number;
  abstenciones: number;
  aprobado: boolean;
}

interface Acta {
  acta_id: number;
  tipo_organo: Tipo;
  numero_acta: number;
  fecha_reunion: string;
  lugar: string | null;
  quorum: number | null;
  quorum_total: number | null;
  presidente: string | null;
  secretario: string | null;
  asistentes: string[];
  temario: string | null;
  acuerdos: Acuerdo[];
  dropbox_path: string | null;
  hash_sha256: string | null;
  estado: Estado;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const FALLBACK_META = TIPOS[5]; // "otro" — siempre presente, índice estable

const tipoMeta = (t: Tipo): (typeof TIPOS)[number] => {
  for (const x of TIPOS) {
    if (x.value === t) return x;
  }
  return FALLBACK_META;
};

export default function FondoActasPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [tipoFilter, setTipoFilter] = useState<Tipo | "">("");
  const [estadoFilter, setEstadoFilter] = useState<Estado | "">("");
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<Acta | null>(null);

  const { data: actas, isLoading } = useQuery<Acta[]>({
    queryKey: ["fondo-actas", tipoFilter, estadoFilter],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (tipoFilter) qs.set("tipo_organo", tipoFilter);
      if (estadoFilter) qs.set("estado", estadoFilter);
      const path = `/fondo-actas${qs.toString() ? `?${qs}` : ""}`;
      return apiClient.get<Acta[]>(path, session);
    },
    enabled: !!session,
  });

  const deleteMutation = useMutation({
    mutationFn: async (acta_id: number) =>
      apiClient.delete<void>(`/fondo-actas/${acta_id}`, session),
    onSuccess: () => {
      toast.success("Acta eliminada");
      qc.invalidateQueries({ queryKey: ["fondo-actas"] });
      setDetail(null);
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error");
    },
  });

  return (
    <div className="space-y-8 p-6">
      {/* Hero editorial */}
      <header className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
          Actas del fondo · FIP CEHTA
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
          Actas formales del FIP
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-ink-600">
          Registro auditable de las actas del Directorio AFIS, Comité de
          Inversión, Asambleas de LPs y comités de vigilancia y riesgo.
          Cada acta vive con su correlativo, quórum, asistentes y
          acuerdos — listo para una eventual revisión CMF.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-cehta-green-700"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Nueva acta
          </button>
        </div>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <select
          value={tipoFilter}
          onChange={(e) => setTipoFilter(e.target.value as Tipo | "")}
          className="rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          <option value="">Todos los órganos</option>
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
          <option value="borrador">Borrador</option>
          <option value="aprobada">Aprobada</option>
          <option value="firmada">Firmada</option>
          <option value="archivada">Archivada</option>
        </select>
      </div>

      {/* Lista — QA fix 14/05/2026: skeleton matching layout */}
      {isLoading ? (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60">
              <tr>
                {[
                  "Órgano",
                  "N°",
                  "Fecha",
                  "Quórum",
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
                    <Skeleton className="h-3 w-10" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-3 w-24" />
                  </td>
                  <td className="px-4 py-3">
                    <Skeleton className="h-3 w-12" />
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
      ) : !actas || actas.length === 0 ? (
        tipoFilter || estadoFilter ? (
          <AdminFilteredEmpty
            message="Ninguna acta coincide con esos filtros."
            onClear={() => {
              setTipoFilter("");
              setEstadoFilter("");
            }}
          />
        ) : (
          <AdminEmptyState
            icon={<Gavel strokeWidth={1.5} />}
            eyebrow="Actas formales · FIP CEHTA"
            title="Empezá a registrar las actas del fondo"
            body="Directorio AFIS, Comité de Inversión, Asamblea de LPs y comités regulatorios — con número correlativo, quórum, asistentes y acuerdos votados."
            ctaLabel="Crear primera acta"
            onCta={() => setShowCreate(true)}
            hint="Cada acta queda con número correlativo único por órgano (no se pueden duplicar)."
          />
        )
      ) : (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
          <table className="w-full text-sm">
            <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-4 py-3">Órgano</th>
                <th className="px-4 py-3">N° acta</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Quórum</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {actas.map((a) => {
                const meta = tipoMeta(a.tipo_organo);
                const Icon = meta.icon;
                return (
                  <tr
                    key={a.acta_id}
                    onClick={() => setDetail(a)}
                    className="cursor-pointer hover:bg-ink-50/40"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${meta.badge}`}
                      >
                        <Icon className="h-3 w-3" strokeWidth={1.75} />
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-ink-900">
                      #{a.numero_acta}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays
                          className="h-3.5 w-3.5 text-ink-400"
                          strokeWidth={1.75}
                        />
                        {a.fecha_reunion}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {a.quorum != null && a.quorum_total != null
                        ? `${a.quorum}/${a.quorum_total}`
                        : a.quorum != null
                          ? `${a.quorum}`
                          : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <EstadoBadge estado={a.estado} />
                    </td>
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setDetail(a)}
                        className="text-xs font-medium text-cehta-green hover:underline"
                      >
                        Ver
                      </button>
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
        <CreateActaDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ["fondo-actas"] });
          }}
        />
      )}

      {/* Drawer detalle */}
      {detail && (
        <ActaDetailDrawer
          acta={detail}
          onClose={() => setDetail(null)}
          onDelete={() => {
            if (
              confirm(
                `Eliminar el acta #${detail.numero_acta} de ${tipoMeta(detail.tipo_organo).label}? Esta acción no se puede deshacer.`,
              )
            ) {
              deleteMutation.mutate(detail.acta_id);
            }
          }}
        />
      )}
    </div>
  );
}

function EstadoBadge({ estado }: { estado: Estado }) {
  const styles = {
    borrador: "bg-warning/10 text-warning border-warning/30",
    aprobada: "bg-blue-500/10 text-blue-700 border-blue-500/30",
    firmada: "bg-positive/10 text-positive border-positive/30",
    archivada: "bg-ink-100 text-ink-500 border-hairline",
  }[estado];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles}`}
    >
      {estado === "firmada" && (
        <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
      )}
      {estado}
    </span>
  );
}

function CreateActaDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { session } = useSession();
  const [tipoOrgano, setTipoOrgano] = useState<Tipo>("directorio_afis");
  const [numeroActa, setNumeroActa] = useState<string>("1");
  const [fechaReunion, setFechaReunion] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [lugar, setLugar] = useState("");
  const [presidente, setPresidente] = useState("");
  const [secretario, setSecretario] = useState("");
  const [asistentesText, setAsistentesText] = useState("");
  const [temario, setTemario] = useState("");
  const [dropboxPath, setDropboxPath] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || loading) return;
    const numero = Number.parseInt(numeroActa, 10);
    if (!Number.isFinite(numero) || numero < 1) {
      toast.error("Número de acta inválido");
      return;
    }
    const asistentes = asistentesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    setLoading(true);
    try {
      await apiClient.post(
        "/fondo-actas",
        {
          tipo_organo: tipoOrgano,
          numero_acta: numero,
          fecha_reunion: fechaReunion,
          lugar: lugar.trim() || null,
          presidente: presidente.trim() || null,
          secretario: secretario.trim() || null,
          asistentes,
          temario: temario.trim() || null,
          dropbox_path: dropboxPath.trim() || null,
        },
        session,
      );
      toast.success("Acta creada");
      onCreated();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Error");
    } finally {
      setLoading(false);
    }
  };
  // Round 30 — focus trap + ESC + scroll lock para crear acta.
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
          Nueva acta
        </h2>
        <p className="text-sm text-ink-600">
          Los acuerdos del orden del día se editan luego desde el detalle.
        </p>

        <Field label="Órgano">
          <select
            value={tipoOrgano}
            onChange={(e) => setTipoOrgano(e.target.value as Tipo)}
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          >
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="N° acta" required>
            <input
              type="number"
              required
              min={1}
              value={numeroActa}
              onChange={(e) => setNumeroActa(e.target.value)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
          <Field label="Fecha reunión" required>
            <input
              type="date"
              required
              value={fechaReunion}
              onChange={(e) => setFechaReunion(e.target.value)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
        </div>

        <Field label="Lugar">
          <input
            type="text"
            value={lugar}
            onChange={(e) => setLugar(e.target.value)}
            placeholder="Santiago, oficinas Cehta · Videoconferencia Zoom"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Presidente">
            <input
              type="text"
              value={presidente}
              onChange={(e) => setPresidente(e.target.value)}
              placeholder="Guido Rietta"
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
          <Field label="Secretario">
            <input
              type="text"
              value={secretario}
              onChange={(e) => setSecretario(e.target.value)}
              placeholder="Nicolas Rietta"
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
        </div>

        <Field label="Asistentes (uno por línea)">
          <textarea
            rows={4}
            value={asistentesText}
            onChange={(e) => setAsistentesText(e.target.value)}
            placeholder={"Guido Rietta\nNicolas Rietta\nJuan Pérez"}
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </Field>

        <Field label="Temario">
          <textarea
            rows={3}
            value={temario}
            onChange={(e) => setTemario(e.target.value)}
            placeholder="1. Aprobación acta anterior. 2. Revisión inversiones Q1. 3. Varios."
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </Field>

        <Field label="Path Dropbox (PDF firmado)">
          <input
            type="text"
            value={dropboxPath}
            onChange={(e) => setDropboxPath(e.target.value)}
            placeholder="/Cehta Capital/02-Fondo/Actas/Directorio AFIS/2026-01.pdf"
            className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </Field>

        <button
          type="submit"
          disabled={loading || !numeroActa.trim()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-60"
        >
          {loading ? "Creando…" : "Crear acta"}
        </button>
      </form>
    </div>
  );
}

function ActaDetailDrawer({
  acta,
  onClose,
  onDelete,
}: {
  acta: Acta;
  onClose: () => void;
  onDelete: () => void;
}) {
  const meta = tipoMeta(acta.tipo_organo);
  const Icon = meta.icon;
  // Round 30 — focus trap + ESC + scroll lock para drawer acta detail.
  const a11yRef = useModalA11y({ open: true, onClose });
  return (
    <div
      ref={a11yRef}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-600 hover:bg-ink-200"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>

        <div className="space-y-1">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${meta.badge}`}
          >
            <Icon className="h-3 w-3" strokeWidth={1.75} />
            {meta.label}
          </span>
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            Acta #{acta.numero_acta}
          </h2>
          <p className="text-sm text-ink-600">{acta.fecha_reunion}</p>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <DetailRow label="Lugar" value={acta.lugar} />
          <DetailRow
            label="Quórum"
            value={
              acta.quorum != null && acta.quorum_total != null
                ? `${acta.quorum} / ${acta.quorum_total}`
                : acta.quorum != null
                  ? String(acta.quorum)
                  : null
            }
          />
          <DetailRow label="Presidente" value={acta.presidente} />
          <DetailRow label="Secretario" value={acta.secretario} />
        </dl>

        <section className="mt-6">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Estado
          </h3>
          <EstadoBadge estado={acta.estado} />
        </section>

        {acta.asistentes.length > 0 && (
          <section className="mt-6">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Asistentes ({acta.asistentes.length})
            </h3>
            <ul className="space-y-1 text-sm text-ink-700">
              {acta.asistentes.map((a, i) => (
                <li key={i}>· {a}</li>
              ))}
            </ul>
          </section>
        )}

        {acta.temario && (
          <section className="mt-6">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Temario
            </h3>
            <p className="whitespace-pre-line text-sm text-ink-700">
              {acta.temario}
            </p>
          </section>
        )}

        {acta.acuerdos.length > 0 && (
          <section className="mt-6">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Acuerdos ({acta.acuerdos.length})
            </h3>
            <ul className="space-y-3">
              {acta.acuerdos.map((ac, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-hairline bg-ink-50/40 p-3 text-sm"
                >
                  <p className="font-medium text-ink-900">{ac.orden_dia}</p>
                  <p className="mt-1 text-ink-700">{ac.descripcion}</p>
                  <p className="mt-2 text-xs text-ink-500">
                    A favor: {ac.votos_a_favor} · En contra:{" "}
                    {ac.votos_en_contra} · Abstenciones: {ac.abstenciones} ·{" "}
                    <span
                      className={
                        ac.aprobado ? "text-positive" : "text-negative"
                      }
                    >
                      {ac.aprobado ? "Aprobado" : "Rechazado"}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {acta.dropbox_path && (
          <section className="mt-6">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Dropbox
            </h3>
            <p className="break-all text-xs text-ink-600">
              {acta.dropbox_path}
            </p>
          </section>
        )}

        <div className="mt-8 flex items-center justify-end border-t border-hairline pt-4">
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-2 text-xs font-medium text-negative hover:underline"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            Eliminar acta
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </dt>
      <dd className="text-ink-900">{value ?? "—"}</dd>
    </>
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
