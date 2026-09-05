"use client";

/**
 * EgresoSheet — la ficha completa de un gasto, en un panel que se desliza
 * desde la derecha.
 *
 * "Al hacer click sale toda la información del monto": tres pestañas.
 *
 *  - **Gasto**: el reparto por fuente arriba (`RepartoEditor`) y debajo todos
 *    los campos del documento y del pago. Cada campo guarda al salir (blur)
 *    si cambió; no hay botón "Guardar" para el documento porque cada celda
 *    ya es su propio formulario.
 *  - **CORFO**: los 11 campos oficiales con los catálogos de
 *    `core.corfo_catalogos`, los defaults en gris (Monto rendir = Subsidio,
 *    Monto cancelado = Total si está pagado) y una vista previa de la fila
 *    tal como saldrá en `Carga_Gastos` (21 columnas, mismo orden que el
 *    export).
 *  - **Historial**: las versiones del gasto, sólo lectura. Cada edición deja
 *    un snapshot con quién y cuándo; acá se muestra el diff campo a campo.
 *
 * Pie: Duplicar (copia con fecha de hoy) y Eliminar (borrado lógico, pide
 * motivo: la fila desaparece de la grilla pero sigue en la BD y el historial).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, History, Loader2, Trash2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { ErrorState } from "@/components/shared/ErrorState";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { toCLP, toDateTime, toRelative } from "@/lib/format";
import { formatRut, isValidRut, stripRut } from "@/lib/rut";
import { limpiarCeros, normalizarNumero } from "@/lib/oc/pegar-items";
import {
  centavosADecimal,
  centavosAPesos,
  decimalACentavos,
  MontosInvalidosError,
  patchMontos,
  repartoDesdeApi,
  repartoParaApi,
  type RepartoCentavos,
} from "@/lib/claudia/reparto";
import {
  aOpcion,
  ESTADOS_PAGO,
  LARGO_MAX,
  TIPOS_DOCUMENTO,
  type CatalogoItem,
  type CatalogosResponse,
  type EgresoCorfo,
  type EgresoDetalle,
  type EgresoRead,
  type EgresoUpdate,
  type EstadoPago,
  type HistorialItem,
  type TipoDocumento,
} from "@/lib/claudia/types";
import { RepartoEditor } from "./RepartoEditor";
import { BadgeReparto, fechaCorta } from "./EgresosGrid";
import { periodoCorfo } from "./PeriodoChips";

type Tab = "gasto" | "corfo" | "historial";
const TABS: ReadonlyArray<[Tab, string]> = [
  ["gasto", "Gasto"],
  ["corfo", "CORFO"],
  ["historial", "Historial"],
];

/** Mapeo tipo_documento → vocabulario CORFO de `Carga_Gastos` (§3.3). */
const TIPO_DOC_CORFO: Record<TipoDocumento, string> = {
  FACTURA: "FACTURA",
  FACTURA_EXENTA: "FACTURA",
  BOLETA: "BOLETA",
  BOLETA_HONORARIO: "BOLETA HONORARIOS",
  LIQUIDACION: "LIQ. SUELDO",
  INVOICE: "INVOICE",
  CO_EJECUTOR: "OTRO",
  OTRO: "OTRO",
};

const CAMPO_LABEL: Record<string, string> = {
  fecha: "Fecha",
  periodo: "Período",
  descripcion: "Descripción",
  rut_emisor: "RUT",
  tipo_documento: "Tipo de documento",
  folio: "Folio",
  monto_neto: "Neto",
  impuesto: "Impuesto",
  total: "Total",
  tipo_egreso: "Tipo de egreso",
  fuente: "Fuente",
  proyecto: "Proyecto",
  estado_pago: "Estado",
  fecha_pago: "Fecha de pago",
  monto_subsidio: "Reparto: Subsidio",
  monto_cehta_ptec: "Reparto: Cehta-Ptec",
  monto_cehta: "Reparto: Cehta",
  monto_trewaox: "Reparto: Trewaox",
  corfo_cuenta: "CORFO · Cuenta",
  corfo_item: "CORFO · Ítem",
  corfo_fuente_financiamiento: "CORFO · Fuente financiamiento",
  corfo_etapa: "CORFO · Etapa",
  corfo_fecha_recepcion: "CORFO · Fecha recepción",
  corfo_monto_rendir: "CORFO · Monto rendir",
  corfo_monto_cancelado: "CORFO · Monto cancelado",
  corfo_forma_pago: "CORFO · Forma de pago",
  corfo_glosa: "CORFO · Glosa",
  corfo_receptor_rut: "CORFO · Receptor RUT",
  corfo_receptor_nombre: "CORFO · Receptor nombre",
  observaciones: "Observaciones",
  adjunto_dropbox_path: "Adjunto Dropbox",
  deleted_at: "Borrado",
  delete_motivo: "Motivo de borrado",
};

