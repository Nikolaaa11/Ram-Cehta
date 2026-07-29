"use client";

/**
 * EquipoFirmantesPanel — MEGAPROMPT F3.
 *
 * Catálogo de personas que firman las OC de cada empresa (core.empresa_equipo).
 * Lo que se carga acá es lo que después aparece como chip clickeable al
 * preparar una OC, y lo que sale impreso en el bloque de firmas del PDF.
 *
 * Por qué esta pantalla existe separada del detalle de la OC: el equipo casi
 * no cambia (5 personas fijas en RHO, p.ej.) mientras que las OC son cientos.
 * Cargar la gente una vez acá evita re-escribir los mismos 5 nombres en cada
 * orden — que es exactamente el dolor que reportó el usuario.
 *
 * Detalles no obvios:
 *  - El `orden` de esta lista es el orden de impresión en el PDF. Por eso las
 *    flechas ↑/↓ mandan la lista COMPLETA de ids al backend (PUT .../orden):
 *    el backend reasigna 1..N de una, sin huecos ni empates.
 *  - `es_default` alimenta un trigger de BD que sincroniza
 *    empresas.oc_firmantes / firmantes_extra. Nunca tocamos esas columnas
 *    desde el front — solo movemos el flag del miembro.
 *  - DELETE puede responder 204 (borrado real) o 200 con un mensaje cuando la
 *    persona ya firmó alguna OC: en ese caso el backend la DESACTIVA para no
 *    romper la trazabilidad de firmas históricas. Mostramos ese mensaje tal
 *    cual, sin reinterpretarlo.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Info,
  Loader2,
  Mail,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Star,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { useActiveEmpresa } from "@/hooks/use-active-empresa";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Contrato con el backend (declarado local a propósito) ─────────────────
// frontend/types/api.ts está desactualizado y no tiene estos schemas; se
// regenera aparte. Estas interfaces son 1:1 con MiembroRead / MiembroCreate
// de backend/app/api/v1/oc_equipo.py.

export interface MiembroEquipo {
  miembro_id: number;
  empresa_codigo: string;
  nombre: string;
  cargo: string | null;
  email: string | null;
  rut: string | null;
  orden: number;
  es_default: boolean;
  activo: boolean;
  /** TRUE si existe un usuario en la plataforma con ese email. El que no
   *  tiene cuenta no puede firmar electrónicamente: firma a mano el PDF. */
  tiene_cuenta: boolean;
}

interface MiembroFormValues {
  nombre: string;
  cargo: string;
  email: string;
  rut: string;
  es_default: boolean;
}

/** Body de POST/PATCH. Los vacíos viajan como null para que el backend limpie
 *  el campo en vez de guardar "" (que rompería el índice único de email). */
interface MiembroPayload {
  nombre: string;
  cargo: string | null;
  email: string | null;
  rut: string | null;
  es_default: boolean;
}

/** Body del PATCH: todo opcional, más `activo` (que solo se toca al dar de
 *  baja / reactivar, nunca desde el formulario). */
interface MiembroPatch extends Partial<MiembroPayload> {
  activo?: boolean;
}

/** Respuesta del DELETE cuando el backend devuelve 200 en vez de 204 (la
 *  persona ya firmó una OC → se desactiva, no se borra). Aceptamos las tres
 *  llaves habituales del backend para no perder el mensaje. */
interface BajaResultado {
  detail?: string | null;
  message?: string | null;
  mensaje?: string | null;
}

