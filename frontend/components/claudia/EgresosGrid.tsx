"use client";

/**
 * EgresosGrid — la grilla "como Excel" del registro de egresos.
 *
 * Nicolás, literal: "ingresar los datos como si fuera un excel". Eso acá es:
 *
 *  - **Edición inline con teclado**: doble click o Enter edita la celda,
 *    Tab / Shift+Tab avanza, ↑ ↓ cambian de fila, Esc cancela, y el blur
 *    guarda con `PUT` sólo si algo cambió. La fila parpadea suave al guardar.
 *  - **Fila nueva siempre al final**: se completa como cualquier otra y, al
 *    salir de la fila con Fecha, Descripción y Total cargados, hace `POST`.
 *  - **Pegar desde Excel** (Ctrl+V sobre la grilla): se interpreta con
 *    `parsearEgresosPegados`, se muestra "Vas a agregar N gastos por $X" y
 *    recién ahí va al `POST /batch`. Las filas que la API rechazaría se
 *    listan aparte para que no tumben a las demás (el batch es todo o nada).
 *  - **Reparto**: mini barra por fuente + badge OK / ámbar (sin clasificar)
 *    / rojo suave (descuadrado). Click en el Total, en el reparto o en la
 *    flecha de la fila abre la ficha completa.
 *
 * La plata se compara y convierte en centavos enteros (`lib/claudia/reparto`);
 * la grilla nunca hace `Number(x) * 100`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronRight, ClipboardPaste, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkeletonTable } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { toCLP } from "@/lib/format";
import { formatRut, isValidRut, stripRut } from "@/lib/rut";
import { limpiarCeros, normalizarNumero } from "@/lib/oc/pegar-items";
import {
  centavosADecimal,
  centavosAPesos,
  decimalACentavos,
  MontosInvalidosError,
  patchMontos,
  repartoDesdeApi,
} from "@/lib/claudia/reparto";
import {
  egresoPegadoAFila,
  parsearEgresosPegados,
  totalPegado,
  type ResultadoPegado,
} from "@/lib/claudia/pegar-egresos";
import {
  BATCH_MAX_FILAS,
  ESTADOS_PAGO,
  LARGO_MAX,
  TIPOS_DOCUMENTO,
  type CatalogosResponse,
  type EgresoCreateFila,
  type EgresoRead,
  type EgresoUpdate,
  type EstadoPago,
  type TipoDocumento,
} from "@/lib/claudia/types";
import { RepartoBarra } from "./RepartoEditor";

// ── Columnas ─────────────────────────────────────────────────────────────

type ColKey =
  | "fecha"
  | "descripcion"
  | "rut_emisor"
  | "tipo_documento"
  | "folio"
  | "monto_neto"
  | "impuesto"
  | "total"
  | "reparto"
  | "estado_pago"
  | "fecha_pago";

interface Col {
  key: ColKey;
  label: string;
  tipo: "date" | "text" | "rut" | "select" | "money" | "reparto";
  right?: boolean;
  w: string;
}

const COLS: readonly Col[] = [
  { key: "fecha", label: "Fecha", tipo: "date", w: "w-28" },
  { key: "descripcion", label: "Descripción", tipo: "text", w: "min-w-[15rem]" },
  { key: "rut_emisor", label: "RUT", tipo: "rut", w: "w-32" },
  { key: "tipo_documento", label: "Tipo doc", tipo: "select", w: "w-36" },
  { key: "folio", label: "Folio", tipo: "text", w: "w-24" },
  { key: "monto_neto", label: "Neto", tipo: "money", right: true, w: "w-28" },
  { key: "impuesto", label: "Impuesto", tipo: "money", right: true, w: "w-28" },
  { key: "total", label: "Total", tipo: "money", right: true, w: "w-32" },
  { key: "reparto", label: "Reparto", tipo: "reparto", w: "w-44" },
  { key: "estado_pago", label: "Estado", tipo: "select", w: "w-32" },
  { key: "fecha_pago", label: "Fecha pago", tipo: "date", w: "w-28" },
];

const EDITABLES = COLS.map((c, i) => (c.tipo === "reparto" ? -1 : i)).filter((i) => i >= 0);

type FilaKey = number | "nuevo";
type Draft = Record<ColKey, string>;

/**
 * Una edición abierta. El `token` es único por edición: el blur del input
 * lo trae de vuelta y sólo se guarda si sigue siendo la edición vigente.
 * Así Enter/Tab/Esc (que ya cerraron la edición) no dependen de que el
 * navegador dispare o no el blur del input que se desmonta — React 19 no
 * lo despacha, y una bandera "saltar el próximo blur" quedaba pegada y se
 * comía el guardado de la SIGUIENTE celda abandonada con click.
 */
interface Edicion {
  fila: FilaKey;
  col: number;
  valor: string;
  token: number;
}

/**
 * Contraste AA (U3): el color vive en el punto y el fondo; el texto va en
 * tinta oscura. `text-positive` / `text-warning` sobre blanco no llegan a
 * 4,5:1 en 11 px.
 */
const ESTADO_PILL: Record<EstadoPago, { pill: string; dot: string; label: string }> = {
  PAGADO: { pill: "bg-positive/10 text-cehta-green-700", dot: "bg-positive", label: "Pagado" },
  PARCIAL: { pill: "bg-sf-blue/10 text-ink-700", dot: "bg-sf-blue", label: "Parcial" },
  PENDIENTE: { pill: "bg-warning/10 text-ink-700", dot: "bg-warning", label: "Pendiente" },
};

function PillEstado({ estado }: { estado: EstadoPago }) {
  const e = ESTADO_PILL[estado] ?? ESTADO_PILL.PENDIENTE;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", e.pill)}>
      <span className={cn("size-1.5 rounded-full", e.dot)} aria-hidden />
      {e.label}
    </span>
  );
}

