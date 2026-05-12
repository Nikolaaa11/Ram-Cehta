"use client";

/**
 * /admin/empresas — Gestión de empresas del portafolio.
 *
 * Permite editar:
 *   - razón social, RUT, giro
 *   - dirección, ciudad, teléfono
 *   - representante legal, email firmante
 *   - oc_prefix (prefijo de las OCs de esa empresa)
 *   - activo (toggle on/off)
 *
 * NO permite cambiar `codigo` — es identificador semántico que aparece
 * en TODA la app (vouchers, OCs, paths Dropbox, reportes). Cambiarlo
 * requiere migración manual.
 *
 * Diseño: tabla + drawer con form. Idempotente por código. Sin afectar
 * la base de datos: cualquier edit pasa por PATCH /catalogos/empresas/{cod}
 * con audit log.
 */
import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  Building2,
  Edit3,
  Save,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { isValidRut, formatRut } from "@/lib/rut";
import { Skeleton } from "@/components/ui/skeleton";

interface EmpresaRead {
  empresa_id: number;
  codigo: string;
  razon_social: string;
  rut: string | null;
  giro: string | null;
  direccion: string | null;
  ciudad: string | null;
  telefono: string | null;
  representante_legal: string | null;
  email_firmante: string | null;
  oc_prefix: string | null;
  activo: boolean;
}

interface EmpresaCatalogo {
  codigo: string;
  razon_social: string;
  oc_prefix: string | null;
  rut: string | null;
}

interface Props {
  initialEmpresas?: EmpresaCatalogo[];
}

