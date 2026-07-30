"use client";

/**
 * ProveedorContactosPanel — MEGAPROMPT PROVEEDOR-ENCARGADOS.
 *
 * Catálogo de personas de contacto de un proveedor (core.proveedor_contactos).
 * Lo que se carga acá es lo que después aparece como selector "Dirigido a"
 * al crear una OC — reemplaza tener que re-tipear el nombre del encargado
 * cada vez, y deja que el PDF salga con "Atte. Señor/a: Fulano, Cargo".
 *
 * El contacto elegido se SNAPSHOTEA en la OC al crearla (atte_nombre/
 * atte_cargo): si acá se edita o borra a la persona después, las OC ya
 * emitidas no cambian de destinatario retroactivamente.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Star,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Surface } from "@/components/ui/surface";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ProveedorContacto {
  contacto_id: number;
  proveedor_id: number;
  nombre: string;
  cargo: string | null;
  email: string | null;
  telefono: string | null;
  orden: number;
  es_default: boolean;
  activo: boolean;
}

interface ContactoFormValues {
  nombre: string;
  cargo: string;
  email: string;
  telefono: string;
  es_default: boolean;
}

interface ContactoPayload {
  nombre: string;
  cargo: string | null;
  email: string | null;
  telefono: string | null;
  es_default: boolean;
}

const EMPTY_FORM: ContactoFormValues = {
  nombre: "",
  cargo: "",
  email: "",
  telefono: "",
  es_default: false,
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

export function ProveedorContactosPanel({
  proveedorId,
  razonSocial,
}: {
  proveedorId: number;
  razonSocial: string;
}) {
  const { session } = useSession();
  const qc = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editando, setEditando] = useState<ProveedorContacto | null>(null);

  const basePath = `/proveedores/${proveedorId}/contactos`;
  const qKey = useMemo(() => ["proveedor-contactos", proveedorId], [proveedorId]);

  const contactosQ = useQuery<ProveedorContacto[]>({
    queryKey: qKey,
    queryFn: () => apiClient.get<ProveedorContacto[]>(basePath, session),
    enabled: !!session,
  });

  const contactos = useMemo(() => {
    const lista = [...(contactosQ.data ?? [])];
    lista.sort((a, b) => a.orden - b.orden || a.contacto_id - b.contacto_id);
    return lista;
  }, [contactosQ.data]);

  const crearMut = useMutation<ProveedorContacto, Error, ContactoPayload>({
    mutationFn: (body) =>
      apiClient.post<ProveedorContacto>(basePath, body, session),
    onSuccess: (c) => {
      toast.success(`${c.nombre} quedó agregado como contacto de ${razonSocial}.`);
      setFormOpen(false);
      setEditando(null);
      void qc.invalidateQueries({ queryKey: qKey });
    },
    onError: (e) =>
      toast.error(mensajeError(e, "No se pudo agregar el contacto.")),
  });

  const editarMut = useMutation<
    ProveedorContacto,
    Error,
    { contactoId: number; body: Partial<ContactoPayload>; aviso?: string }
  >({
    mutationFn: ({ contactoId, body }) =>
      apiClient.patch<ProveedorContacto>(`${basePath}/${contactoId}`, body, session),
    onSuccess: (c, vars) => {
      toast.success(vars.aviso ?? `Datos de ${c.nombre} actualizados.`);
      setFormOpen(false);
      setEditando(null);
      void qc.invalidateQueries({ queryKey: qKey });
    },
    onError: (e) => toast.error(mensajeError(e, "No se pudo guardar el cambio.")),
  });

  const eliminarMut = useMutation<void, Error, ProveedorContacto>({
    mutationFn: (c) => apiClient.delete<void>(`${basePath}/${c.contacto_id}`, session),
    onSuccess: (_r, c) => {
      toast.success(`${c.nombre} se eliminó de los contactos de ${razonSocial}.`);
      void qc.invalidateQueries({ queryKey: qKey });
    },
    onError: (e) => toast.error(mensajeError(e, "No se pudo eliminar el contacto.")),
  });

  const filaOcupada = editarMut.isPending ? editarMut.variables?.contactoId : null;
  const eliminandoId = eliminarMut.isPending
    ? eliminarMut.variables?.contacto_id
    : null;
  const guardando = crearMut.isPending || editarMut.isPending;

  function abrirNuevo() {
    setEditando(null);
    setFormOpen(true);
  }

  function abrirEdicion(c: ProveedorContacto) {
    setEditando(c);
    setFormOpen(true);
  }

  function guardarForm(values: ContactoFormValues) {
    const body: ContactoPayload = {
      nombre: values.nombre.trim(),
      cargo: limpiar(values.cargo),
      email: limpiar(values.email),
      telefono: limpiar(values.telefono),
      es_default: values.es_default,
    };
    if (editando) {
      editarMut.mutate({ contactoId: editando.contacto_id, body });
    } else {
      crearMut.mutate(body);
    }
  }

  function togglePrincipal(c: ProveedorContacto) {
    editarMut.mutate({
      contactoId: c.contacto_id,
      body: { es_default: !c.es_default },
      aviso: c.es_default
        ? `${c.nombre} ya no es el contacto principal.`
        : `${c.nombre} queda como contacto principal — se preselecciona al crear una OC.`,
    });
  }

  return (
    <Surface>
      <Surface.Header divider>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-ink-500" strokeWidth={1.5} />
            <Surface.Title>Encargados</Surface.Title>
          </div>
          <button
            type="button"
            onClick={abrirNuevo}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-1.5 text-xs font-medium text-white transition-colors ease-apple hover:bg-cehta-green-700"
          >
            <UserPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Agregar encargado
          </button>
        </div>
      </Surface.Header>
      <Surface.Body>
        <p className="mb-4 text-xs text-ink-500">
          Personas de contacto de {razonSocial}. Al crear una OC podés elegir
          a quién va dirigida ("Atte. Señor/a") con un click en vez de
          tipearlo cada vez.
        </p>
        {contactosQ.isLoading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-ink-100/50" />
            ))}
          </div>
        ) : contactosQ.isError ? (
          <div className="flex items-start gap-2 rounded-xl bg-negative/5 p-4 text-sm text-negative ring-1 ring-negative/20">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" strokeWidth={2} />
            <div>
              <p className="font-medium">No se pudieron cargar los encargados.</p>
              <p className="mt-0.5 text-xs">
                {mensajeError(contactosQ.error, "Error desconocido.")}
              </p>
            </div>
          </div>
        ) : contactos.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-hairline bg-ink-50/30 p-6 text-center">
            <Users className="mx-auto h-8 w-8 text-ink-300" strokeWidth={1.5} />
            <p className="mt-2 text-sm text-ink-500">
              Sin encargados cargados. Agregá a la persona a quien va dirigida
              la OC.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline/70">
            {contactos.map((c) => (
              <li key={c.contacto_id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-[10rem] flex-1">
                  <p className="text-sm font-medium text-ink-900">{c.nombre}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {c.cargo ?? "Sin cargo cargado"}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-400">
                    {c.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" strokeWidth={1.75} />
                        {c.email}
                      </span>
                    )}
                    {c.telefono && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" strokeWidth={1.75} />
                        {c.telefono}
                      </span>
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={c.es_default}
                  onClick={() => togglePrincipal(c)}
                  disabled={filaOcupada === c.contacto_id}
                  title={
                    c.es_default
                      ? "Contacto principal — se preselecciona al crear una OC."
                      : "Click para hacerlo el contacto principal."
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors ease-apple disabled:opacity-50 ${
                    c.es_default
                      ? "bg-cehta-green/10 text-cehta-green ring-cehta-green/30 hover:bg-cehta-green/15"
                      : "bg-white text-ink-500 ring-hairline hover:bg-ink-50"
                  }`}
                >
                  {filaOcupada === c.contacto_id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Star
                      className="h-3.5 w-3.5"
                      strokeWidth={2}
                      fill={c.es_default ? "currentColor" : "none"}
                    />
                  )}
                  {c.es_default ? "Principal" : "Hacer principal"}
                </button>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => abrirEdicion(c)}
                    aria-label={`Editar a ${c.nombre}`}
                    className="rounded-lg p-2 text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
                    title="Editar"
                  >
                    <Pencil className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <ConfirmDeleteDialog
                    title={`Eliminar a ${c.nombre}`}
                    description={
                      <>
                        Deja de aparecer al elegir "Dirigido a" en las OC
                        nuevas de {razonSocial}. Las OC ya emitidas con este
                        contacto no cambian.
                      </>
                    }
                    confirmText="Eliminar"
                    onConfirm={() => eliminarMut.mutateAsync(c)}
                    trigger={
                      <button
                        type="button"
                        aria-label={`Eliminar a ${c.nombre}`}
                        disabled={eliminandoId === c.contacto_id}
                        className="rounded-lg p-2 text-ink-500 transition-colors hover:bg-negative/10 hover:text-negative disabled:opacity-50"
                        title="Eliminar"
                      >
                        {eliminandoId === c.contacto_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                        )}
                      </button>
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Surface.Body>

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
              {editando ? `Editar a ${editando.nombre}` : "Agregar encargado"}
            </DialogTitle>
            <DialogDescription>
              {editando
                ? "Los cambios se ven en las OC nuevas. Las OC ya emitidas quedan como están."
                : `Sumá a alguien como contacto de ${razonSocial}.`}
            </DialogDescription>
          </DialogHeader>
          <ContactoForm
            inicial={
              editando
                ? {
                    nombre: editando.nombre,
                    cargo: editando.cargo ?? "",
                    email: editando.email ?? "",
                    telefono: editando.telefono ?? "",
                    es_default: editando.es_default,
                  }
                : EMPTY_FORM
            }
            guardando={guardando}
            textoBoton={editando ? "Guardar cambios" : "Agregar"}
            onCancelar={() => {
              setFormOpen(false);
              setEditando(null);
            }}
            onGuardar={guardarForm}
          />
        </DialogContent>
      </Dialog>
    </Surface>
  );
}

function ContactoForm({
  inicial,
  guardando,
  textoBoton,
  onCancelar,
  onGuardar,
}: {
  inicial: ContactoFormValues;
  guardando: boolean;
  textoBoton: string;
  onCancelar: () => void;
  onGuardar: (values: ContactoFormValues) => void;
}) {
  const [values, setValues] = useState<ContactoFormValues>(inicial);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ContactoFormValues>(
    campo: K,
    valor: ContactoFormValues[K],
  ) => setValues((prev) => ({ ...prev, [campo]: valor }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (guardando) return;
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
      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Nombre y apellido<span className="ml-1 text-negative">*</span>
        </label>
        <input
          autoFocus
          value={values.nombre}
          onChange={(e) => set("nombre", e.target.value)}
          maxLength={200}
          placeholder="Ej: María Pérez Soto"
          className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Cargo
        </label>
        <input
          value={values.cargo}
          onChange={(e) => set("cargo", e.target.value)}
          maxLength={120}
          placeholder="Ej: Ejecutiva de Ventas"
          className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        />
        <p className="mt-1 text-xs text-ink-400">Sale impreso en la OC junto al nombre.</p>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Correo
        </label>
        <input
          type="email"
          value={values.email}
          onChange={(e) => set("email", e.target.value)}
          placeholder="nombre@proveedor.cl"
          className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Teléfono
        </label>
        <input
          value={values.telefono}
          onChange={(e) => set("telefono", e.target.value)}
          maxLength={40}
          placeholder="+56 9 1234 5678"
          className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        />
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-ink-50/60 p-3">
        <input
          type="checkbox"
          checked={values.es_default}
          onChange={(e) => set("es_default", e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-hairline text-cehta-green focus:ring-cehta-green"
        />
        <span>
          <span className="block text-sm font-medium text-ink-900">
            Contacto principal
          </span>
          <span className="block text-xs text-ink-500">
            Se preselecciona como "Dirigido a" al crear una OC nueva para este proveedor.
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
