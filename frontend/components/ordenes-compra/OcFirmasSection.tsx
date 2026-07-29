"use client";

/**
 * OC-FIRMANTES-EXTERNOS — el picker de firmantes del detalle de OC.
 *
 * Lo que pidió el operador: "que se pueda añadir y sacar a las personas que
 * firman haciendo click en el integrante". De ahí las dos decisiones que
 * mandan en este componente:
 *
 *  1. Armar el set NO manda correos. Cada toggle hace PUT con
 *     notificar=false, que el backend trata como "preparar la OC": no
 *     invita a nadie ni mueve el estado. Los mails salen SOLO desde
 *     "Enviar a firma", con confirmación previa diciendo a cuántos.
 *  2. Guardado automático y optimista. El chip se pinta en el acto y, si el
 *     PUT falla, se deshace y el toast dice por qué. Un botón "Guardar"
 *     obligaría a un no-ingeniero a acordarse de apretarlo, y una OC que
 *     "parecía" tener firmantes y no los tenía es un problema real.
 *
 * Una sola query (`/ordenes-compra/{id}/firmas`) trae firmas + equipo +
 * sugeridos; toda mutación responde ese mismo shape, así que la pantalla se
 * actualiza con la respuesta y recién después revalida.
 *
 * Los tipos se declaran acá a propósito: `types/api.ts` está desactualizado
 * y no tiene el shape de firmas.
 */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  Lock,
  PenLine,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AgregarExternoDialog,
  type ExternoNuevo,
} from "@/components/ordenes-compra/AgregarExternoDialog";
import { FirmarDialog } from "@/components/ordenes-compra/FirmarDialog";

// ---------------------------------------------------------------------------
// Tipos (espejo de app/schemas/oc_firma.py + oc_equipo.py)
// ---------------------------------------------------------------------------

interface Miembro {
  miembro_id: number;
  empresa_codigo: string;
  nombre: string;
  cargo: string | null;
  email: string | null;
  rut: string | null;
  orden: number;
  es_default: boolean;
  activo: boolean;
  tiene_cuenta: boolean;
}

interface Firma {
  firma_id: number;
  firmante_email: string;
  firmante_nombre: string | null;
  firmante_cargo: string | null;
  orden: number;
  status: string; // PENDIENTE | FIRMADA | RECHAZADA
  signed_at: string | null;
  notified_at: string | null;
  reminder_sent_at: string | null;
  comments: string | null;
  es_mi_firma: boolean;
  es_externo: boolean;
  empresa_firmante: string | null;
  sin_email: boolean;
  /** Texto manuscrito estampado al firmar. Sólo viene en firmas FIRMADA. */
  firma_visual: string | null;
}

interface Sugerido {
  email: string;
  nombre: string | null;
  cargo: string | null;
}

interface FirmasResponse {
  oc_id: number;
  numero_oc: string;
  estado: string;
  firmas: Firma[];
  sugeridos: Sugerido[];
  equipo: Miembro[];
  puedo_firmar: boolean;
  pendientes: number;
}

/** Lo que viaja en el PUT replace-all. */
interface FirmantePayload {
  email: string | null;
  nombre: string;
  cargo: string | null;
  es_externo: boolean;
  empresa_firmante: string | null;
}