const CAMPOS_PLATA = /^(monto_|total$|impuesto$|corfo_monto_)/;

function valorHistorial(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (CAMPOS_PLATA.test(campo)) {
    const c = decimalACentavos(String(v));
    return c === null ? String(v) : toCLP(centavosAPesos(c));
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

interface Props {
  egresoId: number | null;
  onClose: () => void;
  catalogos?: CatalogosResponse | null;
  mostrarTrewaox: boolean;
  onActualizar: (id: number, patch: EgresoUpdate) => Promise<EgresoRead>;
  onEliminar: (id: number, motivo: string) => Promise<void>;
  onDuplicar: (egreso: EgresoRead) => Promise<void>;
}

export function EgresoSheet({
  egresoId,
  onClose,
  catalogos,
  mostrarTrewaox,
  onActualizar,
  onEliminar,
  onDuplicar,
}: Props) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("gasto");
  const [guardandoReparto, setGuardandoReparto] = useState(false);
  const [duplicando, setDuplicando] = useState(false);
  const contenidoRef = useRef<HTMLDivElement>(null);
  const tabGastoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (egresoId !== null) setTab("gasto");
  }, [egresoId]);

  const detalle = useQuery({
    queryKey: ["claudia-egreso", egresoId],
    queryFn: () => apiClient.get<EgresoDetalle>(`/claudia/egresos/${egresoId}`, session),
    enabled: !!session && egresoId !== null,
  });
  const e = detalle.data;
  const egresoCargadoId = e?.egreso_id ?? null;

  // Foco al abrir: Radix enfocaría el primer input (y con `preventDefault`
  // pelado no enfocaba NADA: el lector de pantalla se quedaba en la grilla).
  // Va al botón de la pestaña Gasto, y mientras carga, al panel mismo
  // (tabIndex=-1); cuando llega el gasto, si el foco sigue en el panel se
  // mueve a la pestaña.
  useEffect(() => {
    if (egresoCargadoId === null) return;
    const activo = document.activeElement;
    if (activo === null || activo === document.body || activo === contenidoRef.current) {
      tabGastoRef.current?.focus();
    }
  }, [egresoCargadoId]);

  async function guardar(patch: EgresoUpdate) {
    if (!e) return;
    await onActualizar(e.egreso_id, patch);
    await queryClient.invalidateQueries({ queryKey: ["claudia-egreso", e.egreso_id] });
  }

  async function guardarCampo(patch: EgresoUpdate) {
    try {
      await guardar(patch);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "No se pudo guardar el cambio");
      throw err;
    }
  }

  /**
   * Neto / Impuesto / Total. `patchMontos` lanza `MontosInvalidosError` si
   * el neto o el impuesto no caben en el total: se avisa y se rechaza (el
   * campo vuelve al valor anterior porque `CampoMonto` recibe el error).
   */
  async function guardarMonto(campo: "monto_neto" | "impuesto" | "total", c: number | null) {
    if (!e) return;
    let patch: EgresoUpdate;
    try {
      patch = patchMontos(e, campo, c);
    } catch (err) {
      if (err instanceof MontosInvalidosError) toast.error(err.message);
      throw err;
    }
    await guardarCampo(patch);
  }

  /** Flechas / Home / End entre pestañas: mueven el foco junto con la selección (roving tabindex). */
  function onKeyDownTab(ev: React.KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.findIndex(([id]) => id === tab);
    let next = -1;
    if (ev.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (ev.key === "ArrowLeft") next = (i + TABS.length - 1) % TABS.length;
    else if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = TABS.length - 1;
    if (next < 0 || next === i) return;
    ev.preventDefault();
    const id = TABS[next]![0];
    setTab(id);
    document.getElementById(`tab-${id}`)?.focus();
  }

  async function guardarReparto(montos: RepartoCentavos) {
    setGuardandoReparto(true);
    try {
      await guardar({ reparto: repartoParaApi(montos) });
      toast.success("Reparto guardado");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "No se pudo guardar el reparto");
    } finally {
      setGuardandoReparto(false);
    }
  }

  const totalC = decimalACentavos(e?.total) ?? 0;
  const montos = useMemo(() => repartoDesdeApi(e?.reparto), [e?.reparto]);

  const tiposDoc: ReadonlyArray<CatalogoItem> = catalogos?.tipos_documento?.length
    ? catalogos.tipos_documento
    : TIPOS_DOCUMENTO;
  const estadosPago: ReadonlyArray<CatalogoItem> = catalogos?.estados_pago?.length
    ? catalogos.estados_pago
    : ESTADOS_PAGO;

  return (
    <Dialog open={egresoId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        ref={contenidoRef}
        className={cn(
          "inset-y-0 right-0 left-auto top-0 flex h-full w-full max-w-full translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none p-0 sm:w-[560px] sm:rounded-l-3xl",
          "duration-300 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
        )}
        onOpenAutoFocus={(ev) => {
          ev.preventDefault();
          (tabGastoRef.current ?? contenidoRef.current)?.focus();
        }}
      >
        {detalle.isLoading || !e ? (
          <div className="space-y-4 p-6">
            {detalle.isError ? (
              <ErrorState
                title="No se pudo abrir el gasto"
                error={detalle.error as Error}
                onRetry={() => void detalle.refetch()}
                variant="inline"
              />
            ) : (
              <>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-40 w-full rounded-2xl" />
                <Skeleton className="h-64 w-full rounded-2xl" />
              </>
            )}
            <DialogTitle className="sr-only">Ficha del gasto</DialogTitle>
            <DialogDescription className="sr-only">Cargando…</DialogDescription>
          </div>
        ) : (
          <>
            <header className="shrink-0 border-b border-hairline px-6 pb-4 pt-6 pr-14">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                {e.empresa_codigo} · {fechaCorta(e.fecha)} · #{e.egreso_id}
              </p>
              <DialogTitle className="mt-1 truncate font-display text-xl font-semibold tracking-tight text-ink-900">
                {e.descripcion}
              </DialogTitle>
              <DialogDescription className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-display text-2xl font-semibold tabular-nums text-ink-900">
                  {toCLP(centavosAPesos(totalC))}
                </span>
                <BadgeReparto estado={e.reparto_estado} />
                <span className="text-ink-500">v{e.version}</span>
              </DialogDescription>
              <div className="mt-4 inline-flex rounded-xl bg-surface-muted p-0.5" role="tablist" aria-label="Secciones de la ficha">
                {TABS.map(([id, label]) => (
                  <button
                    key={id}
                    ref={id === "gasto" ? tabGastoRef : undefined}
                    type="button"
                    role="tab"
                    id={`tab-${id}`}
                    aria-selected={tab === id}
                    aria-controls={`panel-${id}`}
                    tabIndex={tab === id ? 0 : -1}
                    onClick={() => setTab(id)}
                    onKeyDown={onKeyDownTab}
                    className={cn(
                      "rounded-[10px] px-3.5 py-1.5 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                      tab === id ? "bg-white text-ink-900 shadow-card" : "text-ink-500 hover:text-ink-900",
                    )}
                  >
                    {label}
                    {id === "historial" && e.historial?.length > 0 && (
                      <span className="ml-1.5 text-xs text-ink-500">{e.historial.length}</span>
                    )}
                  </button>
                ))}
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {tab === "gasto" && (
                <div id="panel-gasto" role="tabpanel" aria-labelledby="tab-gasto" className="space-y-5">
                  <RepartoEditor
                    total={totalC}
                    montos={montos}
                    mostrarTrewaox={mostrarTrewaox}
                    onGuardar={guardarReparto}
                    guardando={guardandoReparto}
                  />

                  {(!e.neto_mas_impuesto_cuadra || (e.estado_pago === "PAGADO" && !e.fecha_pago)) && (
                    <div className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-ink-700">
                      <p className="inline-flex items-center gap-1.5 font-medium text-ink-900">
                        <AlertTriangle className="size-3.5 text-warning" strokeWidth={2} />
                        Para revisar
                      </p>
                      <ul className="mt-1 list-inside list-disc">
                        {!e.neto_mas_impuesto_cuadra && <li>Neto + impuesto no suman el total.</li>}
                        {e.estado_pago === "PAGADO" && !e.fecha_pago && <li>Está pagado pero no tiene fecha de pago.</li>}
                      </ul>
                    </div>
                  )}

                  <Seccion titulo="Documento">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <CampoTexto label="Fecha" tipo="date" valor={e.fecha} onGuardar={(v) => guardarCampo({ fecha: v })} requerido />
                      <CampoSelect
                        label="Tipo de documento"
                        valor={e.tipo_documento}
                        opciones={tiposDoc}
                        onGuardar={(v) => guardarCampo({ tipo_documento: v as TipoDocumento })}
                      />
                      <div className="sm:col-span-2">
                        <CampoTexto label="Descripción" valor={e.descripcion} maxLength={LARGO_MAX.descripcion} onGuardar={(v) => guardarCampo({ descripcion: v })} requerido />
                      </div>
                      <CampoTexto
                        label="RUT emisor"
                        valor={e.rut_emisor ? formatRut(e.rut_emisor) : ""}
                        formatear={(v) => (v.trim() ? formatRut(v) : "")}
                        validar={(v) => (!v.trim() || isValidRut(v) ? null : "RUT inválido: el dígito verificador no coincide")}
                        onGuardar={(v) => {
                          const s = stripRut(v.trim());
                          guardarCampo({ rut_emisor: s ? `${s.slice(0, -1)}-${s.slice(-1)}` : null });
                        }}
                      />
                      <CampoTexto label="Folio" valor={e.folio ?? ""} maxLength={LARGO_MAX.folio} onGuardar={(v) => guardarCampo({ folio: v.trim() || null })} />
                      <CampoMonto
                        label="Neto"
                        valor={e.monto_neto}
                        ayuda="El total no cambia: el impuesto pasa a ser total − neto."
                        onGuardar={(c) => guardarMonto("monto_neto", c)}
                      />
                      <CampoMonto
                        label="Impuesto"
                        valor={e.impuesto}
                        ayuda="El total no cambia: el neto pasa a ser total − impuesto."
                        onGuardar={(c) => guardarMonto("impuesto", c)}
                      />
                      <CampoMonto
                        label="Total"
                        valor={e.total}
                        requerido
                        ayuda="Al cambiar el total, el neto se recalcula (impuesto fijo) y el reparto se escala en la misma proporción."
                        onGuardar={(c) => guardarMonto("total", c)}
                      />
                    </div>
                  </Seccion>

                  <Seccion titulo="Clasificación">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <CampoTexto label="Tipo de egreso" valor={e.tipo_egreso ?? ""} maxLength={LARGO_MAX.tipo_egreso} lista={catalogos?.sugerencias?.tipo_egreso} onGuardar={(v) => guardarCampo({ tipo_egreso: v.trim() || null })} />
                      <CampoTexto label="Fuente" valor={e.fuente ?? ""} maxLength={LARGO_MAX.fuente} lista={catalogos?.sugerencias?.fuente} onGuardar={(v) => guardarCampo({ fuente: v.trim() || null })} />
                      <CampoTexto label="Proyecto" valor={e.proyecto ?? ""} maxLength={LARGO_MAX.proyecto} lista={catalogos?.sugerencias?.proyecto} onGuardar={(v) => guardarCampo({ proyecto: v.trim() || null })} />
                    </div>
                  </Seccion>

                  <Seccion titulo="Pago">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <CampoSelect
                        label="Estado"
                        valor={e.estado_pago}
                        opciones={estadosPago}
                        onGuardar={(v) => guardarCampo({ estado_pago: v as EstadoPago })}
                      />
                      <CampoTexto label="Fecha de pago" tipo="date" valor={e.fecha_pago ?? ""} onGuardar={(v) => guardarCampo({ fecha_pago: v || null })} />
                    </div>
                  </Seccion>

                  <Seccion titulo="Notas">
                    <div className="space-y-3">
                      <CampoTexto label="Observaciones" valor={e.observaciones ?? ""} maxLength={LARGO_MAX.observaciones} multilinea onGuardar={(v) => guardarCampo({ observaciones: v.trim() || null })} />
                      <CampoTexto label="Adjunto en Dropbox (ruta)" valor={e.adjunto_dropbox_path ?? ""} placeholder="/REVTECH/CORFO/2026-08/factura-10540.pdf" onGuardar={(v) => guardarCampo({ adjunto_dropbox_path: v.trim() || null })} />
                    </div>
                  </Seccion>

                  <p className="text-[11px] text-ink-500">
                    Origen {e.origen === "IMPORT_EXCEL" ? "importado del Excel" : e.origen === "PASTE" ? "pegado desde Excel" : "cargado en la plataforma"}
                    {e.created_by ? ` por ${e.created_by}` : ""} · última edición {toRelative(e.updated_at)}
                    {e.updated_by ? ` por ${e.updated_by}` : ""}
                  </p>
                </div>
              )}

              {tab === "corfo" && (
                <div id="panel-corfo" role="tabpanel" aria-labelledby="tab-corfo" className="space-y-5">
                  <CorfoTab e={e} catalogos={catalogos} onGuardar={(corfo) => guardarCampo({ corfo })} />
                </div>
              )}

              {tab === "historial" && (
                <div id="panel-historial" role="tabpanel" aria-labelledby="tab-historial">
                  <Historial items={e.historial ?? []} />
                </div>
              )}
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline bg-surface-muted/60 px-6 py-3">
              <ConfirmDeleteDialog
                trigger={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-negative transition-colors hover:bg-negative/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative"
                  >
                    <Trash2 className="size-4" strokeWidth={1.75} />
                    Eliminar
                  </button>
                }
                title="¿Eliminar este gasto?"
                description={
                  <>
                    <span className="font-medium text-ink-900">{e.descripcion}</span> por{" "}
                    {toCLP(centavosAPesos(totalC))} desaparece de la grilla. No se borra de verdad: queda en
                    el historial con tu motivo, por si CORFO o el contador lo preguntan.
                  </>
                }
                confirmText="Eliminar gasto"
                motivo={{
                  label: "Motivo",
                  placeholder: "Ej.: estaba duplicado con el folio 10541",
                  minLength: 5,
                  hint: "Queda guardado para siempre junto al gasto.",
                }}
                onConfirm={async (motivo) => {
                  try {
                    await onEliminar(e.egreso_id, motivo);
                    onClose();
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.detail : "No se pudo eliminar");
                    throw err;
                  }
                }}
              />
              <button
                type="button"
                disabled={duplicando}
                onClick={async () => {
                  setDuplicando(true);
                  try {
                    await onDuplicar(e);
                  } catch (err) {
                    toast.error(err instanceof ApiError ? err.detail : "No se pudo duplicar");
                  } finally {
                    setDuplicando(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green disabled:opacity-60"
                title="Crea una copia con fecha de hoy"
              >
                {duplicando ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : <Copy className="size-4" strokeWidth={1.75} />}
                Duplicar
              </button>
            </footer>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Secciones y campos ───────────────────────────────────────────────────

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-500">{titulo}</p>
      {children}
    </section>
  );
}

// placeholder en ink-500: ink-300 (#a1a1a6) sobre blanco no llega a AA.
const CAMPO_CLASE =
  "w-full rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline transition-shadow duration-150 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:opacity-60";

function Etiqueta({ children, htmlFor, extra }: { children: React.ReactNode; htmlFor: string; extra?: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 flex items-center justify-between text-[11px] font-medium text-ink-500">
      <span>{children}</span>
      {extra}
    </label>
  );
}

let idSeq = 0;
function useCampoId(label: string) {
  const [id] = useState(() => `campo-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${++idSeq}`);
  return id;
}

interface CampoTextoProps {
  label: string;
  valor: string;
  tipo?: "text" | "date";
  placeholder?: string;
  lista?: string[];
  multilinea?: boolean;
  requerido?: boolean;
  /** Largo máximo de la API (`LARGO_MAX`): el input no deja pasarse. */
  maxLength?: number;
  formatear?: (v: string) => string;
  validar?: (v: string) => string | null;
  onGuardar: (v: string) => Promise<void> | void;
}

function CampoTexto({ label, valor, tipo = "text", placeholder, lista, multilinea, requerido, maxLength, formatear, validar, onGuardar }: CampoTextoProps) {
  const id = useCampoId(label);
  const [v, setV] = useState(valor);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setV(valor), [valor]);

  async function blur() {
    const limpio = formatear ? formatear(v) : v;
    if (limpio !== v) setV(limpio);
    if (limpio === valor) return;
    if (requerido && !limpio.trim()) {
      toast.error(`${label} no puede quedar vacío`);
      setV(valor);
      return;
    }
    const error = validar?.(limpio);
    if (error) {
      toast.error(error);
      setV(valor);
      return;
    }
    setGuardando(true);
    try {
      await onGuardar(limpio);
    } catch {
      setV(valor);
    } finally {
      setGuardando(false);
    }
  }

  const props = {
    id,
    value: v,
    placeholder,
    maxLength,
    disabled: guardando,
    onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(ev.target.value),
    onBlur: () => void blur(),
    onKeyDown: (ev: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (ev.key === "Escape") setV(valor);
      if (ev.key === "Enter" && !multilinea) (ev.target as HTMLInputElement).blur();
    },
    "aria-required": requerido,
    className: CAMPO_CLASE,
  };
  return (
    <div>
      <Etiqueta htmlFor={id} extra={guardando ? <Loader2 className="size-3 animate-spin text-cehta-green" /> : null}>
        {label}
      </Etiqueta>
      {multilinea ? (
        <textarea {...props} rows={3} />
      ) : (
        <>
          <input {...props} type={tipo} list={lista?.length ? `${id}-lista` : undefined} />
          {lista?.length ? (
            <datalist id={`${id}-lista`}>
              {lista.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          ) : null}
        </>
      )}
    </div>
  );
}

function CampoSelect({
  label,
  valor,
  opciones,
  vacio,
  onGuardar,
}: {
  label: string;
  valor: string;
  opciones: ReadonlyArray<CatalogoItem>;
  /** Etiqueta de la opción vacía; si no viene, el campo es obligatorio. */
  vacio?: string;
  onGuardar: (v: string) => Promise<void> | void;
}) {
  const id = useCampoId(label);
  const [guardando, setGuardando] = useState(false);
  return (
    <div>
      <Etiqueta htmlFor={id} extra={guardando ? <Loader2 className="size-3 animate-spin text-cehta-green" /> : null}>
        {label}
      </Etiqueta>
      <select
        id={id}
        value={valor}
        disabled={guardando}
        onChange={async (ev) => {
          const nv = ev.target.value;
          if (nv === valor) return;
          setGuardando(true);
          try {
            await onGuardar(nv);
          } catch {
            // el toast lo pone el padre; el select vuelve solo al re-render
          } finally {
            setGuardando(false);
          }
        }}
        className={CAMPO_CLASE}
      >
        {vacio !== undefined && <option value="">{vacio}</option>}
        {opciones.map((o) => (
          <option key={o.codigo} value={o.codigo}>
            {o.label}
          </option>
        ))}
        {valor && !opciones.some((o) => o.codigo === valor) && <option value={valor}>{valor}</option>}
      </select>
    </div>
  );
}

function CampoMonto({
  label,
  valor,
  requerido,
  placeholder,
  ayuda,
  onGuardar,
}: {
  label: string;
  /** Decimal string de la API, o null. */
  valor: string | null;
  requerido?: boolean;
  /** Default visible en gris (ej. "= Subsidio"). */
  placeholder?: string;
  ayuda?: string;
  onGuardar: (centavos: number | null) => Promise<void> | void;
}) {
  const id = useCampoId(label);
  const inicial = useMemo(() => {
    const c = decimalACentavos(valor);
    return c === null ? "" : limpiarCeros(centavosADecimal(c));
  }, [valor]);
  const [v, setV] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setV(inicial), [inicial]);

  async function blur() {
    const n = normalizarNumero(v);
    const c = n === "" ? null : decimalACentavos(n);
    if (v.trim() && c === null) {
      toast.error(`"${v}" no es un monto`);
      setV(inicial);
      return;
    }
    if (c !== null && c < 0) {
      toast.error("Los montos no pueden ser negativos");
      setV(inicial);
      return;
    }
    if (requerido && c === null) {
      toast.error(`${label} es obligatorio`);
      setV(inicial);
      return;
    }
    if (c === decimalACentavos(valor)) {
      setV(inicial);
      return;
    }
    setGuardando(true);
    try {
      await onGuardar(c);
    } catch {
      setV(inicial);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <Etiqueta htmlFor={id} extra={guardando ? <Loader2 className="size-3 animate-spin text-cehta-green" /> : null}>
        {label}
      </Etiqueta>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-500">$</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={v}
          placeholder={placeholder}
          disabled={guardando}
          title={ayuda}
          aria-required={requerido}
          onChange={(ev) => setV(ev.target.value)}
          onBlur={() => void blur()}
          onKeyDown={(ev) => {
            if (ev.key === "Escape") setV(inicial);
            if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
          }}
          className={cn(CAMPO_CLASE, "pl-6 text-right tabular-nums")}
        />
      </div>
    </div>
  );
}

// ── Pestaña CORFO ────────────────────────────────────────────────────────

function CorfoTab({
  e,
  catalogos,
  onGuardar,
}: {
  e: EgresoDetalle;
  catalogos?: CatalogosResponse | null;
  onGuardar: (corfo: Partial<EgresoCorfo>) => Promise<void>;
}) {
  const c = e.corfo;
  const cuentas = (catalogos?.corfo?.cuenta_gastos ?? []).map(aOpcion);
  const items = (catalogos?.corfo?.item_gastos ?? []).map(aOpcion);
  const etapas = (catalogos?.corfo?.etapa ?? []).map(aOpcion);
  const formasPago = (catalogos?.formas_pago ?? []).map(aOpcion);
  const fuentesSugeridas = (catalogos?.corfo?.fuente_financiamiento_sugeridas ?? []).map((x) => aOpcion(x).codigo);

  const subsidio = decimalACentavos(e.reparto?.subsidio);
  const totalC = decimalACentavos(e.total) ?? 0;
  const defaultRendir = subsidio === null ? null : subsidio;
  const defaultCancelado = e.estado_pago === "PAGADO" ? totalC : null;
  const rendir = decimalACentavos(c.monto_rendir) ?? defaultRendir;
  const cancelado = decimalACentavos(c.monto_cancelado) ?? defaultCancelado;

  const fmt = (v: number | null) => (v === null ? "—" : toCLP(centavosAPesos(v)));
  const vista: Array<[string, string, boolean?]> = [
    ["Cuenta", c.cuenta ?? "—"],
    ["Ítem", c.item ?? "—"],
    ["Fuente Financiamiento", c.fuente_financiamiento ?? "—"],
    ["Periodo", periodoCorfo(e.periodo)],
    ["Etapa", c.etapa ?? "—"],
    ["Tipo Documento", TIPO_DOC_CORFO[e.tipo_documento] ?? e.tipo_documento],
    ["N° Documento", e.folio ?? "—"],
    ["Rut Proveedor", e.rut_emisor ? formatRut(e.rut_emisor) : "—"],
    ["Nombre Proveedor o Razón Social", e.descripcion],
    ["Monto Neto", fmt(decimalACentavos(e.monto_neto))],
    ["Monto IVA", fmt(decimalACentavos(e.impuesto))],
    ["Monto Total", fmt(totalC)],
    ["Monto Rendir", fmt(rendir), c.monto_rendir === null && rendir !== null],
    ["Fecha de Recepción", c.fecha_recepcion ? fechaCorta(c.fecha_recepcion) : "—"],
    ["Monto Cancelado", fmt(cancelado), c.monto_cancelado === null && cancelado !== null],
    ["Forma de Pago", c.forma_pago ?? "—"],
    ["Fecha de Pago", e.fecha_pago ? fechaCorta(e.fecha_pago) : "—"],
    ["Fecha del documento", fechaCorta(e.fecha)],
    ["Glosa / Justificación", c.glosa ?? "—"],
    ["Receptor Rut", c.receptor_rut ? formatRut(c.receptor_rut) : "—"],
    ["Nombre Receptor", c.receptor_nombre ?? "—"],
  ];

  return (
    <>
      <Seccion titulo="Columnas oficiales CORFO">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cuentas.length ? (
            <CampoSelect label="Cuenta" valor={c.cuenta ?? ""} opciones={cuentas} vacio="Sin cuenta" onGuardar={(v) => onGuardar({ cuenta: v || null })} />
          ) : (
            <CampoTexto label="Cuenta" valor={c.cuenta ?? ""} onGuardar={(v) => onGuardar({ cuenta: v.trim() || null })} />
          )}
          {items.length ? (
            <CampoSelect label="Ítem" valor={c.item ?? ""} opciones={items} vacio="Sin ítem" onGuardar={(v) => onGuardar({ item: v || null })} />
          ) : (
            <CampoTexto label="Ítem" valor={c.item ?? ""} onGuardar={(v) => onGuardar({ item: v.trim() || null })} />
          )}
          <CampoTexto
            label="Fuente de financiamiento"
            valor={c.fuente_financiamiento ?? ""}
            lista={fuentesSugeridas}
            placeholder="SUBSIDIO / APORTE PECUNIARIO / …"
            onGuardar={(v) => onGuardar({ fuente_financiamiento: v.trim() || null })}
          />
          {etapas.length ? (
            <CampoSelect label="Etapa" valor={c.etapa ?? ""} opciones={etapas} vacio="Sin etapa" onGuardar={(v) => onGuardar({ etapa: v || null })} />
          ) : (
            <CampoTexto label="Etapa" valor={c.etapa ?? ""} onGuardar={(v) => onGuardar({ etapa: v.trim() || null })} />
          )}
          <CampoTexto label="Fecha de recepción" tipo="date" valor={c.fecha_recepcion ?? ""} onGuardar={(v) => onGuardar({ fecha_recepcion: v || null })} />
          {formasPago.length ? (
            <CampoSelect label="Forma de pago" valor={c.forma_pago ?? ""} opciones={formasPago} vacio="Sin forma de pago" onGuardar={(v) => onGuardar({ forma_pago: v || null })} />
          ) : (
            <CampoTexto label="Forma de pago" valor={c.forma_pago ?? ""} placeholder="TRANSFERENCIA" onGuardar={(v) => onGuardar({ forma_pago: v.trim() || null })} />
          )}
          <CampoMonto
            label="Monto a rendir"
            valor={c.monto_rendir}
            placeholder={defaultRendir === null ? "= Subsidio (sin clasificar)" : `= Subsidio ${toCLP(centavosAPesos(defaultRendir))}`}
            onGuardar={(v) => onGuardar({ monto_rendir: v === null ? null : centavosADecimal(v) })}
          />
          <CampoMonto
            label="Monto cancelado"
            valor={c.monto_cancelado}
            placeholder={defaultCancelado === null ? "= Total si está pagado" : `= Total ${toCLP(centavosAPesos(defaultCancelado))}`}
            onGuardar={(v) => onGuardar({ monto_cancelado: v === null ? null : centavosADecimal(v) })}
          />
          <div className="sm:col-span-2">
            <CampoTexto label="Glosa / justificación" valor={c.glosa ?? ""} multilinea onGuardar={(v) => onGuardar({ glosa: v.trim() || null })} />
          </div>
          <CampoTexto
            label="Receptor RUT"
            valor={c.receptor_rut ? formatRut(c.receptor_rut) : ""}
            formatear={(v) => (v.trim() ? formatRut(v) : "")}
            validar={(v) => (!v.trim() || isValidRut(v) ? null : "RUT inválido")}
            onGuardar={(v) => {
              const s = stripRut(v.trim());
              return onGuardar({ receptor_rut: s ? `${s.slice(0, -1)}-${s.slice(-1)}` : null });
            }}
          />
          <CampoTexto label="Receptor nombre" valor={c.receptor_nombre ?? ""} onGuardar={(v) => onGuardar({ receptor_nombre: v.trim() || null })} />
        </div>
      </Seccion>

      <Seccion titulo="Así sale en Carga_Gastos">
        <dl className="divide-y divide-hairline rounded-2xl bg-surface-muted/70 px-4 text-xs ring-1 ring-hairline">
          {vista.map(([k, v, esDefault], i) => (
            <div key={k} className="flex items-baseline justify-between gap-4 py-1.5">
              <dt className="shrink-0 text-ink-500">
                <span className="mr-1.5 tabular-nums text-ink-500">{i + 1}</span>
                {k}
              </dt>
              <dd className={cn("truncate text-right tabular-nums", esDefault ? "text-ink-500" : "text-ink-900")} title={esDefault ? "Default: no se cargó otro valor" : undefined}>
                {v}
                {esDefault && <span className="ml-1 text-[11px] uppercase tracking-wide">default</span>}
              </dd>
            </div>
          ))}
        </dl>
      </Seccion>
    </>
  );
}

// ── Historial ────────────────────────────────────────────────────────────

function Historial({ items }: { items: HistorialItem[] }) {
  if (!items.length) {
    return (
      <p className="py-10 text-center text-sm text-ink-500">
        Todavía no hay versiones registradas.
      </p>
    );
  }
  const orden = [...items].sort((a, b) => b.version - a.version);
  return (
    <ol className="space-y-3">
      {orden.map((h) => (
        <li key={h.version} className="rounded-2xl bg-white p-4 ring-1 ring-hairline">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 font-medium text-ink-900">
              <History className="size-3" strokeWidth={2} />v{h.version}
            </span>
            <span title={toDateTime(h.changed_at)}>{toRelative(h.changed_at)}</span>
            <span>·</span>
            <span className="truncate">{h.changed_by ?? "sistema"}</span>
            <span>·</span>
            <span>
              {h.accion === "INSERT" ? "creó el gasto" : h.accion === "DELETE" ? "lo eliminó" : "lo editó"}
            </span>
          </div>
          {h.cambios?.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {h.cambios.map((c, i) => (
                <li key={`${c.campo}-${i}`} className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-medium text-ink-700">{CAMPO_LABEL[c.campo] ?? c.campo}:</span>
                  <span className="text-ink-500 line-through decoration-ink-300">{valorHistorial(c.campo, c.antes)}</span>
                  <span className="text-ink-500" aria-hidden>→</span>
                  <span className="text-ink-900">{valorHistorial(c.campo, c.despues)}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