const EMPTY_FORM: MiembroFormValues = {
  nombre: "",
  cargo: "",
  email: "",
  rut: "",
  es_default: true,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function limpiar(v: string): string | null {
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function mensajeError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.detail;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** Intercambia dos posiciones adyacentes. Devuelve la misma lista si el
 *  destino cae fuera de rango (noUncheckedIndexedAccess: los índices pueden
 *  ser undefined, así que verificamos antes de escribir). */
function intercambiar<T>(lista: T[], desde: number, hacia: number): T[] {
  if (hacia < 0 || hacia >= lista.length) return lista;
  const copia = [...lista];
  const a = copia[desde];
  const b = copia[hacia];
  if (a === undefined || b === undefined) return lista;
  copia[desde] = b;
  copia[hacia] = a;
  return copia;
}

export function EquipoFirmantesPanel() {
  const { session } = useSession();
  const qc = useQueryClient();
  const { data: empresas = [], isLoading: cargandoEmpresas } =
    useCatalogoEmpresas();
  const { active: empresaActiva } = useActiveEmpresa();

  const [empresa, setEmpresa] = useState<string>("");
  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState<MiembroEquipo | null>(null);

  // Primera empresa por default: la que el usuario tiene "activa" en el
  // sidebar si existe en el catálogo; si no, la primera de la lista. Solo
  // corre una vez (cuando aún no hay selección) para no pisar al usuario.
  useEffect(() => {
    if (empresa || empresas.length === 0) return;
    const preferida = empresas.find((e) => e.codigo === empresaActiva);
    setEmpresa(preferida?.codigo ?? empresas[0]?.codigo ?? "");
  }, [empresa, empresas, empresaActiva]);

  const empresaItems = useMemo<ComboboxItem[]>(
    () =>
      empresas.map((e) => ({
        value: e.codigo,
        label: `${e.codigo} — ${e.razon_social}`,
      })),
    [empresas],
  );

  const qKey = useMemo(() => ["oc-equipo", empresa], [empresa]);
  const basePath = `/empresas/${encodeURIComponent(empresa)}/equipo`;

  const equipoQ = useQuery<MiembroEquipo[]>({
    queryKey: qKey,
    queryFn: () => apiClient.get<MiembroEquipo[]>(basePath, session),
    enabled: !!session && !!empresa,
  });

  const miembros = useMemo(() => {
    const lista = [...(equipoQ.data ?? [])];
    // El backend ya ordena, pero re-ordenamos por si acaso: `orden` manda y
    // el id desempata para que la lista nunca "salte" entre renders.
    lista.sort((a, b) => a.orden - b.orden || a.miembro_id - b.miembro_id);
    return lista;
  }, [equipoQ.data]);

  const activos = useMemo(() => miembros.filter((m) => m.activo), [miembros]);
  const inactivos = useMemo(
    () => miembros.filter((m) => !m.activo),
    [miembros],
  );
  const habituales = activos.filter((m) => m.es_default).length;
  const sinCuenta = activos.filter((m) => m.es_default && !m.tiene_cuenta);

  // ── Mutaciones ─────────────────────────────────────────────────────────

  const crearMut = useMutation<MiembroEquipo, Error, MiembroPayload>({
    mutationFn: (body) =>
      apiClient.post<MiembroEquipo>(basePath, body, session),
    onSuccess: (m) => {
      toast.success(`${m.nombre} quedó agregado al equipo de ${empresa}.`);
      setFormOpen(false);
      setEditando(null);
      void qc.invalidateQueries({ queryKey: qKey });
    },
    onError: (e) =>
      toast.error(mensajeError(e, "No se pudo agregar a la persona.")),
  });

  const editarMut = useMutation<
    MiembroEquipo,
    Error,
    { miembroId: number; body: MiembroPatch; aviso?: string }
  >({
    mutationFn: ({ miembroId, body }) =>
      apiClient.patch<MiembroEquipo>(`${basePath}/${miembroId}`, body, session),
    onSuccess: (m, vars) => {
      toast.success(vars.aviso ?? `Datos de ${m.nombre} actualizados.`);
      setFormOpen(false);
      setEditando(null);
      void qc.invalidateQueries({ queryKey: qKey });
    },
    onError: (e) =>
      toast.error(mensajeError(e, "No se pudo guardar el cambio.")),
  });

  const eliminarMut = useMutation<
    BajaResultado | undefined,
    Error,
    MiembroEquipo
  >({
    mutationFn: (m) =>
      apiClient.delete<BajaResultado | undefined>(
        `${basePath}/${m.miembro_id}`,
        session,
      ),
    onSuccess: (res, m) => {
      // 204 → apiClient devuelve undefined: borrado real.
      // 200 con body → la persona ya firmó alguna OC y el backend la
      // desactivó. Mostramos SU mensaje, sin adornarlo.
      const delBackend =
        res && typeof res === "object"
          ? (res.detail ?? res.message ?? res.mensaje ?? null)
          : null;
      if (typeof delBackend === "string" && delBackend.trim()) {
        toast.info(delBackend, { duration: 10_000 });
      } else {
        toast.success(`${m.nombre} salió del equipo de ${empresa}.`);
      }
      void qc.invalidateQueries({ queryKey: qKey });
    },
    onError: (e) =>
      toast.error(mensajeError(e, "No se pudo eliminar a la persona.")),
  });

  const ordenMut = useMutation<
    MiembroEquipo[],
    Error,
    number[],
    { previo?: MiembroEquipo[] }
  >({
    mutationFn: (miembro_ids) =>
      apiClient.put<MiembroEquipo[]>(
        `${basePath}/orden`,
        { miembro_ids },
        session,
      ),
    // Optimista: la flecha tiene que sentirse instantánea. Si el backend
    // rechaza, volvemos a la lista anterior y avisamos.
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: qKey });
      const previo = qc.getQueryData<MiembroEquipo[]>(qKey);
      if (previo) {
        const porId = new Map(previo.map((m) => [m.miembro_id, m]));
        const reordenado = ids
          .map((id) => porId.get(id))
          .filter((m): m is MiembroEquipo => m !== undefined)
          .map((m, i) => ({ ...m, orden: i + 1 }));
        qc.setQueryData(qKey, reordenado);
      }
      return { previo };
    },
    // La respuesta ya trae la lista con el orden definitivo: la usamos tal
    // cual en vez de invalidar, para no disparar un GET por cada flechazo.
    onSuccess: (data) => qc.setQueryData(qKey, data),
    onError: (e, _ids, ctx) => {
      if (ctx?.previo) qc.setQueryData(qKey, ctx.previo);
      toast.error(mensajeError(e, "No se pudo cambiar el orden."));
    },
  });

  const filaOcupada = editarMut.isPending ? editarMut.variables?.miembroId : null;
  const eliminandoId = eliminarMut.isPending
    ? eliminarMut.variables?.miembro_id
    : null;

  // ── Handlers ───────────────────────────────────────────────────────────

  function abrirNuevo() {
    setEditando(null);
    setFormOpen(true);
  }

  function abrirEdicion(m: MiembroEquipo) {
    setEditando(m);
    setFormOpen(true);
  }

  function guardarForm(values: MiembroFormValues) {
    const body: MiembroPayload = {
      nombre: values.nombre.trim(),
      cargo: limpiar(values.cargo),
      email: limpiar(values.email),
      rut: limpiar(values.rut),
      es_default: values.es_default,
    };
    if (editando) {
      editarMut.mutate({ miembroId: editando.miembro_id, body });
    } else {
      crearMut.mutate(body);
    }
  }

  function toggleHabitual(m: MiembroEquipo) {
    editarMut.mutate({
      miembroId: m.miembro_id,
      body: { es_default: !m.es_default },
      aviso: m.es_default
        ? `${m.nombre} ya no se agrega solo a las OC nuevas.`
        : `${m.nombre} se va a agregar por defecto a las OC nuevas.`,
    });
  }

  function reactivar(m: MiembroEquipo) {
    editarMut.mutate({
      miembroId: m.miembro_id,
      body: { activo: true },
      aviso: `${m.nombre} vuelve a estar disponible para firmar.`,
    });
  }

  function mover(indice: number, delta: number) {
    const reordenado = intercambiar(activos, indice, indice + delta);
    if (reordenado === activos) return;
    // El contrato pide la lista COMPLETA de ids: mandamos los activos en el
    // orden nuevo y a continuación los desactivados (que no se imprimen).
    ordenMut.mutate([
      ...reordenado.map((m) => m.miembro_id),
      ...inactivos.map((m) => m.miembro_id),
    ]);
  }

  const guardando = crearMut.isPending || editarMut.isPending;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Selector de empresa + botón agregar */}
      <Surface padding="compact">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              Empresa
            </label>
            {cargandoEmpresas ? (
              <div className="h-9 w-64 animate-pulse rounded-xl bg-ink-100/60" />
            ) : (
              <Combobox
                items={empresaItems}
                value={empresa}
                onValueChange={setEmpresa}
                placeholder="Elegí una empresa…"
                searchPlaceholder="Buscar empresa…"
                triggerClassName="w-72"
              />
            )}
            <p className="text-xs text-ink-500">
              Cada empresa tiene su propio equipo de firmantes.
            </p>
          </div>
          <button
            type="button"
            onClick={abrirNuevo}
            disabled={!empresa}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors ease-apple hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" strokeWidth={1.75} />
            Agregar persona
          </button>
        </div>
      </Surface>

      {/* Lista */}
      <Surface padding="compact">
        <Surface.Header divider>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Surface.Title className="flex items-center gap-2">
                <Users className="h-4 w-4 text-cehta-green" strokeWidth={1.5} />
                Equipo de {empresa || "—"}
              </Surface.Title>
              <p className="mt-1 text-xs text-ink-500">
                El orden de esta lista es el orden en que las firmas salen
                impresas en el PDF de la OC, de arriba hacia abajo. Movelas con
                las flechas ↑ ↓.
              </p>
            </div>
            {activos.length > 0 && (
              <span className="text-xs text-ink-500">
                {activos.length} persona{activos.length === 1 ? "" : "s"} ·{" "}
                <strong className="text-ink-700">{habituales}</strong> se
                agrega{habituales === 1 ? "" : "n"} sola
                {habituales === 1 ? "" : "s"} a cada OC nueva
              </span>
            )}
          </div>
        </Surface.Header>

        <Surface.Body>
          {!empresa ? (
            <p className="py-8 text-center text-sm text-ink-500">
              Elegí una empresa arriba para ver su equipo.
            </p>
          ) : equipoQ.isLoading ? (
            <div className="space-y-2 py-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-xl bg-ink-100/50"
                />
              ))}
            </div>
          ) : equipoQ.isError ? (
            <div className="flex items-start gap-2 rounded-xl bg-negative/5 p-4 text-sm text-negative ring-1 ring-negative/20">
              <AlertCircle
                className="mt-0.5 h-4 w-4 flex-shrink-0"
                strokeWidth={2}
              />
              <div>
                <p className="font-medium">No se pudo cargar el equipo.</p>
                <p className="mt-0.5 text-xs">
                  {mensajeError(equipoQ.error, "Error desconocido.")}
                </p>
                <button
                  type="button"
                  onClick={() => void equipoQ.refetch()}
                  className="mt-2 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-ink-700 ring-1 ring-hairline hover:bg-ink-50"
                >
                  Reintentar
                </button>
              </div>
            </div>
          ) : activos.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-hairline bg-ink-50/30 p-8 text-center">
              <Users
                className="mx-auto h-10 w-10 text-ink-300"
                strokeWidth={1.5}
              />
              <p className="mt-3 text-sm text-ink-500">
                {empresa} todavía no tiene gente cargada. Agregá a las personas
                que firman sus órdenes de compra y después las vas a poder
                elegir con un click al preparar cada OC.
              </p>
              <button
                type="button"
                onClick={abrirNuevo}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700"
              >
                <UserPlus className="h-4 w-4" strokeWidth={1.75} />
                Agregar la primera persona
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-hairline/70">
              {activos.map((m, i) => (
                <MiembroRow
                  key={m.miembro_id}
                  miembro={m}
                  posicion={i + 1}
                  esPrimero={i === 0}
                  esUltimo={i === activos.length - 1}
                  ocupada={filaOcupada === m.miembro_id}
                  eliminando={eliminandoId === m.miembro_id}
                  reordenando={ordenMut.isPending}
                  onSubir={() => mover(i, -1)}
                  onBajar={() => mover(i, +1)}
                  onEditar={() => abrirEdicion(m)}
                  onToggleHabitual={() => toggleHabitual(m)}
                  onEliminar={() => eliminarMut.mutateAsync(m)}
                />
              ))}
            </ul>
          )}

          {/* Aviso agregado de firmas manuscritas — no alarmista, informativo */}
          {sinCuenta.length > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
              <Info
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
                strokeWidth={2}
              />
              <p>
                {sinCuenta.length === 1
                  ? `${sinCuenta[0]?.nombre} no tiene cuenta en la plataforma`
                  : `${sinCuenta.length} personas del equipo no tienen cuenta en la plataforma`}
                : el PDF les deja el espacio de firma y ellas firman a mano. Si
                querés que firmen desde acá, pedí que les creen usuario con ese
                mismo correo.
              </p>
            </div>
          )}

          {/* Desactivados: gente que ya firmó alguna OC y por eso no se borra */}
          {inactivos.length > 0 && (
            <div className="mt-5 border-t border-hairline pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                Fuera del equipo ({inactivos.length})
              </p>
              <p className="mt-1 text-xs text-ink-500">
                No aparecen al preparar una OC. Siguen guardados porque ya
                firmaron órdenes anteriores y esas firmas no se pueden borrar.
              </p>
              <ul className="mt-3 space-y-2">
                {inactivos.map((m) => (
                  <li
                    key={m.miembro_id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-ink-50/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink-600">{m.nombre}</p>
                      <p className="truncate text-xs text-ink-400">
                        {m.cargo ?? "Sin cargo"}
                        {m.email ? ` · ${m.email}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => reactivar(m)}
                      disabled={filaOcupada === m.miembro_id}
                      className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-50 disabled:opacity-50"
                      title="Volver a sumarla al equipo"
                    >
                      {filaOcupada === m.miembro_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                      )}
                      Reactivar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Surface.Body>
      </Surface>

      {/* Alta / edición */}
      <Dialog
        open={formOpen}
        onOpenChange={(o) => {
          if (guardando) return;
          setFormOpen(o);
          if (!o) setEditando(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editando ? `Editar a ${editando.nombre}` : "Agregar persona"}
            </DialogTitle>
            <DialogDescription>
              {editando
                ? "Los cambios se ven en las OC nuevas. Las OC ya firmadas quedan como están."
                : `Sumá a alguien al equipo de firmantes de ${empresa}.`}
            </DialogDescription>
          </DialogHeader>
          {/* Radix desmonta el contenido al cerrar, así que el formulario se
              resetea solo cada vez que se abre el diálogo. */}
          <MiembroForm
            inicial={
              editando
                ? {
                    nombre: editando.nombre,
                    cargo: editando.cargo ?? "",
                    email: editando.email ?? "",
                    rut: editando.rut ?? "",
                    es_default: editando.es_default,
                  }
                : EMPTY_FORM
            }
            guardando={guardando}
            textoBoton={editando ? "Guardar cambios" : "Agregar al equipo"}
            onCancelar={() => {
              setFormOpen(false);
              setEditando(null);
            }}
            onGuardar={guardarForm}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Fila de la lista ──────────────────────────────────────────────────────

function MiembroRow({
  miembro,
  posicion,
  esPrimero,
  esUltimo,
  ocupada,
  eliminando,
  reordenando,
  onSubir,
  onBajar,
  onEditar,
  onToggleHabitual,
  onEliminar,
}: {
  miembro: MiembroEquipo;
  posicion: number;
  esPrimero: boolean;
  esUltimo: boolean;
  ocupada: boolean;
  eliminando: boolean;
  reordenando: boolean;
  onSubir: () => void;
  onBajar: () => void;
  onEditar: () => void;
  onToggleHabitual: () => void;
  onEliminar: () => Promise<unknown>;
}) {
  const m = miembro;
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      {/* Flechas de orden */}
      <div className="flex flex-col">
        <button
          type="button"
          onClick={onSubir}
          disabled={esPrimero || reordenando}
          aria-label={`Subir a ${m.nombre} en el orden de firmas`}
          className="rounded-t-lg px-1.5 py-0.5 text-ink-500 ring-1 ring-hairline transition-colors hover:bg-ink-50 hover:text-ink-900 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onBajar}
          disabled={esUltimo || reordenando}
          aria-label={`Bajar a ${m.nombre} en el orden de firmas`}
          className="-mt-px rounded-b-lg px-1.5 py-0.5 text-ink-500 ring-1 ring-hairline transition-colors hover:bg-ink-50 hover:text-ink-900 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ArrowDown className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-ink-400">
        {posicion}
      </span>

      {/* Identidad */}
      <div className="min-w-[12rem] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-ink-900">{m.nombre}</p>
          {m.tiene_cuenta ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive"
              title="Tiene usuario en la plataforma: puede firmar la OC desde acá."
            >
              <ShieldCheck className="h-3 w-3" strokeWidth={2} />
              Firma en la plataforma
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
              title="No tiene usuario en la plataforma."
            >
              <Info className="h-3 w-3" strokeWidth={2} />
              Sin cuenta — firma a mano en el PDF
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-ink-500">
          {m.cargo ?? "Sin cargo cargado"}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-400">
          <Mail className="h-3 w-3" strokeWidth={1.75} />
          {m.email ?? "Sin correo"}
          {m.rut ? <span className="ml-2">RUT {m.rut}</span> : null}
        </p>
      </div>

      {/* Toggle habitual */}
      <button
        type="button"
        role="switch"
        aria-checked={m.es_default}
        onClick={onToggleHabitual}
        disabled={ocupada}
        title={
          m.es_default
            ? "Se agrega solo a cada OC nueva. Click para sacarlo del set por defecto."
            : "Hoy no se agrega solo. Click para que venga cargado en cada OC nueva."
        }
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors ease-apple disabled:opacity-50 ${
          m.es_default
            ? "bg-cehta-green/10 text-cehta-green ring-cehta-green/30 hover:bg-cehta-green/15"
            : "bg-white text-ink-500 ring-hairline hover:bg-ink-50"
        }`}
      >
        {ocupada ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Star
            className="h-3.5 w-3.5"
            strokeWidth={2}
            fill={m.es_default ? "currentColor" : "none"}
          />
        )}
        {m.es_default ? "Habitual" : "Ocasional"}
      </button>

      {/* Acciones */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onEditar}
          aria-label={`Editar a ${m.nombre}`}
          className="rounded-lg p-2 text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
          title="Editar nombre, cargo, correo o RUT"
        >
          <Pencil className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <ConfirmDeleteDialog
          title={`Sacar a ${m.nombre} del equipo`}
          description={
            <>
              Deja de aparecer al preparar las OC de {m.empresa_codigo}. Si esta
              persona ya firmó alguna orden, no se borra: queda desactivada para
              no romper esas firmas.
            </>
          }
          confirmText="Sacar del equipo"
          onConfirm={onEliminar}
          trigger={
            <button
              type="button"
              aria-label={`Eliminar a ${m.nombre}`}
              disabled={eliminando}
              className="rounded-lg p-2 text-ink-500 transition-colors hover:bg-negative/10 hover:text-negative disabled:opacity-50"
              title="Sacar del equipo"
            >
              {eliminando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              )}
            </button>
          }
        />
      </div>
    </li>
  );
}

// ── Formulario del diálogo ────────────────────────────────────────────────

function MiembroForm({
  inicial,
  guardando,
  textoBoton,
  onCancelar,
  onGuardar,
}: {
  inicial: MiembroFormValues;
  guardando: boolean;
  textoBoton: string;
  onCancelar: () => void;
  onGuardar: (values: MiembroFormValues) => void;
}) {
  const [values, setValues] = useState<MiembroFormValues>(inicial);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof MiembroFormValues>(
    campo: K,
    valor: MiembroFormValues[K],
  ) => setValues((prev) => ({ ...prev, [campo]: valor }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (guardando) return;
    // Mismos límites que el schema del backend (nombre 2..200, cargo 120,
    // rut 20) para que el error se vea acá y no como un 422 críptico.
    if (values.nombre.trim().length < 2) {
      setError("Escribí el nombre completo (al menos 2 letras).");
      return;
    }
    const email = values.email.trim();
    if (email && !EMAIL_RE.test(email)) {
      setError("Revisá el correo: no parece una dirección válida.");
      return;
    }
    setError(null);
    onGuardar(values);
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <Campo label="Nombre y apellido" requerido>
        <input
          autoFocus
          value={values.nombre}
          onChange={(e) => set("nombre", e.target.value)}
          maxLength={200}
          placeholder="Ej: Javier Álvarez Abarca"
          className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        />
      </Campo>

      <Campo
        label="Cargo"
        ayuda="Sale impreso debajo de la firma en el PDF."
      >
        <input
          value={values.cargo}
          onChange={(e) => set("cargo", e.target.value)}
          maxLength={120}
          placeholder="Ej: Gerente General"
          className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        />
      </Campo>

      <Campo
        label="Correo"
        ayuda="Si tiene cuenta en la plataforma con ese correo, va a poder firmar desde acá. Si no, firma a mano."
      >
        <input
          type="email"
          value={values.email}
          onChange={(e) => set("email", e.target.value)}
          placeholder="nombre@empresa.cl"
          className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        />
      </Campo>

      <Campo label="RUT" ayuda="Opcional.">
        <input
          value={values.rut}
          onChange={(e) => set("rut", e.target.value)}
          maxLength={20}
          placeholder="12.345.678-9"
          className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        />
      </Campo>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-ink-50/60 p-3">
        <input
          type="checkbox"
          checked={values.es_default}
          onChange={(e) => set("es_default", e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-hairline text-cehta-green focus:ring-cehta-green"
        />
        <span>
          <span className="block text-sm font-medium text-ink-900">
            Incluir por defecto en las OC
          </span>
          <span className="block text-xs text-ink-500">
            Viene precargado en cada orden nueva de esta empresa. Igual lo podés
            sacar con un click en la OC puntual.
          </span>
        </span>
      </label>

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-negative">
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
          {error}
        </p>
      )}

      <DialogFooter>
        <button
          type="button"
          onClick={onCancelar}
          disabled={guardando}
          className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-50 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={guardando}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-50"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          {guardando ? "Guardando…" : textoBoton}
        </button>
      </DialogFooter>
    </form>
  );
}

function Campo({
  label,
  requerido,
  ayuda,
  children,
}: {
  label: string;
  requerido?: boolean;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
        {label}
        {requerido && <span className="ml-1 text-negative">*</span>}
      </label>
      {children}
      {ayuda && <p className="mt-1 text-xs text-ink-400">{ayuda}</p>}
    </div>
  );
}