interface FirmarResponse {
  ok: boolean;
  estado: string;
  completamente_firmada: boolean;
  enviada_proveedor: boolean;
  proveedor_email: string | null;
  detalle: string | null;
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

// Mismos estados que `_ESTADOS_ASIGNABLES` del backend: fuera de estos, el
// PUT devuelve 409. Preferimos deshabilitar la UI antes que dejar clickear
// para que salte un error.
const ESTADOS_EDITABLES = new Set(["emitida", "borrador", "en_firma"]);

/**
 * Identidad de un firmante — replica `_clave_firmante` del backend: con
 * correo manda el correo (es lo único estable), sin correo el nombre.
 */
function claveFirma(f: Firma): string {
  return f.sin_email
    ? `nombre:${(f.firmante_nombre ?? "").trim().toLowerCase()}`
    : f.firmante_email.trim().toLowerCase();
}

function claveMiembro(m: Miembro): string {
  const email = (m.email ?? "").trim().toLowerCase();
  return email || `nombre:${m.nombre.trim().toLowerCase()}`;
}

/** Externos primero: es el orden en que el PDF imprime las firmas. */
function ordenar(firmas: Firma[]): Firma[] {
  return [...firmas].sort((a, b) => {
    if (a.es_externo !== b.es_externo) return a.es_externo ? -1 : 1;
    if (a.orden !== b.orden) return a.orden - b.orden;
    return a.firma_id - b.firma_id;
  });
}

function renumerar(firmas: Firma[]): Firma[] {
  return ordenar(firmas).map((f, i) => ({ ...f, orden: i + 1 }));
}

function aPayload(firmas: Firma[]): FirmantePayload[] {
  return ordenar(firmas).map((f) => ({
    email: f.sin_email ? null : f.firmante_email,
    // `nombre` es obligatorio (min 2) del lado del backend; el email siempre
    // sirve de fallback legible si la fila vieja quedó sin nombre.
    nombre: (f.firmante_nombre ?? "").trim() || f.firmante_email,
    cargo: f.firmante_cargo,
    es_externo: f.es_externo,
    empresa_firmante: f.empresa_firmante,
  }));
}

const fmtFecha = (iso: string): string =>
  new Date(iso).toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const plural = (n: number, sing: string, plur: string): string =>
  `${n} ${n === 1 ? sing : plur}`;

const msgError = (e: unknown, fallback: string): string =>
  e instanceof ApiError ? e.detail : e instanceof Error ? e.message : fallback;

const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ease-apple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
const btnGhost = `${btnBase} bg-white text-ink-700 ring-1 ring-hairline hover:bg-ink-100/40`;
const btnPrimary = `${btnBase} bg-cehta-green text-white hover:bg-cehta-green-700`;

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function OcFirmasSection({
  ocId,
  empresaCodigo,
}: {
  ocId: number;
  empresaCodigo: string;
}) {
  const { session } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const [motivoOpen, setMotivoOpen] = useState(false);
  const [firmarOpen, setFirmarOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  // Ids negativos para las filas optimistas: nunca chocan con un BIGSERIAL
  // real y la respuesta del servidor los reemplaza enseguida.
  const tempId = useRef(-1);

  const queryKey = useMemo(() => ["oc-firmas", String(ocId)], [ocId]);

  const q = useApiQuery<FirmasResponse>(
    queryKey,
    `/ordenes-compra/${ocId}/firmas`,
  );

  const data = q.data;
  const firmas = useMemo(() => ordenar(data?.firmas ?? []), [data?.firmas]);
  const equipo = data?.equipo ?? [];
  const editable = ESTADOS_EDITABLES.has(data?.estado ?? "");

  const clavesPuestas = useMemo(
    () => new Map(firmas.map((f) => [claveFirma(f), f])),
    [firmas],
  );

  const miFirma = firmas.find((f) => f.es_mi_firma && f.status === "PENDIENTE");
  const firmadas = firmas.filter((f) => f.status === "FIRMADA").length;
  const rechazadas = firmas.filter((f) => f.status === "RECHAZADA").length;
  const manuscritas = firmas.filter((f) => f.sin_email).length;
  // El backend invita SOLO a PENDIENTE con notified_at NULL y correo real.
  const aNotificar = firmas.filter(
    (f) => f.status === "PENDIENTE" && !f.sin_email && !f.notified_at,
  ).length;

  const setCache = (resp: FirmasResponse) => qc.setQueryData(queryKey, resp);
  const revalidar = () => void qc.invalidateQueries({ queryKey });

  // — Guardado del set (auto-save optimista) ————————————————————————
  // `scope` serializa las mutaciones: con clicks rápidos, dos PUT en vuelo
  // podrían llegar al servidor al revés y dejar el set anterior como final.
  const guardar = useMutation<FirmasResponse, Error, Firma[], { prev?: FirmasResponse }>({
    scope: { id: `oc-firmas-${ocId}` },
    mutationFn: (next) =>
      apiClient.put<FirmasResponse>(
        `/ordenes-compra/${ocId}/firmantes`,
        { firmantes: aPayload(next), notificar: false },
        session,
      ),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<FirmasResponse>(queryKey);
      if (prev) {
        qc.setQueryData<FirmasResponse>(queryKey, {
          ...prev,
          firmas: renumerar(next),
          pendientes: next.filter((f) => f.status === "PENDIENTE").length,
        });
      }
      return { prev };
    },
    onError: (err, _next, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      toast.error(
        msgError(err, "No se pudo guardar el cambio — se deshizo."),
        { duration: 9_000 },
      );
    },
    onSuccess: setCache,
    onSettled: revalidar,
  });

  // — Plantillas (habituales / OC anterior) ——————————————————————————
  const plantilla = useMutation<
    FirmasResponse,
    Error,
    "default" | "anterior",
    { antes: number }
  >({
    scope: { id: `oc-firmas-${ocId}` },
    mutationFn: (origen) =>
      apiClient.post<FirmasResponse>(
        `/ordenes-compra/${ocId}/firmantes/aplicar-plantilla`,
        { origen },
        session,
      ),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey });
      return {
        antes: qc.getQueryData<FirmasResponse>(queryKey)?.firmas.length ?? 0,
      };
    },
    onSuccess: (resp, origen, ctx) => {
      setCache(resp);
      const nuevos = resp.firmas.length - (ctx?.antes ?? 0);
      const de =
        origen === "default" ? "los firmantes habituales" : "la OC anterior";
      if (nuevos <= 0) {
        toast.info(`Ya estaban todos ${de} en esta OC. No cambió nada.`);
      } else {
        toast.success(
          `${plural(nuevos, "firmante agregado", "firmantes agregados")} desde ${de}. ` +
            "Todavía no se mandó ningún correo.",
        );
      }
    },
    onError: (err) => {
      // 404 = "esta empresa no tiene habituales" / "no hay OC anterior". Es
      // información, no una falla: en rojo asustaría al operador.
      if (err instanceof ApiError && err.status === 404) {
        toast.info(err.detail, { duration: 10_000 });
        return;
      }
      toast.error(msgError(err, "No se pudo aplicar la plantilla."));
    },
    onSettled: revalidar,
  });

  // — Enviar a firma (ÚNICA acción que dispara correos) —————————————
  const enviar = useMutation<FirmasResponse, Error, void>({
    scope: { id: `oc-firmas-${ocId}` },
    mutationFn: () =>
      apiClient.post<FirmasResponse>(
        `/ordenes-compra/${ocId}/enviar-a-firma`,
        {},
        session,
      ),
    onSuccess: (resp) => {
      setCache(resp);
      toast.success(
        aNotificar > 0
          ? `Invitación enviada a ${plural(aNotificar, "persona", "personas")}. ` +
              "La OC quedó en firma."
          : "La OC quedó en firma. No hubo correos nuevos que enviar.",
        { duration: 9_000 },
      );
      router.refresh(); // el badge de estado del header lo pinta el server
    },
    onError: (err) =>
      toast.error(msgError(err, "No se pudo enviar a firma."), {
        duration: 9_000,
      }),
    onSettled: revalidar,
  });

  // — Mi firma ————————————————————————————————————————————————————
  // Recibe el texto manuscrito que la persona aceptó (nombre y apellido).
  // Se manda tal cual: el backend lo congela en la firma para que quede
  // estampado en el PDF aunque después cambien el nombre en el catálogo.
  const firmarMut = useMutation<FirmarResponse, Error, string>({
    mutationFn: (firmaVisual) =>
      apiClient.post<FirmarResponse>(
        `/ordenes-compra/${ocId}/firmar`,
        { comments: null, firma_visual: firmaVisual },
        session,
      ),
    onSuccess: (resp) => {
      setFirmarOpen(false);
      if (resp.completamente_firmada) {
        toast.success(
          resp.enviada_proveedor
            ? `OC firmada por todos y enviada al proveedor (${resp.proveedor_email ?? "correo del proveedor"}).`
            : `OC firmada por todos. ${resp.detalle ?? ""}`.trim(),
          { duration: 12_000 },
        );
      } else {
        toast.success("Tu firma quedó registrada. Faltan las demás.");
      }
      router.refresh();
    },
    onError: (err) => toast.error(msgError(err, "No se pudo firmar la OC.")),
    onSettled: revalidar,
  });

  const rechazarMut = useMutation<FirmarResponse, Error, string>({
    mutationFn: (m) =>
      apiClient.post<FirmarResponse>(
        `/ordenes-compra/${ocId}/rechazar-firma`,
        { motivo: m },
        session,
      ),
    onSuccess: () => {
      toast.success(
        "Rechazo registrado. La OC volvió a 'emitida' para corregirla.",
        { duration: 9_000 },
      );
      setMotivoOpen(false);
      setMotivo("");
      router.refresh();
    },
    onError: (err) =>
      toast.error(msgError(err, "No se pudo registrar el rechazo.")),
    onSettled: revalidar,
  });

  const guardando = guardar.isPending;
  const ocupado =
    guardando ||
    plantilla.isPending ||
    enviar.isPending ||
    firmarMut.isPending ||
    rechazarMut.isPending;

  // — Acciones sobre el set ————————————————————————————————————————

  function toggleMiembro(m: Miembro) {
    if (!editable) return;
    const clave = claveMiembro(m);
    const puesta = clavesPuestas.get(clave);
    if (puesta) {
      if (puesta.status === "FIRMADA") {
        toast.info(
          `${puesta.firmante_nombre ?? puesta.firmante_email} ya firmó: su firma no se puede sacar.`,
        );
        return;
      }
      guardar.mutate(firmas.filter((f) => claveFirma(f) !== clave));
      return;
    }
    if (!m.email) {
      toast.info(
        `${m.nombre} no tiene correo cargado. Sin correo no se puede sumar como firmante del equipo — ` +
          "cargalo en el equipo de la empresa, o agregala como firmante externo si firma a mano.",
        { duration: 11_000 },
      );
      return;
    }
    const nueva: Firma = {
      firma_id: tempId.current--,
      firmante_email: m.email.trim().toLowerCase(),
      firmante_nombre: m.nombre,
      firmante_cargo: m.cargo,
      orden: firmas.length + 1,
      status: "PENDIENTE",
      signed_at: null,
      notified_at: null,
      reminder_sent_at: null,
      comments: null,
      es_mi_firma: false,
      es_externo: false,
      empresa_firmante: null,
      sin_email: false,
      firma_visual: null, // todavía no firmó
    };
    guardar.mutate([...firmas, nueva]);
  }

  function quitarFirma(f: Firma) {
    if (!editable || f.status === "FIRMADA") return;
    guardar.mutate(firmas.filter((x) => x.firma_id !== f.firma_id));
  }

  async function agregarExterno(e: ExternoNuevo) {
    const nueva: Firma = {
      firma_id: tempId.current--,
      firmante_email: e.email ?? "",
      firmante_nombre: e.nombre,
      firmante_cargo: e.cargo,
      orden: 0, // los externos van primero
      status: "PENDIENTE",
      signed_at: null,
      notified_at: null,
      reminder_sent_at: null,
      comments: null,
      es_mi_firma: false,
      es_externo: true,
      empresa_firmante: e.empresa_firmante,
      sin_email: !e.email,
      firma_visual: null, // todavía no firmó
    };
    await guardar.mutateAsync([...firmas, nueva]);
  }

  // — Render ————————————————————————————————————————————————————————

  // Sin data hay dos casos y NO alcanza con `isLoading`: mientras la sesión
  // de Supabase resuelve, la query está `enabled: false` (isLoading es false
  // y data undefined) — dar el error rojo ahí sería mentir.
  if (!data) {
    if (q.isError) {
      return (
        <section className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-ink-900">
            Firmantes de la OC
          </h2>
          <div className="rounded-2xl bg-negative/5 p-4 ring-1 ring-negative/20">
            <p className="text-sm font-medium text-negative">
              No se pudieron cargar los firmantes
            </p>
            <p className="mt-1 text-xs text-negative/80">
              {msgError(q.error, "Error desconocido")}
            </p>
            <button
              type="button"
              onClick={() => void q.refetch()}
              className={`${btnGhost} mt-3`}
            >
              <RotateCcw className="h-4 w-4" strokeWidth={1.5} />
              Reintentar
            </button>
          </div>
        </section>
      );
    }
    return (
      <section className="space-y-4" aria-busy="true">
        <Skeleton className="h-5 w-52" />
        <Skeleton className="h-3 w-80" />
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-52 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-40 w-full rounded-2xl" />
      </section>
    );
  }

  return (
    <section className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-ink-900">
            <PenLine className="h-5 w-5 text-cehta-green" strokeWidth={1.5} />
            Firmantes de la OC
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            Clickeá a quienes tienen que firmar. Se guarda solo y{" "}
            <span className="font-medium text-ink-700">
              no se manda ningún correo
            </span>{" "}
            hasta que aprietes “Enviar a firma”.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EstadoGuardado
            pendiente={guardando}
            error={guardar.isError && !guardando}
            ok={guardar.isSuccess && !guardando}
          />
          {editable && (
            <ConfirmDeleteDialog
              tone="neutral"
              confirmText="Enviar invitaciones"
              cancelText="Todavía no"
              title={`¿Enviar la OC ${data.numero_oc} a firma?`}
              description={
                <>
                  {aNotificar > 0 ? (
                    <>
                      Se manda un correo con el PDF a{" "}
                      <span className="font-medium text-ink-900">
                        {plural(aNotificar, "persona", "personas")}
                      </span>
                      . Quien ya fue invitado antes no recibe otro correo.
                    </>
                  ) : (
                    <>
                      Todos los firmantes con correo ya fueron invitados:{" "}
                      <span className="font-medium text-ink-900">
                        no se envía ningún correo nuevo
                      </span>
                      .
                    </>
                  )}
                  {manuscritas > 0 && (
                    <>
                      {" "}
                      {plural(manuscritas, "firmante", "firmantes")} sin correo{" "}
                      {manuscritas === 1 ? "firma" : "firman"} a mano sobre el
                      PDF y no {manuscritas === 1 ? "recibe" : "reciben"} nada.
                    </>
                  )}{" "}
                  La OC queda en estado{" "}
                  <span className="font-medium text-ink-900">en firma</span>.
                </>
              }
              onConfirm={() => enviar.mutateAsync()}
              trigger={
                <button
                  type="button"
                  disabled={ocupado || firmas.length === 0}
                  className={btnPrimary}
                  title={
                    firmas.length === 0
                      ? "Primero cargá al menos un firmante"
                      : undefined
                  }
                >
                  <Send className="h-4 w-4" strokeWidth={1.5} />
                  {enviar.isPending ? "Enviando…" : "Enviar a firma"}
                </button>
              }
            />
          )}
        </div>
      </div>

      {/* ── OC congelada: el set ya no se toca ──────────────────── */}
      {!editable && (
        <div className="flex items-start gap-2 rounded-xl bg-ink-50/60 p-3 text-xs text-ink-600 ring-1 ring-hairline">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" strokeWidth={1.5} />
          <p>
            La OC está en estado{" "}
            <span className="font-medium text-ink-900">{data.estado}</span>: los
            firmantes quedan congelados como registro de lo que se firmó. Para
            cambiarlos hay que anular la OC y emitir una nueva.
          </p>
        </div>
      )}

      {/* ── Mi firma pendiente ──────────────────────────────────── */}
      {miFirma && data.puedo_firmar && (
        <div className="rounded-2xl border border-cehta-green/30 bg-cehta-green/5 p-4">
          <p className="text-sm font-semibold text-cehta-green">
            Te toca firmar esta OC
          </p>
          <p className="mt-1 text-xs text-ink-600">
            Al firmar se registra tu nombre, la fecha, tu IP y un hash de
            verificación. Queda como constancia legal y no se puede deshacer.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => setFirmarOpen(true)}
              className={btnPrimary}
            >
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />
              {firmarMut.isPending ? "Firmando…" : "Firmar"}
            </button>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => setMotivoOpen(true)}
              className={`${btnBase} bg-negative/10 text-negative ring-1 ring-negative/20 hover:bg-negative/15`}
            >
              <XCircle className="h-4 w-4" strokeWidth={1.5} />
              Rechazar
            </button>
          </div>
        </div>
      )}

      {/* ── Equipo: chips clickeables ───────────────────────────── */}
      <div className="rounded-2xl border border-hairline bg-ink-50/30 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            <Users className="h-3.5 w-3.5" strokeWidth={2} />
            Equipo de {empresaCodigo}
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!editable || ocupado}
              onClick={() => plantilla.mutate("default")}
              className={btnGhost}
              title="Carga los firmantes marcados como habituales de esta empresa"
            >
              <Users className="h-4 w-4" strokeWidth={1.5} />
              {plantilla.isPending && plantilla.variables === "default"
                ? "Cargando…"
                : "Firmantes habituales"}
            </button>
            <button
              type="button"
              disabled={!editable || ocupado}
              onClick={() => plantilla.mutate("anterior")}
              className={btnGhost}
              title="Copia los firmantes de la última OC de esta empresa"
            >
              <RotateCcw className="h-4 w-4" strokeWidth={1.5} />
              {plantilla.isPending && plantilla.variables === "anterior"
                ? "Cargando…"
                : "Los mismos de la OC anterior"}
            </button>
            <AgregarExternoDialog
              onAgregar={agregarExterno}
              trigger={
                <button
                  type="button"
                  disabled={!editable || ocupado}
                  className={btnGhost}
                  title="El representante del proveedor o del cliente"
                >
                  <UserPlus className="h-4 w-4" strokeWidth={1.5} />
                  Agregar externo
                </button>
              }
            />
          </div>
        </div>

        {equipo.length === 0 ? (
          <p className="text-xs text-ink-500">
            {empresaCodigo} todavía no tiene un equipo de firmantes cargado. Podés
            sumar personas una por una con “Agregar externo”, o cargar el equipo
            de la empresa para tenerlos siempre a un click.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {equipo.map((m) => (
                <ChipMiembro
                  key={m.miembro_id}
                  miembro={m}
                  firma={clavesPuestas.get(claveMiembro(m))}
                  editable={editable}
                  ocupado={ocupado}
                  onToggle={() => toggleMiembro(m)}
                />
              ))}
            </div>
            <p className="mt-3 text-[11px] text-ink-500">
              Un click lo suma, otro lo saca. El candado marca a quien ya firmó.
            </p>
          </>
        )}
      </div>

      {/* ── Set actual de firmantes ─────────────────────────────── */}
      {firmas.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-hairline bg-ink-50/30 p-8 text-center">
          <PenLine className="mx-auto h-10 w-10 text-ink-300" strokeWidth={1.5} />
          <p className="mt-3 text-sm font-medium text-ink-700">
            Esta OC todavía no tiene firmantes
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-ink-500">
            Apretá “Firmantes habituales” para cargar los de siempre, o clickeá
            arriba a los integrantes que tienen que firmar. Nadie se entera
            hasta que uses “Enviar a firma”.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
          <div className="flex items-center justify-between border-b border-hairline bg-ink-50/60 px-4 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              Firman esta OC ({firmas.length})
            </span>
            <span className="text-[11px] text-ink-500 tabular-nums">
              {firmadas} firmada{firmadas === 1 ? "" : "s"} · {data.pendientes}{" "}
              pendiente{data.pendientes === 1 ? "" : "s"}
              {rechazadas > 0 && ` · ${rechazadas} rechazada${rechazadas === 1 ? "" : "s"}`}
            </span>
          </div>
          <ol className="divide-y divide-hairline">
            {firmas.map((f, i) => (
              <FilaFirma
                key={f.firma_id}
                firma={f}
                posicion={i + 1}
                editable={editable}
                ocupado={ocupado}
                onQuitar={() => quitarFirma(f)}
              />
            ))}
          </ol>
        </div>
      )}

      {manuscritas > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-ink-500">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
            strokeWidth={2}
          />
          {plural(manuscritas, "firmante", "firmantes")} sin correo:{" "}
          {manuscritas === 1 ? "firma" : "firman"} a mano sobre el PDF impreso y
          nunca {manuscritas === 1 ? "recibe" : "reciben"} un email.
        </p>
      )}

      {/* ── Diálogo de firma (vista previa manuscrita) ──────────── */}
      {miFirma && (
        <FirmarDialog
          open={firmarOpen}
          onOpenChange={setFirmarOpen}
          numeroOc={data.numero_oc}
          nombreSugerido={miFirma.firmante_nombre ?? miFirma.firmante_email}
          cargo={miFirma.firmante_cargo}
          empresa={miFirma.empresa_firmante}
          pendiente={firmarMut.isPending}
          onConfirm={(firmaVisual) => firmarMut.mutateAsync(firmaVisual)}
        />
      )}

      {/* ── Diálogo de rechazo ──────────────────────────────────── */}
      <Dialog
        open={motivoOpen}
        onOpenChange={(next) => {
          if (rechazarMut.isPending) return;
          if (!next) setMotivo("");
          setMotivoOpen(next);
        }}
      >
        <DialogContent>
          <div className="flex gap-4">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-negative/10 text-negative"
              aria-hidden="true"
            >
              <XCircle className="h-5 w-5" strokeWidth={1.5} />
            </span>
            <div className="flex-1">
              <DialogTitle>Rechazar la firma</DialogTitle>
              <DialogDescription className="mt-1.5">
                La OC vuelve a estado <span className="font-medium">emitida</span>{" "}
                para que la corrijan, y quien la creó recibe tu motivo.
              </DialogDescription>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (motivo.trim().length >= 3 && !rechazarMut.isPending) {
                rechazarMut.mutate(motivo.trim());
              }
            }}
            className="mt-5 space-y-4"
          >
            <div>
              <label
                htmlFor="rechazo-motivo"
                className="block text-xs font-medium text-ink-700"
              >
                Motivo del rechazo *
              </label>
              <textarea
                id="rechazo-motivo"
                autoFocus
                required
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
                placeholder="Ej: el monto no coincide con la cotización aprobada"
                className="mt-1 block w-full resize-none rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
              <p className="mt-1 text-xs text-ink-500">
                Mínimo 3 caracteres. Queda guardado en el historial de la OC.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <DialogClose asChild>
                <button
                  type="button"
                  disabled={rechazarMut.isPending}
                  className={btnGhost}
                >
                  Cancelar
                </button>
              </DialogClose>
              <button
                type="submit"
                disabled={motivo.trim().length < 3 || rechazarMut.isPending}
                className={`${btnBase} bg-negative text-white hover:bg-negative/90`}
              >
                <XCircle className="h-4 w-4" strokeWidth={1.5} />
                {rechazarMut.isPending ? "Registrando…" : "Rechazar firma"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------

function EstadoGuardado({
  pendiente,
  error,
  ok,
}: {
  pendiente: boolean;
  error: boolean;
  ok: boolean;
}) {
  if (pendiente) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        Guardando…
      </span>
    );
  }
  if (error) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-negative">
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
        No se guardó — se deshizo el cambio
      </span>
    );
  }
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
        <Check className="h-3.5 w-3.5 text-positive" strokeWidth={2.5} />
        Guardado
      </span>
    );
  }
  return null;
}