export function EmpresasClientView({ initialEmpresas }: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [selectedCodigo, setSelectedCodigo] = useState<string | null>(null);
  const [syncingCodigo, setSyncingCodigo] = useState<string | null>(null);

  const { data: empresas, isLoading } = useQuery<EmpresaCatalogo[]>({
    queryKey: ["admin-empresas-catalogo"],
    queryFn: () =>
      apiClient.get<EmpresaCatalogo[]>("/catalogos/empresas", session),
    enabled: !!session,
    // V5++ perf: SSR ya trajo la lista en la primera carga → cero loading
    // state visible. Si viene como undefined (entornos donde el server
    // fetch falló), el query fetchea normal.
    initialData: initialEmpresas,
    staleTime: 2 * 60 * 1000,
  });

  const syncAllMut = useMutation({
    mutationFn: (codigo: string) =>
      apiClient.post(`/empresa/${codigo}/sync-all-dropbox`, {}, session),
    onMutate: (codigo: string) => setSyncingCodigo(codigo),
    onSettled: () => setSyncingCodigo(null),
    onSuccess: (data: unknown, codigo: string) => {
      const d = data as {
        trabajadores?: { created_trabajadores?: number };
        legal?: { created_legal?: number };
        f29?: { created_f29?: number };
        f22?: { created?: number };
        errors?: unknown[];
      };
      const trab = d.trabajadores?.created_trabajadores ?? 0;
      const legal = d.legal?.created_legal ?? 0;
      const f29 = d.f29?.created_f29 ?? 0;
      const f22 = d.f22?.created ?? 0;
      const errors = d.errors?.length ?? 0;
      toast.success(
        `Sync ${codigo}: trab=${trab} legal=${legal} f29=${f29} f22=${f22}` +
          (errors > 0 ? ` · ${errors} errores` : ""),
      );
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`Sync falló: ${detail}`);
    },
  });

  const { data: detail } = useQuery<EmpresaRead>({
    queryKey: ["admin-empresa", selectedCodigo],
    queryFn: () =>
      apiClient.get<EmpresaRead>(
        `/catalogos/empresas/${selectedCodigo}`,
        session,
      ),
    enabled: !!session && !!selectedCodigo,
  });

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div>
        <Link
          href={"/admin" as Route}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          Panel admin
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
          Empresas del portafolio
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Editá datos fiscales/contacto de cada empresa. El `codigo` no es
          editable (es el identificador que se usa por toda la app). Para
          cambiarlo, abrir ticket técnico — requiere migración cross-tabla.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
          {isLoading ? (
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-ink-50/60 text-left text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Razón social</th>
                  <th className="px-3 py-2">RUT</th>
                  <th className="px-3 py-2">OC prefix</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {Array.from({ length: 9 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>
                    <td className="px-3 py-2"><Skeleton className="h-3 w-48" /></td>
                    <td className="px-3 py-2"><Skeleton className="h-3 w-24" /></td>
                    <td className="px-3 py-2"><Skeleton className="h-3 w-12" /></td>
                    <td className="px-3 py-2 text-right"><Skeleton className="h-5 w-12 ml-auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : !empresas?.length ? (
            <p className="p-8 text-sm text-ink-500">
              Sin empresas. Algo está mal en la DB.
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-ink-50/60 text-left text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Razón social</th>
                  <th className="px-3 py-2">RUT</th>
                  <th className="px-3 py-2">OC prefix</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {empresas.map((e) => (
                  <tr
                    key={e.codigo}
                    className={`cursor-pointer hover:bg-ink-50/30 ${
                      selectedCodigo === e.codigo ? "bg-ink-50/60" : ""
                    }`}
                    onClick={() => setSelectedCodigo(e.codigo)}
                  >
                    <td className="px-3 py-2 font-mono text-xs font-semibold">
                      {e.codigo}
                    </td>
                    <td className="px-3 py-2 text-ink-700">{e.razon_social}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-500">
                      {e.rut ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-500">
                      {e.oc_prefix ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          syncAllMut.mutate(e.codigo);
                        }}
                        disabled={syncingCodigo === e.codigo}
                        title="Sync Dropbox: trabajadores, legal, F29, F22, EEFF"
                        className="mr-2 inline-flex items-center gap-1 rounded-lg bg-cehta-green/10 px-2 py-1 text-[10px] font-medium text-cehta-green hover:bg-cehta-green hover:text-white disabled:opacity-50"
                      >
                        {syncingCodigo === e.codigo ? (
                          <Loader2
                            className="h-3 w-3 animate-spin"
                          />
                        ) : (
                          <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
                        )}
                        Sync
                      </button>
                      <Edit3
                        className="inline h-3.5 w-3.5 text-ink-400"
                        strokeWidth={1.75}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>

        {/* Drawer de edición.
            `key={detail.codigo}` fuerza re-mount al cambiar empresa
            seleccionada — sin esto, el `useState` interno mantiene el
            `draft` anterior y el user pierde sus edits. */}
        {selectedCodigo && detail && (
          <EmpresaEditDrawer
            key={detail.codigo}
            empresa={detail}
            onClose={() => setSelectedCodigo(null)}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ["admin-empresas-catalogo"] });
              qc.invalidateQueries({
                queryKey: ["admin-empresa", selectedCodigo],
              });
              qc.invalidateQueries({ queryKey: ["empresas"] });
              qc.invalidateQueries({ queryKey: ["empresas-catalogo"] });
            }}
          />
        )}
      </div>
    </div>
  );
}

interface DrawerProps {
  empresa: EmpresaRead;
  onClose: () => void;
  onSaved: () => void;
}

function EmpresaEditDrawer({ empresa, onClose, onSaved }: DrawerProps) {
  const { session } = useSession();
  const [draft, setDraft] = useState({
    razon_social: empresa.razon_social,
    rut: empresa.rut ?? "",
    giro: empresa.giro ?? "",
    direccion: empresa.direccion ?? "",
    ciudad: empresa.ciudad ?? "",
    telefono: empresa.telefono ?? "",
    representante_legal: empresa.representante_legal ?? "",
    email_firmante: empresa.email_firmante ?? "",
    oc_prefix: empresa.oc_prefix ?? "",
    activo: empresa.activo,
  });

  const saveMut = useMutation({
    mutationFn: (body: Partial<typeof draft>) =>
      apiClient.patch<EmpresaRead>(
        `/catalogos/empresas/${empresa.codigo}`,
        body,
        session,
      ),
    onSuccess: () => {
      toast.success("Empresa actualizada");
      onSaved();
      onClose();
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`No se pudo guardar: ${detail}`);
    },
  });

  return (
    <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Editando · {empresa.codigo}
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold text-ink-900">
            {empresa.razon_social}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-ink-400 hover:bg-ink-50 hover:text-ink-700"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        {(
          [
            ["razon_social", "Razón social"],
            ["rut", "RUT"],
            ["giro", "Giro"],
            ["direccion", "Dirección"],
            ["ciudad", "Ciudad"],
            ["telefono", "Teléfono"],
            ["representante_legal", "Representante legal"],
            ["email_firmante", "Email firmante (vouchers)"],
            ["oc_prefix", "OC prefix"],
          ] as const
        ).map(([key, label]) => {
          const value = (draft[key] as string) ?? "";
          const isRut = key === "rut";
          // Validar RUT solo si tiene >2 chars (suficiente para tener DV)
          const rutInvalid =
            isRut && value.length > 2 && !isValidRut(value);
          const rutValid = isRut && value.length > 2 && isValidRut(value);
          return (
            <div key={key}>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                {label}
                {isRut && rutValid && (
                  <span className="ml-1 inline-flex items-center gap-0.5 text-[9px] text-cehta-green">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    válido
                  </span>
                )}
                {isRut && rutInvalid && (
                  <span className="ml-1 inline-flex items-center gap-0.5 text-[9px] text-amber-600">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    DV incorrecto
                  </span>
                )}
              </label>
              <input
                type="text"
                value={value}
                onChange={(e) =>
                  setDraft({ ...draft, [key]: e.target.value })
                }
                onBlur={(e) => {
                  // Auto-formatear RUT al desfoco si es válido
                  if (isRut && isValidRut(e.target.value)) {
                    setDraft((d) => ({ ...d, rut: formatRut(e.target.value) }));
                  }
                }}
                className={`mt-1 w-full rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-sm ring-1 focus:bg-white focus:outline-none focus:ring-2 ${
                  rutInvalid
                    ? "ring-amber-300 focus:ring-amber-500"
                    : "ring-hairline focus:ring-cehta-green"
                }`}
                placeholder={isRut ? "12.345.678-9" : undefined}
              />
            </div>
          );
        })}
      </div>

      {/* Toggle activo */}
      <div className="mt-4 flex items-center gap-3 rounded-xl bg-ink-50/40 p-3">
        <button
          type="button"
          onClick={() => setDraft({ ...draft, activo: !draft.activo })}
          className={`inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            draft.activo ? "bg-cehta-green" : "bg-ink-300"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              draft.activo ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        <div className="flex items-center gap-1.5 text-xs">
          {draft.activo ? (
            <>
              <CheckCircle2
                className="h-3.5 w-3.5 text-cehta-green"
                strokeWidth={1.75}
              />
              <span className="text-ink-700">Empresa activa</span>
            </>
          ) : (
            <>
              <XCircle
                className="h-3.5 w-3.5 text-ink-400"
                strokeWidth={1.75}
              />
              <span className="text-ink-500">
                Inactiva · sigue apareciendo en selectores históricos
              </span>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            // Solo enviar campos que cambiaron.
            // Comparación normalizada: null DB ↔ "" UI son equivalentes.
            const changes: Partial<typeof draft> = {};
            (Object.keys(draft) as (keyof typeof draft)[]).forEach((k) => {
              const draftVal = draft[k];
              const origVal = (empresa as unknown as Record<string, unknown>)[k];
              // Booleanos (activo): comparación directa
              if (typeof draftVal === "boolean") {
                if (draftVal !== origVal) {
                  (changes as Record<string, unknown>)[k] = draftVal;
                }
                return;
              }
              // Strings: normalizar null/undefined ↔ ""
              const draftNorm = (draftVal as string) ?? "";
              const origNorm = (origVal as string | null | undefined) ?? "";
              if (draftNorm !== origNorm) {
                // Mandar null si el user borró el contenido
                (changes as Record<string, unknown>)[k] =
                  draftNorm === "" ? null : draftNorm;
              }
            });
            if (Object.keys(changes).length === 0) {
              toast.error("Sin cambios para guardar");
              return;
            }
            saveMut.mutate(changes);
          }}
          disabled={saveMut.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saveMut.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          Guardar cambios
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-500 hover:text-ink-700"
        >
          Cancelar
        </button>
      </div>

      <p className="mt-3 text-[10px] italic text-ink-400">
        <Building2 className="inline h-3 w-3" strokeWidth={1.75} /> Cualquier
        cambio queda registrado en core.audit_log con before/after.
      </p>
    </div>
  );
}