/** Punto ámbar que acompaña a los textos "para revisar" (el color no va en el texto). */
function PuntoAviso() {
  return <span className="inline-block size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />;
}

/** ¿Hay un diálogo abierto (ficha, pegado, importar, borrar)? El pegado global no debe meterse ahí. */
function hayDialogoAbierto(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

function esCampoDeTexto(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// ── Helpers puros ────────────────────────────────────────────────────────

/** "2026-08-27" → "27-08-2026". Sin `Date`: evita el corrimiento de zona horaria. */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function montoInput(decimal: string | null | undefined): string {
  const c = decimalACentavos(decimal);
  return c === null ? "" : limpiarCeros(centavosADecimal(c));
}

function inputAMonto(s: string): number | null {
  const n = normalizarNumero(s);
  return n === "" ? null : decimalACentavos(n);
}

function rutNormalizado(s: string): string {
  const t = stripRut(s.trim());
  if (t.length < 2) return t;
  return `${t.slice(0, -1)}-${t.slice(-1)}`;
}

function draftVacio(fechaDefault: string): Draft {
  return {
    fecha: fechaDefault,
    descripcion: "",
    rut_emisor: "",
    tipo_documento: "FACTURA",
    folio: "",
    monto_neto: "",
    impuesto: "",
    total: "",
    reparto: "",
    estado_pago: "PENDIENTE",
    fecha_pago: "",
  };
}

function valorEditable(item: EgresoRead, col: Col): string {
  switch (col.key) {
    case "fecha":
      return item.fecha;
    case "fecha_pago":
      return item.fecha_pago ?? "";
    case "descripcion":
      return item.descripcion;
    case "rut_emisor":
      return item.rut_emisor ? formatRut(item.rut_emisor) : "";
    case "tipo_documento":
      return item.tipo_documento;
    case "estado_pago":
      return item.estado_pago;
    case "folio":
      return item.folio ?? "";
    case "monto_neto":
      return montoInput(item.monto_neto);
    case "impuesto":
      return montoInput(item.impuesto);
    case "total":
      return montoInput(item.total);
    default:
      return "";
  }
}

/** Qué mandar a la API por esta celda: `null` si no cambió, `{error}` si no vale. */
function patchDesdeCelda(
  item: EgresoRead,
  col: Col,
  valor: string,
): EgresoUpdate | null | { error: string } {
  const v = valor.trim();
  switch (col.key) {
    case "fecha":
      if (!v) return { error: "La fecha es obligatoria" };
      return v === item.fecha ? null : { fecha: v };
    case "fecha_pago":
      if ((item.fecha_pago ?? "") === v) return null;
      return { fecha_pago: v || null };
    case "descripcion":
      if (!v) return { error: "La descripción no puede quedar vacía" };
      return v === item.descripcion ? null : { descripcion: v };
    case "rut_emisor": {
      const r = v ? rutNormalizado(v) : "";
      if (r && !isValidRut(r)) return { error: `RUT ${v} inválido: el dígito verificador no coincide` };
      const actual = item.rut_emisor ? rutNormalizado(item.rut_emisor) : "";
      return r === actual ? null : { rut_emisor: r || null };
    }
    case "tipo_documento":
      return v === item.tipo_documento ? null : { tipo_documento: v as TipoDocumento };
    case "estado_pago":
      return v === item.estado_pago ? null : { estado_pago: v as EstadoPago };
    case "folio":
      if ((item.folio ?? "") === v) return null;
      return { folio: v || null };
    case "monto_neto":
    case "impuesto":
    case "total": {
      const c = inputAMonto(v);
      if (v && c === null) return { error: `"${v}" no es un monto` };
      if (col.key === "total" && c === null) return { error: "El total es obligatorio" };
      if (c !== null && c < 0) return { error: "Los montos no pueden ser negativos" };
      const actual = decimalACentavos(item[col.key]);
      if (c === actual) return null;
      try {
        return patchMontos(item, col.key, c);
      } catch (e) {
        // Neto o impuesto que no caben en el total: no se guarda, se avisa.
        if (e instanceof MontosInvalidosError) return { error: e.message };
        throw e;
      }
    }
    default:
      return null;
  }
}

/** La fila nueva → cuerpo del POST, o qué le falta. */
function filaDesdeDraft(d: Draft): { fila?: EgresoCreateFila; faltan: string[]; error?: string } {
  const faltan: string[] = [];
  if (!d.fecha) faltan.push("fecha");
  if (!d.descripcion.trim()) faltan.push("descripción");
  const total = inputAMonto(d.total);
  if (total === null) faltan.push("total");
  if (faltan.length) return { faltan };
  if (total! < 0) return { faltan, error: "El total no puede ser negativo" };
  const neto = inputAMonto(d.monto_neto);
  const imp = inputAMonto(d.impuesto);
  if (neto !== null && imp !== null && neto + imp !== total) {
    return { faltan, error: "Neto + impuesto no suman el total" };
  }
  const rut = d.rut_emisor.trim() ? rutNormalizado(d.rut_emisor) : "";
  if (rut && !isValidRut(rut)) return { faltan, error: `RUT ${d.rut_emisor} inválido` };
  return {
    faltan,
    fila: {
      fecha: d.fecha,
      descripcion: d.descripcion.trim(),
      rut_emisor: rut || null,
      tipo_documento: (d.tipo_documento || "OTRO") as TipoDocumento,
      folio: d.folio.trim() || null,
      monto_neto: neto === null ? null : centavosADecimal(neto),
      impuesto: imp === null ? null : centavosADecimal(imp),
      total: centavosADecimal(total!),
      estado_pago: (d.estado_pago || "PENDIENTE") as EstadoPago,
      fecha_pago: d.fecha_pago || null,
      origen: "UI",
    },
  };
}

// ── Componente ───────────────────────────────────────────────────────────

interface Props {
  items: EgresoRead[];
  loading: boolean;
  empresa: string;
  /** "" = todos los meses. Define la fecha por defecto de la fila nueva. */
  periodo: string;
  catalogos?: CatalogosResponse | null;
  mostrarTrewaox: boolean;
  onAbrir: (id: number) => void;
  onActualizar: (id: number, patch: EgresoUpdate) => Promise<EgresoRead>;
  onCrear: (fila: EgresoCreateFila) => Promise<EgresoRead>;
  onPegar: (filas: EgresoCreateFila[]) => Promise<void>;
  /** Cada cambio pide a la grilla que enfoque la fila nueva ("+ Nuevo gasto"). */
  focoNuevo: number;
  /** Qué mostrar cuando no hay filas (vacío honesto, lo arma el padre). */
  vacio: React.ReactNode;
}

export function EgresosGrid({
  items,
  loading,
  periodo,
  catalogos,
  onAbrir,
  onActualizar,
  onCrear,
  onPegar,
  focoNuevo,
  vacio,
}: Props) {
  const tablaRef = useRef<HTMLDivElement>(null);
  // La edición vive en un ref (sincrónico, lo leen los handlers de teclado
  // y blur) y en un estado (para renderizar). `setEdicion` asigna el token.
  const edicionRef = useRef<Edicion | null>(null);
  const tokenSeq = useRef(0);
  const [edicion, setEdicionState] = useState<Edicion | null>(null);
  const setEdicion = useCallback((e: { fila: FilaKey; col: number; valor: string } | null) => {
    const next: Edicion | null = e ? { ...e, token: ++tokenSeq.current } : null;
    edicionRef.current = next;
    setEdicionState(next);
  }, []);
  const cambiarValor = useCallback((valor: string) => {
    const cur = edicionRef.current;
    if (!cur) return;
    const next = { ...cur, valor };
    edicionRef.current = next;
    setEdicionState(next);
  }, []);
  const [flashId, setFlashId] = useState<number | null>(null);
  const [guardandoId, setGuardandoId] = useState<FilaKey | null>(null);
  const [pegado, setPegado] = useState<ResultadoPegado | null>(null);
  const [pegando, setPegando] = useState(false);
  /** Detalle del último 422 del batch, para listarlo adentro del diálogo. */
  const [erroresPegado, setErroresPegado] = useState<string[] | null>(null);
  const clickTotal = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fechaDefault = useMemo(() => {
    const hoy = hoyIso();
    if (!periodo || hoy.startsWith(periodo)) return hoy;
    return `${periodo}-01`;
  }, [periodo]);

  // El borrador de la fila nueva vive en un ref (sincrónico) y en un estado
  // (para renderizar): el blur de la celda y el blur de la fila llegan en el
  // mismo tick, y leer del estado ahí daría el valor viejo.
  const nuevoRef = useRef<Draft>(draftVacio(fechaDefault));
  const [nuevo, setNuevoState] = useState<Draft>(nuevoRef.current);
  const setNuevo = useCallback((d: Draft) => {
    nuevoRef.current = d;
    setNuevoState(d);
  }, []);
  useEffect(() => {
    if (!nuevoRef.current.descripcion && !nuevoRef.current.total) {
      setNuevo({ ...nuevoRef.current, fecha: fechaDefault });
    }
  }, [fechaDefault, setNuevo]);

  const tiposDoc = catalogos?.tipos_documento?.length ? catalogos.tipos_documento : TIPOS_DOCUMENTO;
  const estadosPago = catalogos?.estados_pago?.length ? catalogos.estados_pago : ESTADOS_PAGO;
  const labelTipo = useMemo(() => new Map(tiposDoc.map((t) => [t.codigo, t.label])), [tiposDoc]);

  const filaKeys: FilaKey[] = useMemo(() => [...items.map((i) => i.egreso_id), "nuevo"], [items]);

  // ── Foco y navegación ──────────────────────────────────────────────────

  const celda = useCallback((fila: FilaKey, col: number) => {
    return tablaRef.current?.querySelector<HTMLTableCellElement>(
      `td[data-fila="${fila}"][data-col="${col}"]`,
    );
  }, []);

  const enfocar = useCallback(
    (fila: FilaKey, col: number) => {
      const td = celda(fila, col);
      td?.focus();
      td?.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    [celda],
  );

  const filaVecina = useCallback(
    (fila: FilaKey, delta: number): FilaKey | null => {
      const idx = filaKeys.indexOf(fila);
      const n = idx + delta;
      if (idx < 0 || n < 0 || n >= filaKeys.length) return null;
      return filaKeys[n] ?? null;
    },
    [filaKeys],
  );

  const comenzarEdicion = useCallback(
    (fila: FilaKey, col: number, inicial?: string) => {
      const c = COLS[col];
      if (!c || c.tipo === "reparto") return;
      let valor: string;
      if (fila === "nuevo") {
        valor = nuevoRef.current[c.key];
      } else {
        const item = items.find((i) => i.egreso_id === fila);
        if (!item) return;
        valor = valorEditable(item, c);
      }
      setEdicion({ fila, col, valor: inicial !== undefined ? inicial : valor });
    },
    [items, setEdicion],
  );

  // ── Guardar ────────────────────────────────────────────────────────────

  const flash = useCallback((id: number) => {
    setFlashId(id);
    setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 900);
  }, []);

  const intentarCrear = useCallback(async () => {
    const r = filaDesdeDraft(nuevoRef.current);
    if (!r.fila) {
      if (r.error) toast.error(r.error);
      return false;
    }
    setGuardandoId("nuevo");
    try {
      const creado = await onCrear(r.fila);
      setNuevo(draftVacio(fechaDefault));
      toast.success("Gasto agregado", {
        description: `${creado.descripcion} · ${toCLP(centavosAPesos(decimalACentavos(creado.total) ?? 0))}`,
      });
      flash(creado.egreso_id);
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "No se pudo crear el gasto");
      return false;
    } finally {
      setGuardandoId(null);
    }
  }, [fechaDefault, flash, onCrear, setNuevo]);

  /** Cierra la celda y persiste si cambió. Devuelve false si hubo error. */
  const confirmar = useCallback(
    async (fila: FilaKey, col: number, valor: string): Promise<boolean> => {
      const c = COLS[col];
      setEdicion(null);
      if (!c) return true;
      if (fila === "nuevo") {
        setNuevo({ ...nuevoRef.current, [c.key]: valor });
        return true;
      }
      const item = items.find((i) => i.egreso_id === fila);
      if (!item) return true;
      const r = patchDesdeCelda(item, c, valor);
      if (r === null) return true;
      if ("error" in r) {
        toast.error(r.error);
        setEdicion({ fila, col, valor });
        return false;
      }
      setGuardandoId(fila);
      try {
        await onActualizar(item.egreso_id, r);
        flash(item.egreso_id);
        return true;
      } catch (e) {
        toast.error(e instanceof ApiError ? e.detail : "No se pudo guardar el cambio");
        setEdicion({ fila, col, valor });
        return false;
      } finally {
        setGuardandoId(null);
      }
    },
    [flash, items, onActualizar, setEdicion, setNuevo],
  );

  // ── Teclado ────────────────────────────────────────────────────────────

  function onKeyDownCelda(e: React.KeyboardEvent<HTMLTableCellElement>, fila: FilaKey, col: number) {
    if (edicionRef.current) return;
    const c = COLS[col];
    if (!c) return;
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      if (c.tipo === "reparto") {
        if (fila !== "nuevo") onAbrir(fila);
        return;
      }
      comenzarEdicion(fila, col);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const v = filaVecina(fila, e.key === "ArrowDown" ? 1 : -1);
      if (v !== null) enfocar(v, col);
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const n = col + (e.key === "ArrowRight" ? 1 : -1);
      if (n >= 0 && n < COLS.length) enfocar(fila, n);
      return;
    }
    // Empezar a escribir directamente sobre la celda, como en Excel.
    if (
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      c.tipo !== "reparto" &&
      c.tipo !== "select" &&
      c.tipo !== "date"
    ) {
      e.preventDefault();
      comenzarEdicion(fila, col, e.key);
    }
  }

  async function onKeyDownInput(e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
    const actual = edicionRef.current;
    if (!actual) return;
    const { fila, col, valor } = actual;
    const c = COLS[col];
    if (!c) return;
    const esDate = c.tipo === "date";
    const esSelect = c.tipo === "select";

    // Nada de "saltar el próximo blur": cerrar la edición invalida su token
    // y el blur que llegue después (si llega) se ignora solo.
    if (e.key === "Escape") {
      e.preventDefault();
      setEdicion(null);
      enfocar(fila, col);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const ok = await confirmar(fila, col, valor);
      if (!ok) return;
      if (fila === "nuevo") {
        const creado = await intentarCrear();
        enfocar("nuevo", creado ? 1 : col);
        if (!creado) {
          const r = filaDesdeDraft(nuevoRef.current);
          if (r.faltan.length) {
            const siguiente = COLS.findIndex((cc) => r.faltan.includes(cc.key === "descripcion" ? "descripción" : cc.key));
            if (siguiente >= 0) comenzarEdicion("nuevo", siguiente);
          }
        }
        return;
      }
      const v = filaVecina(fila, 1);
      enfocar(v ?? fila, col);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ok = await confirmar(fila, col, valor);
      if (!ok) return;
      const pos = EDITABLES.indexOf(col);
      const dir = e.shiftKey ? -1 : 1;
      let nextFila: FilaKey | null = fila;
      let nextCol: number | undefined = EDITABLES[pos + dir];
      if (nextCol === undefined) {
        nextFila = filaVecina(fila, dir);
        nextCol = dir > 0 ? EDITABLES[0] : EDITABLES[EDITABLES.length - 1];
      }
      if (nextFila === null || nextCol === undefined) {
        enfocar(fila, col);
        return;
      }
      if (fila === "nuevo" && nextFila !== "nuevo") {
        // Salir de la fila nueva hacia arriba: si está completa, se crea.
        await intentarCrear();
      }
      enfocar(nextFila, nextCol);
      comenzarEdicion(nextFila, nextCol);
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !esDate && !esSelect) {
      e.preventDefault();
      const ok = await confirmar(fila, col, valor);
      if (!ok) return;
      const v = filaVecina(fila, e.key === "ArrowDown" ? 1 : -1);
      if (fila === "nuevo" && v !== null) await intentarCrear();
      if (v === null) {
        enfocar(fila, col);
        return;
      }
      enfocar(v, col);
      comenzarEdicion(v, col);
    }
  }

  /** Blur del input de la celda: guarda sólo si esa edición sigue vigente. */
  function onBlurInput(token: number) {
    const cur = edicionRef.current;
    if (!cur || cur.token !== token) return;
    void confirmar(cur.fila, cur.col, cur.valor);
  }

  function onBlurFilaNueva(e: React.FocusEvent<HTMLTableRowElement>) {
    const destino = e.relatedTarget as Node | null;
    if (destino && e.currentTarget.contains(destino)) return;
    // Al irse de la fila nueva (a otra fila, a un botón, afuera): si está
    // completa se crea; si no, el borrador queda esperando.
    setTimeout(() => {
      const r = filaDesdeDraft(nuevoRef.current);
      if (r.fila) void intentarCrear();
    }, 0);
  }

  // ── "+ Nuevo gasto" desde el header ────────────────────────────────────
  useEffect(() => {
    if (focoNuevo <= 0) return;
    enfocar("nuevo", 1);
    comenzarEdicion("nuevo", 1);
  }, [focoNuevo, enfocar, comenzarEdicion]);

  // ── Pegar ──────────────────────────────────────────────────────────────

  // El listener va a nivel `document` mientras la grilla está montada:
  // Claudia copia en Excel, vuelve a la pestaña y aprieta Ctrl+V sin haber
  // hecho click en ninguna celda (el foco queda en el body). Se ignora si
  // el destino es un input/textarea fuera de la grilla (ahí gana el pegado
  // normal) o si hay un diálogo abierto (ficha, importar, borrar).
  useEffect(() => {
    function onPasteDocumento(e: ClipboardEvent) {
      const tabla = tablaRef.current;
      if (!tabla) return;
      const objetivo = e.target;
      const dentro = objetivo instanceof Node && tabla.contains(objetivo);
      if (!dentro && (esCampoDeTexto(objetivo) || hayDialogoAbierto())) return;
      const texto = e.clipboardData?.getData("text/plain") ?? "";
      if (!texto) {
        // Sólo si el portapapeles no se pudo leer y el foco estaba afuera:
        // el pegado por evento no trajo texto (o vino vacío), que pruebe
        // desde la grilla misma.
        if (!dentro) toast.info("Hacé click en la grilla y volvé a pegar");
        return;
      }
      // Dentro de una celda, un pegado de una sola línea es el pegado común.
      if (dentro && esCampoDeTexto(objetivo) && !texto.includes("\t") && !/\n/.test(texto.trim())) {
        return;
      }
      const r = parsearEgresosPegados(texto);
      if (r.filas.length === 0) return;
      e.preventDefault();
      if (edicionRef.current) setEdicion(null);
      setErroresPegado(null);
      setPegado(r);
    }
    document.addEventListener("paste", onPasteDocumento);
    return () => document.removeEventListener("paste", onPasteDocumento);
  }, [setEdicion]);

  const validas = useMemo(() => pegado?.filas.filter((f) => f.errores.length === 0) ?? [], [pegado]);
  const invalidas = useMemo(() => pegado?.filas.filter((f) => f.errores.length > 0) ?? [], [pegado]);
  const avisos = useMemo(() => validas.reduce((acc, f) => acc + f.avisos.length, 0), [validas]);
  const nLotes = Math.ceil(validas.length / BATCH_MAX_FILAS);

  async function confirmarPegado() {
    if (!validas.length) return;
    setPegando(true);
    setErroresPegado(null);
    try {
      await onPegar(validas.map(egresoPegadoAFila));
      toast.success(
        `${validas.length} ${validas.length === 1 ? "gasto agregado" : "gastos agregados"}`,
        { description: toCLP(centavosAPesos(totalPegado(validas))) },
      );
      setPegado(null);
    } catch (e) {
      // El 422 del batch trae un motivo por fila ("Fila 3: …"): se lista
      // completo adentro del diálogo, que es donde Claudia lo puede leer;
      // el toast se corta y no le sirve para corregir 20 filas.
      const detalle = e instanceof ApiError ? e.detail : "No se pudieron agregar los gastos pegados";
      setErroresPegado(detalle.split(" · ").map((s) => s.trim()).filter(Boolean));
      toast.error("No se pudieron agregar los gastos pegados", {
        description: "El detalle está en el diálogo.",
      });
    } finally {
      setPegando(false);
    }
  }

  function cerrarPegado() {
    if (pegando) return;
    setPegado(null);
    setErroresPegado(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) return <SkeletonTable rows={8} columns={8} />;

  const draftEstado = filaDesdeDraft(nuevo);
  const nuevoTocado = Boolean(nuevo.descripcion || nuevo.total || nuevo.folio || nuevo.rut_emisor);

  return (
    <div className="space-y-2">
      <p className="sr-only" id="egresos-grid-ayuda">
        Grilla editable. Doble click o Enter editan la celda; Tab y Shift+Tab avanzan; flechas
        arriba y abajo cambian de fila; Escape cancela. Pegar con Control+V agrega filas copiadas
        desde Excel.
      </p>
      <div
        ref={tablaRef}
        tabIndex={0}
        aria-label="Registro de egresos"
        className="max-h-[70vh] overflow-auto rounded-2xl bg-white shadow-card ring-1 ring-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
      >
        <table
          role="grid"
          className="w-full min-w-[1180px] border-separate border-spacing-0 text-sm"
          aria-describedby="egresos-grid-ayuda"
        >
          <thead className="sticky top-0 z-10 bg-surface-muted/95 backdrop-blur">
            <tr>
              <th scope="col" className="w-9 border-b border-hairline">
                <span className="sr-only">Abrir ficha</span>
              </th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "border-b border-hairline px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500",
                    c.right ? "text-right" : "text-left",
                    c.w,
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 1} className="border-b border-hairline p-0">
                  {vacio}
                </td>
              </tr>
            )}
            {items.map((item) => {
              const totalC = decimalACentavos(item.total) ?? 0;
              const montos = repartoDesdeApi(item.reparto);
              const enFlash = flashId === item.egreso_id;
              const guardando = guardandoId === item.egreso_id;
              return (
                <tr
                  key={item.egreso_id}
                  className={cn(
                    "group transition-colors duration-700",
                    enFlash ? "bg-cehta-green/10" : "hover:bg-surface-muted/60",
                  )}
                >
                  <td className="border-b border-hairline px-1 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => onAbrir(item.egreso_id)}
                      aria-label={`Abrir ficha de ${item.descripcion}`}
                      className="inline-flex size-7 items-center justify-center rounded-lg text-ink-500 transition-colors duration-150 hover:bg-ink-100/60 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
                    >
                      {guardando ? (
                        <Loader2 className="size-3.5 animate-spin text-cehta-green" strokeWidth={2} />
                      ) : enFlash ? (
                        <Check className="size-3.5 text-cehta-green" strokeWidth={2.5} />
                      ) : (
                        <ChevronRight className="size-3.5" strokeWidth={2} />
                      )}
                    </button>
                  </td>
                  {COLS.map((c, ci) => (
                    <Celda
                      key={c.key}
                      fila={item.egreso_id}
                      col={ci}
                      colDef={c}
                      editando={edicion?.fila === item.egreso_id && edicion.col === ci ? edicion : null}
                      onCambio={cambiarValor}
                      onKeyDownCelda={onKeyDownCelda}
                      onKeyDownInput={onKeyDownInput}
                      onBlurInput={onBlurInput}
                      onDobleClick={() => comenzarEdicion(item.egreso_id, ci)}
                      onClick={
                        c.key === "total"
                          ? () => {
                              if (clickTotal.current) clearTimeout(clickTotal.current);
                              clickTotal.current = setTimeout(() => onAbrir(item.egreso_id), 230);
                            }
                          : c.key === "reparto"
                            ? () => onAbrir(item.egreso_id)
                            : undefined
                      }
                      onCancelarClick={() => {
                        if (clickTotal.current) clearTimeout(clickTotal.current);
                      }}
                      tiposDoc={tiposDoc}
                      estadosPago={estadosPago}
                    >
                      {renderDisplay(item, c, totalC, montos, labelTipo)}
                    </Celda>
                  ))}
                </tr>
              );
            })}

            {/* Fila nueva, siempre al final */}
            <tr
              className={cn(
                "bg-surface-muted/40 transition-colors duration-300",
                guardandoId === "nuevo" && "opacity-60",
              )}
              onBlur={onBlurFilaNueva}
            >
              <td className="border-b border-hairline px-1 py-1 text-center">
                {guardandoId === "nuevo" ? (
                  <Loader2 className="mx-auto size-3.5 animate-spin text-cehta-green" strokeWidth={2} />
                ) : draftEstado.fila ? (
                  <button
                    type="button"
                    onClick={() => void intentarCrear()}
                    aria-label="Guardar el gasto nuevo"
                    title="Guardar (o presioná Enter)"
                    className="inline-flex size-7 items-center justify-center rounded-lg bg-cehta-green text-white transition-colors duration-150 hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-1"
                  >
                    <Check className="size-3.5" strokeWidth={2.5} />
                  </button>
                ) : (
                  <span className="text-ink-500" aria-hidden>
                    +
                  </span>
                )}
              </td>
              {COLS.map((c, ci) => (
                <Celda
                  key={c.key}
                  fila="nuevo"
                  col={ci}
                  colDef={c}
                  editando={edicion?.fila === "nuevo" && edicion.col === ci ? edicion : null}
                  onCambio={cambiarValor}
                  onKeyDownCelda={onKeyDownCelda}
                  onKeyDownInput={onKeyDownInput}
                  onBlurInput={onBlurInput}
                  onDobleClick={() => comenzarEdicion("nuevo", ci)}
                  tiposDoc={tiposDoc}
                  estadosPago={estadosPago}
                  nueva
                >
                  {renderDraft(nuevo, c, labelTipo, nuevoTocado)}
                </Celda>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <ClipboardPaste className="size-3.5" strokeWidth={1.75} />
          Copiá filas de tu Excel y pegalas acá (Ctrl+V). Doble click o Enter para editar una celda.
        </span>
        {nuevoTocado && !draftEstado.fila && (
          <span className="inline-flex items-center gap-1.5 text-ink-700" aria-live="polite">
            <AlertTriangle className="size-3.5 text-warning" strokeWidth={2} />
            {draftEstado.error ?? `Para guardar el gasto nuevo falta: ${draftEstado.faltan.join(", ")}`}
          </span>
        )}
      </div>

      {/* Confirmación del pegado */}
      <Dialog open={pegado !== null} onOpenChange={(o) => !o && cerrarPegado()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {validas.length === 0
                ? "No hay filas que se puedan agregar"
                : `Vas a agregar ${validas.length} ${validas.length === 1 ? "gasto" : "gastos"} por ${toCLP(centavosAPesos(totalPegado(validas)))}`}
            </DialogTitle>
            <DialogDescription>
              {pegado?.conEncabezado
                ? "Se reconoció la fila de encabezados y las columnas por su nombre."
                : `Se asumió el orden de columnas de tu planilla (${pegado?.columnas.length ?? 0} columnas).`}
              {avisos > 0 && ` ${avisos} ${avisos === 1 ? "dato se interpretó" : "datos se interpretaron"} con una suposición.`}
            </DialogDescription>
          </DialogHeader>
          {nLotes > 1 && (
            <div className="mt-3 rounded-xl bg-sf-blue/10 px-3 py-2 text-xs text-ink-700">
              <p className="font-medium text-ink-900">
                Son más de {BATCH_MAX_FILAS} filas: se agregan en {nLotes} lotes de hasta {BATCH_MAX_FILAS}.
              </p>
              <p className="mt-0.5">
                El todo-o-nada pasa a ser por lote: si falla el lote 3, los dos anteriores ya quedaron
                guardados. Para volúmenes grandes conviene <strong>Importar Excel</strong>, que además
                no duplica lo que ya existe.
              </p>
            </div>
          )}
          {erroresPegado && erroresPegado.length > 0 && (
            <div
              className="mt-3 rounded-xl bg-negative/10 p-3 text-xs text-ink-900"
              role="alert"
              aria-live="assertive"
            >
              <p className="inline-flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-3.5 text-negative" strokeWidth={2} />
                La API rechazó el pegado
              </p>
              <ul className="mt-1.5 max-h-40 list-inside list-disc space-y-1 overflow-auto">
                {erroresPegado.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {validas.length > 0 && (
            <ul className="mt-4 max-h-48 space-y-1 overflow-auto rounded-xl bg-surface-muted p-3 text-xs">
              {validas.slice(0, 12).map((f) => (
                <li key={f.fila} className="flex justify-between gap-3">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-ink-700">
                    <span className="truncate">
                      {fechaCorta(f.fecha)} · {f.descripcion}
                    </span>
                    {f.avisos.length > 0 && (
                      <span title={f.avisos.join("\n")} className="inline-flex shrink-0 items-center">
                        <PuntoAviso />
                        <span className="sr-only">{f.avisos.join(". ")}</span>
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-900">
                    {toCLP(centavosAPesos(decimalACentavos(f.total) ?? 0))}
                  </span>
                </li>
              ))}
              {validas.length > 12 && (
                <li className="text-ink-500">… y {validas.length - 12} más</li>
              )}
            </ul>
          )}
          {invalidas.length > 0 && (
            <div className="mt-3 rounded-xl bg-warning/10 p-3 text-xs text-ink-700">
              <p className="inline-flex items-center gap-1.5 font-medium text-ink-900">
                <AlertTriangle className="size-3.5 text-warning" strokeWidth={2} />
                {invalidas.length} {invalidas.length === 1 ? "fila no se va a agregar" : "filas no se van a agregar"}
              </p>
              <ul className="mt-1.5 max-h-32 space-y-1 overflow-auto">
                {invalidas.map((f) => (
                  <li key={f.fila}>
                    <span className="font-medium">Fila {f.fila}</span>
                    {f.descripcion ? ` · ${f.descripcion}` : ""}: {f.errores.join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={cerrarPegado}
              disabled={pegando}
              className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void confirmarPegado()}
              disabled={pegando || validas.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-50"
            >
              {pegando && <Loader2 className="size-4 animate-spin" strokeWidth={2} />}
              Agregar {validas.length > 0 ? validas.length : ""}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Celda ────────────────────────────────────────────────────────────────

/** Largo máximo del input de la celda (los de la API), si aplica. */
const MAXLEN_COL: Partial<Record<ColKey, number>> = {
  descripcion: LARGO_MAX.descripcion,
  folio: LARGO_MAX.folio,
};

interface CeldaProps {
  fila: FilaKey;
  col: number;
  colDef: Col;
  /** La edición abierta en esta celda (valor + token), o null en modo lectura. */
  editando: Pick<Edicion, "valor" | "token"> | null;
  onCambio: (v: string) => void;
  onKeyDownCelda: (e: React.KeyboardEvent<HTMLTableCellElement>, fila: FilaKey, col: number) => void;
  onKeyDownInput: (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void;
  onBlurInput: (token: number) => void;
  onDobleClick: () => void;
  onClick?: () => void;
  onCancelarClick?: () => void;
  tiposDoc: ReadonlyArray<{ codigo: string; label: string }>;
  estadosPago: ReadonlyArray<{ codigo: string; label: string }>;
  nueva?: boolean;
  children: React.ReactNode;
}

function Celda({
  fila,
  col,
  colDef,
  editando,
  onCambio,
  onKeyDownCelda,
  onKeyDownInput,
  onBlurInput,
  onDobleClick,
  onClick,
  onCancelarClick,
  tiposDoc,
  estadosPago,
  nueva,
  children,
}: CeldaProps) {
  const editable = colDef.tipo !== "reparto";
  const inputClase =
    "h-8 w-full rounded-lg bg-white px-2 text-sm text-ink-900 ring-2 ring-cehta-green focus:outline-none";
  // El nombre accesible del input: la columna, y "(gasto nuevo)" en la fila
  // de abajo. En modo lectura el td NO lleva aria-label: taparía el
  // contenido real de la celda para el lector de pantalla.
  const labelInput = `${colDef.label}${nueva ? " (gasto nuevo)" : ""}`;
  return (
    <td
      data-fila={fila}
      data-col={col}
      tabIndex={0}
      role="gridcell"
      aria-readonly={editable ? undefined : true}
      onKeyDown={(e) => onKeyDownCelda(e, fila, col)}
      onDoubleClick={() => {
        onCancelarClick?.();
        onDobleClick();
      }}
      onClick={onClick}
      className={cn(
        "border-b border-hairline px-3 py-1.5 align-middle outline-none transition-shadow duration-150",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cehta-green",
        colDef.right && "text-right tabular-nums",
        colDef.key === "total" && "cursor-pointer",
        colDef.tipo === "reparto" && "cursor-pointer",
        editando !== null && "p-1",
      )}
    >
      {editando === null ? (
        children
      ) : colDef.tipo === "select" ? (
        <select
          autoFocus
          value={editando.valor}
          onChange={(e) => onCambio(e.target.value)}
          onKeyDown={onKeyDownInput}
          onBlur={() => onBlurInput(editando.token)}
          aria-label={labelInput}
          className={inputClase}
        >
          {(colDef.key === "tipo_documento" ? tiposDoc : estadosPago).map((o) => (
            <option key={o.codigo} value={o.codigo}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          autoFocus
          type={colDef.tipo === "date" ? "date" : "text"}
          inputMode={colDef.tipo === "money" ? "decimal" : undefined}
          maxLength={MAXLEN_COL[colDef.key]}
          value={editando.valor}
          onChange={(e) => onCambio(e.target.value)}
          onKeyDown={onKeyDownInput}
          onBlur={() => onBlurInput(editando.token)}
          onFocus={(e) => colDef.tipo !== "date" && e.target.select()}
          aria-label={labelInput}
          className={cn(inputClase, colDef.right && "text-right tabular-nums")}
        />
      )}
    </td>
  );
}

// ── Render de lectura ────────────────────────────────────────────────────

function renderDisplay(
  item: EgresoRead,
  c: Col,
  totalC: number,
  montos: ReturnType<typeof repartoDesdeApi>,
  labelTipo: Map<string, string>,
): React.ReactNode {
  switch (c.key) {
    case "fecha":
      return <span className="tabular-nums text-ink-700">{fechaCorta(item.fecha)}</span>;
    case "fecha_pago":
      if (item.fecha_pago) return <span className="tabular-nums text-ink-700">{fechaCorta(item.fecha_pago)}</span>;
      if (item.estado_pago === "PAGADO") {
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-700" title="Pagado sin fecha de pago">
            <PuntoAviso />
            sin fecha
          </span>
        );
      }
      return <span className="text-ink-500">—</span>;
    case "descripcion":
      return (
        <span className="block max-w-[22rem] truncate font-medium text-ink-900" title={item.descripcion}>
          {item.descripcion}
        </span>
      );
    case "rut_emisor":
      return item.rut_emisor ? (
        <span className="tabular-nums text-ink-700">{formatRut(item.rut_emisor)}</span>
      ) : (
        <span className="text-ink-500">—</span>
      );
    case "tipo_documento":
      return <span className="text-ink-700">{labelTipo.get(item.tipo_documento) ?? item.tipo_documento}</span>;
    case "folio":
      return item.folio ? <span className="tabular-nums text-ink-700">{item.folio}</span> : <span className="text-ink-500">—</span>;
    case "monto_neto":
    case "impuesto": {
      const v = decimalACentavos(item[c.key]);
      if (v === null) return <span className="text-ink-500">—</span>;
      return (
        <span
          className="inline-flex items-center gap-1.5 text-ink-700"
          title={item.neto_mas_impuesto_cuadra ? undefined : "Neto + impuesto no suman el total"}
        >
          {!item.neto_mas_impuesto_cuadra && <PuntoAviso />}
          {toCLP(centavosAPesos(v))}
        </span>
      );
    }
    case "total":
      return <span className="font-semibold text-ink-900">{toCLP(centavosAPesos(totalC))}</span>;
    case "reparto":
      return (
        <div className="flex items-center gap-2">
          <RepartoBarra total={totalC} montos={montos} estado={item.reparto_estado} className="w-16 shrink-0" />
          <BadgeReparto estado={item.reparto_estado} />
        </div>
      );
    case "estado_pago":
      return <PillEstado estado={item.estado_pago} />;
    default:
      return null;
  }
}

function renderDraft(d: Draft, c: Col, labelTipo: Map<string, string>, tocado: boolean): React.ReactNode {
  // ink-500 (#6e6e73) sobre blanco da 5,3:1; ink-300 no llegaba a AA.
  const gris = "text-ink-500";
  switch (c.key) {
    case "fecha":
      return <span className="tabular-nums text-ink-500">{fechaCorta(d.fecha)}</span>;
    case "fecha_pago":
      return d.fecha_pago ? <span className="tabular-nums text-ink-700">{fechaCorta(d.fecha_pago)}</span> : <span className={gris}>—</span>;
    case "descripcion":
      return d.descripcion ? (
        <span className="block max-w-[22rem] truncate text-ink-900">{d.descripcion}</span>
      ) : (
        <span className={cn(gris, "italic")}>{tocado ? "Falta la descripción" : "Nuevo gasto: escribí acá…"}</span>
      );
    case "rut_emisor":
      return d.rut_emisor ? <span className="tabular-nums text-ink-700">{d.rut_emisor}</span> : <span className={gris}>—</span>;
    case "tipo_documento":
      return <span className="text-ink-500">{labelTipo.get(d.tipo_documento) ?? d.tipo_documento}</span>;
    case "folio":
      return d.folio ? <span className="tabular-nums text-ink-700">{d.folio}</span> : <span className={gris}>—</span>;
    case "monto_neto":
    case "impuesto":
    case "total": {
      const v = inputAMonto(d[c.key]);
      if (v === null) {
        if (c.key === "total" && tocado) {
          return (
            <span className={cn(gris, "inline-flex items-center gap-1.5")}>
              <PuntoAviso />$ —
            </span>
          );
        }
        return <span className={gris}>{c.key === "total" ? "$ —" : "—"}</span>;
      }
      return <span className={cn(c.key === "total" ? "font-semibold text-ink-900" : "text-ink-700")}>{toCLP(centavosAPesos(v))}</span>;
    }
    case "reparto":
      return <span className={cn(gris, "text-xs")}>después, en la ficha</span>;
    case "estado_pago":
      return <PillEstado estado={(d.estado_pago || "PENDIENTE") as EstadoPago} />;
    default:
      return null;
  }
}

/**
 * Badge del estado del reparto. Contraste AA: el color va en el fondo y
 * el punto; el texto en tinta (verde oscuro para OK, ink-900 sobre rojo
 * suave para Descuadrado).
 */
export function BadgeReparto({ estado }: { estado: EgresoRead["reparto_estado"] }) {
  if (estado === "OK") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 px-2 py-0.5 text-[11px] font-medium text-cehta-green-700">
        <Check className="size-3 text-positive" strokeWidth={2.5} />
        OK
      </span>
    );
  }
  if (estado === "SIN_CLASIFICAR") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-ink-700">
        <PuntoAviso />
        Sin clasificar
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-negative/10 px-2 py-0.5 text-[11px] font-medium text-ink-900">
      <span className="inline-block size-1.5 shrink-0 rounded-full bg-negative" aria-hidden />
      Descuadrado
    </span>
  );
}