/**
 * Chip del equipo. El estado puesto/no-puesto se lee de tres formas a la vez
 * (ícono, color y `aria-pressed`) porque el usuario tiene que entender de un
 * vistazo quién quedó adentro sin depender solo del color.
 */
function ChipMiembro({
  miembro,
  firma,
  editable,
  ocupado,
  onToggle,
}: {
  miembro: Miembro;
  firma: Firma | undefined;
  editable: boolean;
  ocupado: boolean;
  onToggle: () => void;
}) {
  const puesto = Boolean(firma);
  const bloqueado = firma?.status === "FIRMADA";
  const rechazo = firma?.status === "RECHAZADA";
  const sinCorreo = !miembro.email;
  const sinCuenta = !sinCorreo && !miembro.tiene_cuenta;
  const inerte = bloqueado || !editable;

  const aviso = bloqueado
    ? `${miembro.nombre} ya firmó esta OC — su firma no se puede sacar.`
    : !editable
      ? "La OC ya no admite cambios de firmantes."
      : rechazo
        ? `${miembro.nombre} rechazó la firma. Sigue en el set: sacala y volvé a ponerla para que pueda firmar de nuevo.`
        : sinCorreo
          ? `${miembro.nombre} no tiene correo cargado: no se puede sumar como firmante del equipo. Agregala como externo si firma a mano.`
          : sinCuenta
            ? `${miembro.nombre} no tiene cuenta en la plataforma: se puede poner igual, pero va a firmar a mano en el PDF.`
            : null;

  const cls = bloqueado
    ? "bg-cehta-green/10 text-cehta-green ring-cehta-green/30 cursor-not-allowed"
    : rechazo
      ? "bg-negative/10 text-negative ring-negative/30 hover:bg-negative/15"
      : puesto
        ? "bg-cehta-green text-white ring-cehta-green shadow-card"
        : sinCorreo
          ? "bg-white text-ink-500 ring-hairline"
          : "bg-white text-ink-700 ring-hairline hover:bg-ink-100/50 hover:ring-ink-300";

  const chip = (
    <button
      type="button"
      aria-pressed={puesto}
      aria-disabled={inerte || sinCorreo || ocupado}
      onClick={() => {
        if (inerte || ocupado) return;
        onToggle();
      }}
      className={`inline-flex max-w-full items-center gap-2 rounded-full py-1.5 pl-2 pr-3.5 ring-1 transition-all duration-200 ease-apple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 ${cls} ${
        ocupado ? "opacity-70" : ""
      }`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          puesto && !bloqueado
            ? "bg-white/20 text-white"
            : bloqueado
              ? "bg-cehta-green/15 text-cehta-green"
              : "bg-ink-100 text-ink-500"
        }`}
        aria-hidden="true"
      >
        {bloqueado ? (
          <Lock className="h-3.5 w-3.5" strokeWidth={2} />
        ) : puesto ? (
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        ) : (
          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
        )}
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate text-sm font-medium leading-tight">
          {miembro.nombre}
        </span>
        <span
          className={`block truncate text-[11px] leading-tight ${
            puesto && !bloqueado ? "text-white/80" : "text-ink-500"
          }`}
        >
          {miembro.cargo ?? "Sin cargo"}
        </span>
      </span>
      {(sinCuenta || sinCorreo) && (
        <AlertTriangle
          className={`h-3.5 w-3.5 shrink-0 ${
            puesto && !bloqueado ? "text-white" : "text-warning"
          }`}
          strokeWidth={2}
        />
      )}
      <span className="sr-only">
        {puesto ? "Está puesto como firmante" : "No está puesto como firmante"}
      </span>
    </button>
  );

  return aviso ? <SimpleTooltip content={aviso}>{chip}</SimpleTooltip> : chip;
}

function FilaFirma({
  firma,
  posicion,
  editable,
  ocupado,
  onQuitar,
}: {
  firma: Firma;
  posicion: number;
  editable: boolean;
  ocupado: boolean;
  onQuitar: () => void;
}) {
  const f = firma;
  const bloqueada = f.status === "FIRMADA";
  const detalle = [
    f.firmante_cargo,
    f.empresa_firmante,
    f.sin_email ? "firma a mano en el PDF" : f.firmante_email,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-50 text-xs font-semibold tabular-nums text-ink-500">
        {posicion}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink-900">
          {f.firmante_nombre ?? f.firmante_email}
          {f.es_externo && (
            <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-600">
              Externo
            </span>
          )}
          {f.es_mi_firma && (
            <span className="rounded-full bg-cehta-green/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cehta-green">
              Vos
            </span>
          )}
        </p>
        <p className="truncate text-xs text-ink-500">{detalle || "—"}</p>
        {/* La firma tal cual quedó estampada en el PDF: verla acá evita
            tener que descargar el documento para confirmar cómo salió. */}
        {bloqueada && f.firma_visual && (
          <p className="font-firma mt-0.5 truncate text-xl leading-tight text-ink-900">
            {f.firma_visual}
          </p>
        )}
        {f.status === "RECHAZADA" && f.comments && (
          <p className="mt-1 text-xs text-negative">Motivo: {f.comments}</p>
        )}
      </div>
      <EstadoFirma firma={f} />
      {bloqueada ? (
        <SimpleTooltip
          content={`${f.firmante_nombre ?? f.firmante_email} ya firmó: una firma electrónica registrada no se borra.`}
        >
          <span
            tabIndex={0}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
          >
            <Lock className="h-4 w-4" strokeWidth={1.5} />
            <span className="sr-only">
              Firma bloqueada: esta persona ya firmó
            </span>
          </span>
        </SimpleTooltip>
      ) : (
        editable && (
          <button
            type="button"
            onClick={onQuitar}
            disabled={ocupado}
            aria-label={`Quitar a ${f.firmante_nombre ?? f.firmante_email} de los firmantes`}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-negative/10 hover:text-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          </button>
        )
      )}
    </li>
  );
}

function EstadoFirma({ firma }: { firma: Firma }) {
  const base =
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1";
  if (firma.status === "FIRMADA") {
    return (
      <span className={`${base} bg-emerald-50 text-emerald-700 ring-emerald-200`}>
        <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
        Firmó{firma.signed_at ? ` ${fmtFecha(firma.signed_at)}` : ""}
      </span>
    );
  }
  if (firma.status === "RECHAZADA") {
    return (
      <span className={`${base} bg-red-50 text-red-700 ring-red-200`}>
        <XCircle className="h-3 w-3" strokeWidth={2.5} />
        Rechazó{firma.signed_at ? ` ${fmtFecha(firma.signed_at)}` : ""}
      </span>
    );
  }
  return (
    <span className={`${base} bg-amber-50 text-amber-800 ring-amber-200`}>
      {firma.sin_email
        ? "Firma a mano"
        : firma.notified_at
          ? "Invitado, sin firmar"
          : "Sin invitar"}
    </span>
  );
}
