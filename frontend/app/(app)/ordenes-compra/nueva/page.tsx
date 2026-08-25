"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, Cloud, Plus, Trash2, Wand2 } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { ProveedorTypeaheadCached } from "@/components/proveedores/ProveedorTypeaheadCached";
import type { ProveedorContacto } from "@/components/proveedores/ProveedorContactosPanel";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { useFormAutosave } from "@/hooks/use-form-autosave";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useFormShortcuts } from "@/hooks/use-form-shortcuts";
import { toast } from "@/components/ui/toast";
import { apiClient, ApiError } from "@/lib/api/client";
import { toCLP } from "@/lib/format";
import type { OcRead } from "@/lib/api/schema";
import { TextareaAutosize } from "@/components/ui/textarea-autosize";
import { parsearItemsPegados } from "@/lib/oc/pegar-items";

interface ItemForm {
  descripcion: string;
  unidad: string;
  precio_unitario: string;
  cantidad: string;
}

interface ProveedorSearchResult {
  rut_valid: boolean;
  rut_canonical: string | null;
  exists: boolean;
  proveedor: {
    proveedor_id: number;
    razon_social: string;
    rut: string | null;
    activo: boolean;
  } | null;
}

type ProveedorLookupState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "invalid" }
  | { status: "existing"; razonSocial: string; rutCanonical: string }
  | { status: "new"; rutCanonical: string };

const inputBase =
  "w-full rounded-lg border-0 ring-1 ring-hairline bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 transition-shadow focus:outline-none focus:ring-2 focus:ring-cehta-green";
const labelBase = "mb-1.5 block text-sm font-medium text-ink-700";
const requiredMark = <span className="ml-0.5 text-negative">*</span>;

const MONEDAS: ComboboxItem[] = [
  { value: "CLP", label: "CLP" },
  { value: "UF", label: "UF" },
  { value: "USD", label: "USD" },
];

// Los 4 documentos que la OC sabe emitir. El `value` es el token que viaja a
// la BD — es el mismo del catálogo SII que ya usa core.vouchers.doc_tributario_tipo,
// para que el mapeo OC→voucher sea la identidad. La etiqueta en castellano es
// presentación: vive acá y en el PDF, nunca en la columna.
const TIPOS_DOCUMENTO: ComboboxItem[] = [
  { value: "FACTURA", label: "Factura", group: "Afectas a IVA" },
  { value: "BOLETA", label: "Boleta", group: "Afectas a IVA" },
  { value: "FACTURA_EXENTA", label: "Factura exenta", group: "Sin IVA" },
  { value: "HONORARIOS", label: "Boleta de honorarios", group: "Sin IVA" },
];

const esAfecto = (tipo: string) => tipo === "FACTURA" || tipo === "BOLETA";

/**
 * Escala del Art. 74 N°2 LIR (Ley 21.133). Esto es una SUGERENCIA de UI para
 * que el operador no tenga que buscar la tasa del año: la tasa de verdad vive
 * en `core.tax_config` (invariante 10) y el servidor la confirma contra la
 * fecha de emisión. Mismo criterio que el default "19" del IVA.
 * A partir de 2028 la ley la deja fija en 17%.
 */
function retencionSugerida(fechaEmision: string): string {
  const anio = Number(fechaEmision.slice(0, 4));
  if (!Number.isFinite(anio) || anio <= 2024) return "13.75";
  if (anio === 2025) return "14.5";
  if (anio === 2026) return "15.25";
  if (anio === 2027) return "16";
  return "17";
}

/**
 * Espejo de la matemática del backend (§3 del megaprompt de honorarios). Vive
 * acá SÓLO para el resumen en vivo: el número que vale es el que devuelve el
 * servidor al guardar.
 *
 * Es una excepción consciente a "sin cálculos de negocio en el FE": sin ver
 * las tres cifras antes de guardar, el operador carga el líquido pactado en el
 * campo del bruto y el profesional termina cobrando 15% de menos. Mismo
 * criterio que OcCuotasSection, que ya espeja `_derivar_montos`.
 *
 * `Math.round` es half-up para positivos, igual que el ROUND_HALF_UP de
 * `_round_clp`. La retención se redondea y el líquido sale POR RESTA, para que
 * `total_a_pagar + retencion_monto == total` cierre exacto (§3.3).
 */
function derivarTotales(opts: {
  base: number;
  tipo: string;
  ivaPct: number;
  retencionPct: number;
  moneda: string;
}) {
  const { base, tipo, ivaPct, retencionPct, moneda } = opts;
  // El backend no calcula IVA fuera de CLP (OrdenCompraCreate.iva_calculado).
  const iva =
    esAfecto(tipo) && moneda === "CLP" ? Math.round(base * (ivaPct / 100)) : 0;
  const total = base + iva;
  const retencion =
    tipo === "HONORARIOS" ? Math.round(base * (retencionPct / 100)) : 0;
  return { neto: base, iva, total, retencion, totalAPagar: total - retencion };
}

/**
 * Gross-up: bruto que hay que contratar para que el profesional reciba
 * `liquido` después de la retención. $1.000.000 al 15,25% → $1.179.941.
 */
function brutoDesdeLiquido(liquido: number, retencionPct: number): number {
  const factor = 1 - retencionPct / 100;
  if (factor <= 0) return liquido; // retención 100%: no hay gross-up posible
  return Math.round(liquido / factor);
}

/**
 * Parseo tolerante: "" y basura valen 0, pero un 0 tipeado vale 0 de verdad.
 * Nada de `Number(x) || fallback`: con 0% de IVA o de retención eso devuelve
 * el fallback y la OC exenta vuelve a mostrar 19%.
 */
const toNum = (v: string, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// Unidades que usa el equipo en las OC reales. Son SUGERENCIAS (datalist),
// no una lista cerrada: el operador puede escribir cualquier otra y se
// guarda tal cual. Aparecen en la columna "Un." del PDF.
const UNIDADES_SUGERIDAS = [
  "Un",
  "Gl",
  "Días",
  "m3",
  "m2",
  "ml",
  "Kg",
  "Ton",
  "Hrs",
  "Global",
];

/** Fila del resumen de totales. `destacado` = la cifra que se va a girar. */
function TotalRow({
  label,
  valor,
  destacado = false,
  negativo = false,
}: {
  label: React.ReactNode;
  valor: string;
  destacado?: boolean;
  negativo?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4${
        destacado ? " border-t border-hairline pt-2" : ""
      }`}
    >
      <dt
        className={
          destacado
            ? "text-sm font-medium text-ink-900"
            : "text-sm text-ink-500"
        }
      >
        {label}
      </dt>
      <dd
        className={
          destacado
            ? "text-base font-semibold text-cehta-green tabular-nums"
            : `text-sm tabular-nums ${negativo ? "text-negative" : "text-ink-900"}`
        }
      >
        {negativo ? `− ${valor}` : valor}
      </dd>
    </div>
  );
}

export default function NuevaOcPage() {
  const router = useRouter();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { data: empresas = [] } = useCatalogoEmpresas();

  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [numeroOc, setNumeroOc] = useState("");
  // Condiciones generales del PDF (las 4 clausulas de arbitraje). Arranca en
  // true: es una clausula contractual, sacarla tiene que ser deliberado.
  const [incluyeCondiciones, setIncluyeCondiciones] = useState(true);
  // De donde salio el numero sugerido. Se muestra bajo el campo: una
  // sugerencia que no explica su origen se acepta a ciegas, y aca lo que se
  // acepta a ciegas es la identidad de un documento tributario.
  const [motivoNumero, setMotivoNumero] = useState<string | null>(null);
  const [sugiriendoNumero, setSugiriendoNumero] = useState(false);
  const [proveedorRut, setProveedorRut] = useState("");
  const [proveedorNombre, setProveedorNombre] = useState("");
  const [proveedorLookup, setProveedorLookup] = useState<ProveedorLookupState>({
    status: "idle",
  });
  // proveedor_id resuelto — solo se conoce cuando el proveedor YA existe en
  // el catálogo (por RUT o por el typeahead). Con esto se puede cargar sus
  // encargados para el selector "Dirigido a". Si es null, el operador puede
  // igual tipear un destinatario suelto (atte_nombre/atte_cargo).
  const [proveedorId, setProveedorId] = useState<number | null>(null);
  const [proveedorContactoId, setProveedorContactoId] = useState<string>("");
  const [atteNombreManual, setAtteNombreManual] = useState("");
  const [atteCargoManual, setAtteCargoManual] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("FACTURA");
  const [ivaPorcentaje, setIvaPorcentaje] = useState("19");
  // Retención de honorarios. Sólo se usa (y se muestra) con tipo HONORARIOS.
  const [retencionPorcentaje, setRetencionPorcentaje] = useState("15.25");
  // Modo de carga del monto en honorarios (§3.2 del megaprompt): BRUTO = lo
  // que cargo en los ítems es el honorario antes de retención; LIQUIDO = es
  // lo que el profesional recibe en la cuenta y lo grosseamos al guardar.
  const [modoMonto, setModoMonto] = useState<"BRUTO" | "LIQUIDO">("BRUTO");
  const [fechaEmision, setFechaEmision] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [moneda, setMoneda] = useState("CLP");
  const [validezDias, setValidezDias] = useState("30");
  const [formaPago, setFormaPago] = useState("");
  const [plazoPago, setPlazoPago] = useState("");
  // Plazo de ENTREGA — distinto del plazo de pago. Las OC reales llevan
  // los dos y el PDF los imprime en filas separadas del bloque PROVEEDOR.
  const [plazoEntrega, setPlazoEntrega] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [items, setItems] = useState<ItemForm[]>([
    { descripcion: "", unidad: "", precio_unitario: "", cantidad: "1" },
  ]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // V5++ ola CE — Auto-save + warning + shortcuts (consistentes con Nubox).
  const draftState = useMemo(
    () => ({
      empresaCodigo,
      numeroOc,
      proveedorRut,
      proveedorNombre,
      fechaEmision,
      moneda,
      validezDias,
      formaPago,
      plazoPago,
      plazoEntrega,
      observaciones,
      incluyeCondiciones,
      items,
      tipoDocumento,
      ivaPorcentaje,
      retencionPorcentaje,
      modoMonto,
    }),
    [
      empresaCodigo,
      numeroOc,
      proveedorRut,
      proveedorNombre,
      fechaEmision,
      moneda,
      validezDias,
      formaPago,
      plazoPago,
      plazoEntrega,
      observaciones,
      incluyeCondiciones,
      items,
      tipoDocumento,
      ivaPorcentaje,
      retencionPorcentaje,
      modoMonto,
    ],
  );
  const { clear: clearDraft, hasSaved } = useFormAutosave(
    "oc-nueva-v1",
    draftState,
    {
      onRestore: (saved) => {
        if (saved.empresaCodigo) setEmpresaCodigo(saved.empresaCodigo);
        if (saved.numeroOc) setNumeroOc(saved.numeroOc);
        if (saved.proveedorRut) setProveedorRut(saved.proveedorRut);
        if (saved.proveedorNombre) setProveedorNombre(saved.proveedorNombre);
        if (saved.fechaEmision) setFechaEmision(saved.fechaEmision);
        if (saved.moneda) setMoneda(saved.moneda);
        if (saved.validezDias) setValidezDias(saved.validezDias);
        if (saved.formaPago) setFormaPago(saved.formaPago);
        if (saved.plazoPago) setPlazoPago(saved.plazoPago);
        if (saved.plazoEntrega) setPlazoEntrega(saved.plazoEntrega);
        if (saved.observaciones) setObservaciones(saved.observaciones);
        if (saved.items?.length) setItems(saved.items);
        // Los porcentajes se chequean contra null y no por truthiness: un "0"
        // guardado a propósito (exenta, retención cero) tiene que volver.
        // Los drafts viejos no traen estos campos y quedan en su default.
        if (saved.tipoDocumento) setTipoDocumento(saved.tipoDocumento);
        if (saved.ivaPorcentaje != null) setIvaPorcentaje(saved.ivaPorcentaje);
        if (saved.retencionPorcentaje != null) {
          setRetencionPorcentaje(saved.retencionPorcentaje);
        }
        if (saved.modoMonto) setModoMonto(saved.modoMonto);
        toast.info("Restauré tu borrador del último intento.");
      },
    },
  );
  const isDirty =
    numeroOc.trim().length > 0 ||
    proveedorRut.trim().length > 0 ||
    proveedorNombre.trim().length > 0 ||
    observaciones.trim().length > 0 ||
    tipoDocumento !== "FACTURA" ||
    items.some((it) => it.descripcion.trim() || it.precio_unitario);
  useUnsavedChangesWarning(isDirty && !submitting);
  useFormShortcuts({
    "mod+s": (e) => {
      e.preventDefault();
      if (!submitting) {
        const form = document.querySelector(
          "form",
        ) as HTMLFormElement | null;
        form?.requestSubmit();
      }
    },
  });

  // Lookup en vivo del proveedor por RUT (debounced 400ms). Mismo patron
  // que el form Nubox para tener UX consistente entre OCs y vouchers.
  useEffect(() => {
    if (!session) return;
    const trimmed = proveedorRut.trim();
    if (trimmed.length < 4) {
      setProveedorLookup({ status: "idle" });
      return;
    }
    setProveedorId(null);
    setProveedorContactoId("");
    let cancelled = false;
    setProveedorLookup({ status: "searching" });
    const timer = setTimeout(() => {
      apiClient
        .get<ProveedorSearchResult>(
          `/proveedores/search-by-rut?rut=${encodeURIComponent(trimmed)}`,
          session,
        )
        .then((result) => {
          if (cancelled) return;
          if (!result.rut_valid) {
            setProveedorLookup({ status: "invalid" });
            return;
          }
          if (result.exists && result.proveedor) {
            setProveedorLookup({
              status: "existing",
              razonSocial: result.proveedor.razon_social,
              rutCanonical: result.rut_canonical ?? trimmed,
            });
            setProveedorNombre((current) =>
              current.trim() === "" ? result.proveedor!.razon_social : current,
            );
            setProveedorId(result.proveedor.proveedor_id);
          } else {
            setProveedorLookup({
              status: "new",
              rutCanonical: result.rut_canonical ?? trimmed,
            });
          }
        })
        .catch(() => {
          if (!cancelled) setProveedorLookup({ status: "idle" });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [proveedorRut, session]);

  // Encargados del proveedor resuelto — para el selector "Dirigido a".
  const contactosQ = useQuery<ProveedorContacto[]>({
    queryKey: ["proveedor-contactos", proveedorId],
    queryFn: () =>
      apiClient.get<ProveedorContacto[]>(
        `/proveedores/${proveedorId}/contactos`,
        session,
      ),
    enabled: !!session && !!proveedorId,
  });
  const contactos = contactosQ.data ?? [];

  // Preselecciona el contacto principal (es_default) apenas cargan — el
  // operador puede igual elegir otro o dejarlo en blanco.
  useEffect(() => {
    if (!contactos.length || proveedorContactoId) return;
    const principal = contactos.find((c) => c.es_default);
    if (principal) setProveedorContactoId(String(principal.contacto_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactos]);

  const empresaItems = useMemo<ComboboxItem[]>(
    () =>
      empresas.map((e) => ({
        value: e.codigo,
        label: `${e.codigo} — ${e.razon_social}`,
      })),
    [empresas],
  );

  const addItem = () =>
    setItems([
      ...items,
      { descripcion: "", unidad: "", precio_unitario: "", cantidad: "1" },
    ]);
  const removeItem = (idx: number) =>
    setItems(items.length > 1 ? items.filter((_, i) => i !== idx) : items);
  const updateItem = (idx: number, patch: Partial<ItemForm>) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  /**
   * Pegar una planilla completa desde Excel.
   *
   * Se engancha en el campo de descripcion: es donde el operador hace clic
   * primero y desde donde va a pegar. Si lo pegado NO tiene tabs ni varias
   * filas, `parsearItemsPegados` devuelve lista vacia y se deja pasar el
   * pegado normal del navegador — pegar una palabra suelta dentro del campo
   * tiene que seguir funcionando como siempre.
   *
   * Las filas pegadas REEMPLAZAN desde la fila donde se pego hacia abajo, en
   * vez de agregarse al final: si el operador esta parado en la fila 1 vacia
   * y pega 8 items, quiere 8 items, no 1 vacio + 8.
   */
  const pegarItems = (idx: number, e: React.ClipboardEvent) => {
    const texto = e.clipboardData.getData("text/plain");
    const pegados = parsearItemsPegados(texto);
    if (pegados.length === 0) return; // pegado comun: que lo maneje el browser
    e.preventDefault();

    const nuevos = [...items];
    pegados.forEach((pg, i) => {
      const destino = idx + i;
      const previo = nuevos[destino] ?? {
        descripcion: "",
        unidad: "",
        precio_unitario: "",
        cantidad: "1",
      };
      nuevos[destino] = {
        descripcion: pg.descripcion || previo.descripcion,
        // Las columnas que la planilla no traiga NO pisan lo que ya habia
        // cargado a mano: pegar 2 columnas sobre una fila con precio no
        // puede borrar el precio.
        unidad: pg.unidad || previo.unidad,
        precio_unitario: pg.precio_unitario || previo.precio_unitario,
        cantidad: pg.cantidad || previo.cantidad,
      };
    });
    setItems(nuevos);
    toast.success(
      pegados.length === 1
        ? "Se pegó 1 ítem"
        : `Se pegaron ${pegados.length} ítems`,
    );
  };

  /**
   * Trae el proximo numero sugerido para la empresa elegida.
   *
   * Es una SUGERENCIA: el campo queda editable (Nicolas pidio "las dos
   * formas"). Nunca pisa un numero que la persona ya escribio, salvo que
   * apriete el boton a proposito (`forzar`).
   */
  const sugerirNumero = useCallback(
    async (codigo: string, forzar: boolean) => {
      if (!codigo) return;
      if (!forzar && numeroOc.trim()) return;
      setSugiriendoNumero(true);
      try {
        const r = await apiClient.get<{
          numero: string;
          motivo: string;
          base: string | null;
        }>(
          `/ordenes-compra/siguiente-numero?empresa_codigo=${encodeURIComponent(codigo)}`,
          session,
        );
        setNumeroOc(r.numero);
        setMotivoNumero(r.motivo);
      } catch {
        // Que falle la sugerencia no puede frenar la carga de una OC: el
        // campo queda como estaba y la persona escribe el numero.
        setMotivoNumero(null);
      } finally {
        setSugiriendoNumero(false);
      }
    },
    [numeroOc, session],
  );

  // Al elegir empresa se propone el numero que sigue. `forzar=false`: si la
  // persona ya escribio uno, no se lo pisa.
  useEffect(() => {
    if (empresaCodigo) void sugerirNumero(empresaCodigo, false);
    // `sugerirNumero` depende de `numeroOc`, que cambia con cada tecla: si
    // entrara en las dependencias, esto se dispararia mientras se escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaCodigo]);

  const esHonorarios = tipoDocumento === "HONORARIOS";
  const esExenta = tipoDocumento === "FACTURA_EXENTA";
  const grossUp = esHonorarios && modoMonto === "LIQUIDO";
  const ivaPct = toNum(ivaPorcentaje);
  // Campo vacío ≠ 0%: si el operador lo borra mandamos null y el servidor
  // resuelve la tasa vigente contra core.tax_config por la fecha de emisión
  // (invariante 10). Para el preview usamos la misma escala legal.
  const retencionVacia = esHonorarios && retencionPorcentaje.trim() === "";
  const retPct = retencionVacia
    ? toNum(retencionSugerida(fechaEmision))
    : toNum(retencionPorcentaje);

  /**
   * Las líneas TAL COMO se van a guardar. En modo LÍQUIDO los precios cargados
   * son el líquido pactado y hay que convertirlos a bruto antes de mandarlos:
   * el backend deriva `neto` (y de ahí la retención) de los ítems, así que el
   * bruto tiene que estar en las líneas, no en un campo aparte.
   *
   * El residuo del redondeo lo absorbe el último ítem para que Σ(línea) dé el
   * bruto exacto — misma disciplina que `_derivar_montos` en las cuotas.
   */
  const lineasAGuardar = useMemo(() => {
    // Cantidad vacía/inválida cuenta como 1, igual que el payload histórico.
    const cantidadDe = (v: string) => {
      const n = toNum(v, 1);
      return n > 0 ? n : 1;
    };
    const lineas = items.map((it) => ({
      precio: toNum(it.precio_unitario),
      cantidad: cantidadDe(it.cantidad),
    }));
    if (!grossUp) return lineas;
    const liquido = lineas.reduce((acc, l) => acc + l.precio * l.cantidad, 0);
    if (liquido <= 0) return lineas;
    const objetivo = brutoDesdeLiquido(liquido, retPct);
    const factor = objetivo / liquido;
    const escaladas = lineas.map((l) => ({
      ...l,
      // precio_unitario es NUMERIC(18,2) en BD: 2 decimales, no más.
      precio: Math.round(l.precio * factor * 100) / 100,
    }));
    const sumaPrevias = escaladas
      .slice(0, -1)
      .reduce((acc, l) => acc + l.precio * l.cantidad, 0);
    const ultima = escaladas[escaladas.length - 1];
    if (ultima) {
      ultima.precio =
        Math.round(((objetivo - sumaPrevias) / ultima.cantidad) * 100) / 100;
    }
    return escaladas;
  }, [items, grossUp, retPct]);

  // B del contrato = Σ(precio × cantidad) de lo que efectivamente se manda.
  const baseImponible = lineasAGuardar.reduce(
    (acc, l) => acc + l.precio * l.cantidad,
    0,
  );
  const totales = derivarTotales({
    base: baseImponible,
    tipo: tipoDocumento,
    ivaPct,
    retencionPct: retPct,
    moneda,
  });
  // Lo que el operador tipeó cuando dijo "esto es el líquido". Sirve para
  // mostrarle si el redondeo del gross-up lo movió un peso.
  const liquidoPactado = items.reduce((acc, it) => {
    const cant = toNum(it.cantidad, 1);
    return acc + toNum(it.precio_unitario) * (cant > 0 ? cant : 1);
  }, 0);

  const fmtMonto = (v: number) =>
    moneda === "CLP"
      ? toCLP(v)
      : `${moneda} ${v.toLocaleString("es-CL", { maximumFractionDigits: 2 })}`;
  const fmtPct = (v: number) =>
    `${v.toLocaleString("es-CL", { maximumFractionDigits: 2 })}%`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!empresaCodigo || !numeroOc || items.length === 0) {
      setError("Completa los campos obligatorios y al menos un ítem.");
      return;
    }
    if (proveedorRut.trim() && proveedorLookup.status === "invalid") {
      setError("El RUT del proveedor es inválido (dígito verificador).");
      return;
    }
    if (
      proveedorRut.trim() &&
      proveedorLookup.status === "new" &&
      !proveedorNombre.trim()
    ) {
      setError("Ingresa la razón social del proveedor para crearlo.");
      return;
    }
    if (items.some((it) => !it.descripcion || !it.precio_unitario)) {
      setError("Cada ítem requiere descripción y precio unitario.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        empresa_codigo: empresaCodigo,
        numero_oc: numeroOc,
        fecha_emision: fechaEmision,
        moneda,
        validez_dias: Number(validezDias) || 30,
        forma_pago: formaPago || null,
        plazo_pago: plazoPago || null,
        // Booleano puro: `|| true` convertiria un false explicito en true y
        // la casilla no haria nada.
        incluye_condiciones: incluyeCondiciones,
        plazo_entrega: plazoEntrega || null,
        observaciones: observaciones || null,
        tipo_documento: tipoDocumento,
        // Exenta y honorarios NO llevan IVA (el servidor igual lo pisa a 0;
        // mandarlo coherente evita chocar con el CHECK de la BD). Y una OC
        // afecta nunca lleva retención.
        iva_porcentaje: esAfecto(tipoDocumento) ? ivaPct : 0,
        retencion_porcentaje: esHonorarios
          ? retencionVacia
            ? null // el servidor resuelve la vigente por fecha_emision
            : retPct
          : 0,
        // En modo LÍQUIDO los precios ya vienen grosseados: lo que se guarda
        // como ítem es el BRUTO, que es lo que la boleta de honorarios dice.
        items: items.map((it, i) => {
          const linea = lineasAGuardar[i];
          return {
            item: i + 1,
            descripcion: it.descripcion,
            // Unidad de medida (Un, Gl, Días, m3…). Si el operador no la
            // completa mandamos null y el PDF imprime "—".
            unidad: it.unidad?.trim() ? it.unidad.trim() : null,
            precio_unitario: linea?.precio ?? toNum(it.precio_unitario),
            cantidad: linea?.cantidad ?? toNum(it.cantidad, 1),
          };
        }),
      };
      // Adjuntar proveedor: si existe, mandamos id resuelto del lookup;
      // si es nuevo, RUT+nombre para que el backend lo cree.
      if (proveedorRut.trim()) {
        if (
          proveedorLookup.status === "existing" &&
          proveedorLookup.rutCanonical
        ) {
          payload.proveedor_rut = proveedorLookup.rutCanonical;
          payload.proveedor_nombre = proveedorNombre.trim();
        } else if (
          proveedorLookup.status === "new" &&
          proveedorLookup.rutCanonical
        ) {
          payload.proveedor_rut = proveedorLookup.rutCanonical;
          payload.proveedor_nombre = proveedorNombre.trim();
        }
      }
      // "Dirigido a" — si se eligió un encargado del catálogo, el backend
      // resuelve nombre/cargo desde ahí (manda el id). Si no, se manda lo
      // que se haya tipeado suelto.
      if (proveedorContactoId) {
        payload.proveedor_contacto_id = Number(proveedorContactoId);
      } else if (atteNombreManual.trim()) {
        payload.atte_nombre = atteNombreManual.trim();
        payload.atte_cargo = atteCargoManual.trim() || null;
      }
      // Disciplina 2: el `neto` lo recomputa el backend a partir de los
      // items (compute_totals en OrdenCompraCreate). NO lo mandamos desde
      // el FE — antes lo hacíamos para satisfacer una validación gt=0 que
      // ya removimos del schema (V5++ ola CG, cleanup post-audit).
      const created = await apiClient.post<OcRead>(
        "/ordenes-compra",
        payload,
        session,
      );
      clearDraft();
      // Round 5 — invalidar cache para que la lista refresque al volver.
      queryClient.invalidateQueries({ queryKey: ["ordenes-compra"] });
      queryClient.invalidateQueries({ queryKey: ["oc-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["sidebar-state"] });
      router.push(`/ordenes-compra/${created.oc_id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error desconocido",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/ordenes-compra"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        Volver a OCs
      </Link>

      <header>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            Nueva OC
          </h1>
          {hasSaved && isDirty && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cehta-green/10 px-2.5 py-0.5 text-xs text-cehta-green">
              <Cloud className="h-3 w-3" />
              Borrador guardado
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-ink-500">
          Tipeá el RUT del proveedor y vamos a precargar/crearlo solos. Los
          totales los calcula el backend según el tipo de documento; abajo de
          los ítems vas a ver el resumen antes de guardar.
          <span className="ml-2 hidden text-xs text-ink-400 sm:inline">
            · <kbd className="rounded bg-ink-100 px-1.5 py-0.5 font-mono">⌘S</kbd> guardar
          </span>
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <Surface className="bg-negative/5 ring-negative/20">
            <p className="text-sm text-negative">{error}</p>
          </Surface>
        )}

        <Surface>
          <Surface.Header divider>
            <Surface.Title>Cabecera</Surface.Title>
          </Surface.Header>
          <Surface.Body>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelBase} htmlFor="empresa">
                  Empresa {requiredMark}
                </label>
                {empresaItems.length > 0 ? (
                  <Combobox
                    items={empresaItems}
                    value={empresaCodigo}
                    onValueChange={setEmpresaCodigo}
                    placeholder="Selecciona empresa…"
                    triggerClassName="w-full h-[38px]"
                  />
                ) : (
                  <input
                    id="empresa"
                    type="text"
                    value={empresaCodigo}
                    onChange={(e) =>
                      setEmpresaCodigo(e.target.value.toUpperCase())
                    }
                    placeholder="TRONGKAI"
                    required
                    className={inputBase}
                  />
                )}
              </div>
              <div>
                <label className={labelBase} htmlFor="numero-oc">
                  Número OC {requiredMark}
                </label>
                {/* Automático Y escribible, las dos formas: el correlativo se
                    sugiere solo al elegir empresa, pero el campo queda
                    editable. Ninguna empresa numera igual que otra, así que
                    la sugerencia sale de aprender el formato que esa empresa
                    ya usa — la deducción vive en el backend. */}
                <div className="flex gap-2">
                  <input
                    id="numero-oc"
                    type="text"
                    value={numeroOc}
                    onChange={(e) => {
                      setNumeroOc(e.target.value);
                      // Si lo edita a mano, el motivo de la sugerencia deja
                      // de describir lo que hay en el campo.
                      setMotivoNumero(null);
                    }}
                    placeholder="OC-2026-001"
                    required
                    className={`${inputBase} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={() => sugerirNumero(empresaCodigo, true)}
                    disabled={!empresaCodigo || sugiriendoNumero}
                    title={
                      empresaCodigo
                        ? "Proponer el número que sigue"
                        : "Elegí primero la empresa"
                    }
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 text-sm font-medium text-ink-700 transition-colors hover:border-cehta-green/40 hover:text-cehta-green disabled:opacity-40"
                  >
                    <Wand2 className="h-4 w-4" strokeWidth={1.75} />
                    {sugiriendoNumero ? "…" : "Sugerir"}
                  </button>
                </div>
                {motivoNumero && (
                  <p className="mt-1.5 text-xs text-ink-500">{motivoNumero}</p>
                )}
              </div>
              <div>
                <label className={labelBase} htmlFor="proveedor-rut">
                  Proveedor RUT
                </label>
                <input
                  id="proveedor-rut"
                  type="text"
                  value={proveedorRut}
                  onChange={(e) => setProveedorRut(e.target.value)}
                  placeholder="76.123.456-7"
                  className={inputBase}
                  aria-describedby="proveedor-rut-status"
                />
                <div
                  id="proveedor-rut-status"
                  className="mt-1 min-h-[1rem] text-xs"
                >
                  {proveedorLookup.status === "searching" && (
                    <span className="text-ink-500">Buscando proveedor…</span>
                  )}
                  {proveedorLookup.status === "invalid" && (
                    <span className="text-negative">
                      RUT inválido — revisa el dígito verificador.
                    </span>
                  )}
                  {proveedorLookup.status === "existing" && (
                    <span className="text-cehta-green">
                      ✓ Existente:{" "}
                      <span className="font-medium">
                        {proveedorLookup.razonSocial}
                      </span>
                    </span>
                  )}
                  {proveedorLookup.status === "new" && (
                    <span className="text-warning">
                      Nuevo — se creará en el catálogo al guardar.
                    </span>
                  )}
                </div>
              </div>
              <div>
                <label className={labelBase} htmlFor="proveedor-nombre">
                  Proveedor razón social
                  <span className="ml-1 text-[10px] font-normal text-ink-400">
                    · busca en el catálogo
                  </span>
                </label>
                {/* Round 61 — typeahead client-side con cache de 228 proveedores.
                    Al seleccionar, autocompleta RUT + razón social. */}
                <ProveedorTypeaheadCached
                  value={proveedorNombre}
                  rutValue={proveedorRut}
                  onSelect={(hit) => {
                    setProveedorNombre(hit.razon_social);
                    if (hit.rut) setProveedorRut(hit.rut);
                    setProveedorId(hit.proveedor_id);
                    setProveedorContactoId("");
                  }}
                  onClear={() => {
                    setProveedorNombre("");
                    // No tocamos proveedorRut aquí — el operador puede
                    // estar editando solo el nombre y mantener el RUT.
                    setProveedorId(null);
                    setProveedorContactoId("");
                  }}
                  // R152xxx — MEJORAS IA #4b: si el proveedor no existe,
                  // el dropdown ofrece "+ Crear: {query}" que llama
                  // POST /proveedores/quick-create con datos mínimos.
                  onCreate={async (query) => {
                    try {
                      const created = await apiClient.post<{
                        proveedor_id: number;
                        razon_social: string;
                        rut: string | null;
                      }>(
                        "/proveedores/quick-create",
                        { razon_social: query, rut: proveedorRut || null },
                        session,
                      );
                      setProveedorNombre(created.razon_social);
                      if (created.rut) setProveedorRut(created.rut);
                      setProveedorId(created.proveedor_id);
                      toast.success(
                        `Proveedor "${created.razon_social}" creado. Completa los datos en /admin/proveedores cuando puedas.`,
                        { duration: 8000 },
                      );
                      // Invalidar cache para que en próximos typeaheads aparezca.
                      queryClient.invalidateQueries({ queryKey: ["proveedores-cache"] });
                    } catch (e) {
                      const msg = e instanceof ApiError ? e.detail : "Error creando";
                      toast.error(`No se pudo crear proveedor: ${msg}`);
                    }
                  }}
                  inputClassName={inputBase}
                  idPrefix="oc-prov"
                  placeholder="Buscar por nombre o RUT…"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelBase} htmlFor="dirigido-a">
                  Dirigido a
                  <span className="ml-1 text-[10px] font-normal text-ink-400">
                    · "Atte. Señor/a" en el PDF
                  </span>
                </label>
                {contactos.length > 0 && (
                  <select
                    id="dirigido-a"
                    value={proveedorContactoId}
                    onChange={(e) => setProveedorContactoId(e.target.value)}
                    className={`${inputBase} mb-2`}
                  >
                    <option value="">— Sin encargado del catálogo —</option>
                    {contactos.map((c) => (
                      <option key={c.contacto_id} value={c.contacto_id}>
                        {c.nombre}
                        {c.cargo ? ` — ${c.cargo}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                {!proveedorContactoId && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      value={atteNombreManual}
                      onChange={(e) => setAtteNombreManual(e.target.value)}
                      placeholder="Nombre del encargado (opcional)"
                      className={inputBase}
                    />
                    <input
                      type="text"
                      value={atteCargoManual}
                      onChange={(e) => setAtteCargoManual(e.target.value)}
                      placeholder="Cargo (opcional)"
                      className={inputBase}
                    />
                  </div>
                )}
                {proveedorId && (
                  <p className="mt-1 text-xs text-ink-400">
                    Los encargados se administran en{" "}
                    <Link
                      href={`/proveedores/${proveedorId}`}
                      target="_blank"
                      className="underline hover:text-ink-700"
                    >
                      la ficha del proveedor
                    </Link>
                    .
                  </p>
                )}
              </div>
              <div>
                <label className={labelBase} htmlFor="fecha-emision">
                  Fecha emisión
                </label>
                <input
                  id="fecha-emision"
                  type="date"
                  value={fechaEmision}
                  onChange={(e) => setFechaEmision(e.target.value)}
                  className={`${inputBase} tabular-nums`}
                />
              </div>
              <div>
                <label className={labelBase}>Moneda</label>
                <Combobox
                  items={MONEDAS}
                  value={moneda}
                  onValueChange={setMoneda}
                  placeholder="Moneda"
                  triggerClassName="w-full h-[38px]"
                />
              </div>
              <div>
                <label className={labelBase} htmlFor="validez">
                  Validez (días)
                </label>
                <input
                  id="validez"
                  type="number"
                  value={validezDias}
                  onChange={(e) => setValidezDias(e.target.value)}
                  min="1"
                  className={`${inputBase} tabular-nums`}
                />
              </div>
              <div>
                <label className={labelBase} htmlFor="forma-pago">
                  Forma de pago
                </label>
                <input
                  id="forma-pago"
                  type="text"
                  value={formaPago}
                  onChange={(e) => setFormaPago(e.target.value)}
                  placeholder="Transferencia"
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase} htmlFor="plazo-pago">
                  Plazo de pago
                </label>
                <input
                  id="plazo-pago"
                  type="text"
                  value={plazoPago}
                  onChange={(e) => setPlazoPago(e.target.value)}
                  placeholder="30 días"
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase} htmlFor="plazo-entrega">
                  Plazo de entrega
                </label>
                <input
                  id="plazo-entrega"
                  type="text"
                  value={plazoEntrega}
                  onChange={(e) => setPlazoEntrega(e.target.value)}
                  placeholder="Entrega inmediata / No aplica"
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Tipo de documento</label>
                <Combobox
                  items={TIPOS_DOCUMENTO}
                  value={tipoDocumento}
                  onValueChange={(v) => {
                    setTipoDocumento(v);
                    // Ayuda, no fuerza: boleta no da crédito fiscal, así que
                    // sugerimos 0% si el operador no tocó el default 19.
                    // Si vuelve a factura y seguía en 0, sugerimos 19 de nuevo.
                    if (v === "BOLETA" && ivaPorcentaje === "19") {
                      setIvaPorcentaje("0");
                    } else if (v === "FACTURA" && ivaPorcentaje === "0") {
                      setIvaPorcentaje("19");
                    }
                    if (v === "HONORARIOS") {
                      // Precarga la tasa del año de emisión de la OC. El campo
                      // queda editable y el servidor confirma contra tax_config.
                      setRetencionPorcentaje(retencionSugerida(fechaEmision));
                    } else {
                      // El gross-up sólo tiene sentido con retención.
                      setModoMonto("BRUTO");
                    }
                  }}
                  placeholder="Tipo de documento"
                  triggerClassName="w-full h-[38px]"
                />
                {esExenta && (
                  <p className="mt-1 text-xs text-ink-400">
                    Operación exenta (Art. 12 D.L. 825): no lleva IVA ni da
                    crédito fiscal. No es lo mismo que una factura al 0%.
                  </p>
                )}
                {esHonorarios && (
                  <p className="mt-1 text-xs text-ink-400">
                    El profesional emite su boleta por el bruto; la empresa
                    retiene y entera al SII.
                  </p>
                )}
              </div>
              {/* IVA% sólo en afectas y retención% sólo en honorarios: mostrar
                  los dos siempre es cómo se cargan mal los datos. */}
              {esAfecto(tipoDocumento) && (
                <div>
                  <label className={labelBase} htmlFor="iva-porcentaje">
                    IVA %
                    <span className="ml-1 text-[10px] font-normal text-ink-400">
                      · editable — no toda compra es 19%
                    </span>
                  </label>
                  <input
                    id="iva-porcentaje"
                    type="number"
                    value={ivaPorcentaje}
                    onChange={(e) => setIvaPorcentaje(e.target.value)}
                    min="0"
                    max="100"
                    step="0.01"
                    className={`${inputBase} tabular-nums`}
                  />
                </div>
              )}
              {esHonorarios && (
                <div>
                  <label className={labelBase} htmlFor="retencion-porcentaje">
                    Retención %
                    <span className="ml-1 text-[10px] font-normal text-ink-400">
                      · Art. 74 N°2 LIR
                    </span>
                  </label>
                  <input
                    id="retencion-porcentaje"
                    type="number"
                    value={retencionPorcentaje}
                    onChange={(e) => setRetencionPorcentaje(e.target.value)}
                    min="0"
                    max="100"
                    step="0.01"
                    className={`${inputBase} tabular-nums`}
                  />
                  {retencionPorcentaje !== retencionSugerida(fechaEmision) && (
                    <button
                      type="button"
                      onClick={() =>
                        setRetencionPorcentaje(retencionSugerida(fechaEmision))
                      }
                      className="mt-1 text-xs text-cehta-green underline underline-offset-2"
                    >
                      Usar {retencionSugerida(fechaEmision)}% (vigente para{" "}
                      {fechaEmision.slice(0, 4)})
                    </button>
                  )}
                </div>
              )}
              <div className="sm:col-span-2">
                <label className={labelBase} htmlFor="observaciones">
                  Observaciones
                </label>
                <textarea
                  id="observaciones"
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  rows={3}
                  className={inputBase}
                />
              </div>

              {/* Condiciones generales — las 4 cláusulas de arbitraje ante el
                  Centro de Arbitraje y Mediación de Santiago que van al pie
                  del PDF. Marcada por defecto: es una cláusula contractual,
                  sacarla tiene que ser una decisión, no un olvido. */}
              <div className="sm:col-span-2">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={incluyeCondiciones}
                    onChange={(e) => setIncluyeCondiciones(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-300 text-cehta-green focus:ring-cehta-green"
                  />
                  <span>
                    <span className="text-sm font-medium text-ink-900">
                      Incluir condiciones generales en el PDF
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-500">
                      Las 4 cláusulas de arbitraje del Centro de Arbitraje y
                      Mediación de Santiago.{" "}
                      {incluyeCondiciones
                        ? "Se imprimen al final del documento."
                        : "Esta OC va a salir SIN cláusula de arbitraje."}
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </Surface.Body>
        </Surface>

        <Surface>
          <Surface.Header divider>
            <div className="flex items-center justify-between">
              <Surface.Title>Ítems</Surface.Title>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-cehta-green transition-colors hover:bg-cehta-green/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                Agregar ítem
              </button>
            </div>
          </Surface.Header>
          <Surface.Body>
            <div className="space-y-3">
              {items.map((it, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 items-start gap-3 border-t border-hairline pt-3 first:border-0 first:pt-0"
                >
                  <div className="col-span-12 sm:col-span-4">
                    <label className="sr-only" htmlFor={`item-desc-${idx}`}>
                      Descripción
                    </label>
                    {/* Textarea y no input: las descripciones de OC son
                        largas ("Desarrollo, revisión y actualización de
                        procedimientos de trabajo seguro y documentación
                        preventiva - PMGD Panimávida") y en una sola línea el
                        operador escribe a ciegas. Crece con el texto.

                        `onPaste` recibe una selección de Excel y la reparte
                        en filas. Si lo pegado no es una planilla, el handler
                        se hace a un lado y pega normal. */}
                    <TextareaAutosize
                      id={`item-desc-${idx}`}
                      value={it.descripcion}
                      onChange={(e) =>
                        updateItem(idx, { descripcion: e.target.value })
                      }
                      onPaste={(e) => pegarItems(idx, e)}
                      placeholder="Descripción — o pegá desde Excel"
                      required
                      minRows={1}
                      maxRows={10}
                      className={inputBase}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-3">
                    <label className="sr-only" htmlFor={`item-price-${idx}`}>
                      Precio unitario
                    </label>
                    {/* `step="any"` y no `0.01`: con un step fijo el
                        navegador marca como inválido un precio con más
                        decimales y empuja a mostrar ceros que nadie
                        escribió. Nicolás: "si no tienen decimales que se vea
                        sólo el número". Lo mismo en Cantidad. */}
                    <input
                      id={`item-price-${idx}`}
                      type="number"
                      value={it.precio_unitario}
                      onChange={(e) =>
                        updateItem(idx, { precio_unitario: e.target.value })
                      }
                      placeholder="P. Unit."
                      step="any"
                      min="0"
                      required
                      className={`${inputBase} tabular-nums`}
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-2">
                    <label className="sr-only" htmlFor={`item-qty-${idx}`}>
                      Cantidad
                    </label>
                    <input
                      id={`item-qty-${idx}`}
                      type="number"
                      value={it.cantidad}
                      onChange={(e) =>
                        updateItem(idx, { cantidad: e.target.value })
                      }
                      placeholder="Cant."
                      step="any"
                      min="0"
                      className={`${inputBase} tabular-nums`}
                    />
                  </div>
                  {/* Unidad al lado de la cantidad: "3 Días", "50 m3".
                      Input libre con sugerencias — el operador puede tipear
                      una unidad que no esté en la lista y se guarda igual. */}
                  <div className="col-span-3 sm:col-span-2">
                    <label className="sr-only" htmlFor={`item-unidad-${idx}`}>
                      Unidad
                    </label>
                    <input
                      id={`item-unidad-${idx}`}
                      type="text"
                      list="oc-unidades-sugeridas"
                      value={it.unidad ?? ""}
                      onChange={(e) =>
                        updateItem(idx, { unidad: e.target.value })
                      }
                      placeholder="Unidad"
                      maxLength={20}
                      autoComplete="off"
                      title="Unidad de medida: Un, Gl, Días, m3, Kg, Hrs… (opcional)"
                      className={inputBase}
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex">
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      disabled={items.length === 1}
                      aria-label="Eliminar ítem"
                      className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-negative/10 text-negative ring-1 ring-negative/20 transition-colors hover:bg-negative/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative disabled:opacity-40 disabled:hover:bg-negative/10"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {/* Un solo datalist compartido por todas las filas: los <input
                list="..."> de cada ítem apuntan acá. */}
            <datalist id="oc-unidades-sugeridas">
              {UNIDADES_SUGERIDAS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            <p className="mt-4 text-xs text-ink-400">
              La <span className="font-medium text-ink-500">unidad</span> es
              opcional y sale impresa en la columna “Un.” de la orden de
              compra. Podés elegir una de la lista (Un, Gl, Días, m3, Kg, Hrs…)
              o escribir la que uses. El total lo calcula el sistema.
            </p>

            {/* Resumen en vivo antes de guardar. Acá es donde el operador se
                da cuenta de que pactó un líquido y lo estaba cargando como
                bruto — que es el error caro de las boletas de honorarios. */}
            <div className="mt-5 border-t border-hairline pt-4">
              {esHonorarios && (
                <div className="mb-4 rounded-xl bg-ink-100/40 p-3 ring-1 ring-hairline">
                  <p className="text-xs font-medium text-ink-700">
                    Lo que cargué en los ítems es…
                  </p>
                  <div className="mt-2 inline-flex rounded-xl bg-white p-0.5 ring-1 ring-hairline">
                    {(
                      [
                        ["BRUTO", "Bruto (antes de retención)"],
                        ["LIQUIDO", "Líquido (lo que recibe)"],
                      ] as const
                    ).map(([valor, etiqueta]) => (
                      <button
                        key={valor}
                        type="button"
                        onClick={() => setModoMonto(valor)}
                        aria-pressed={modoMonto === valor}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          modoMonto === valor
                            ? "bg-cehta-green text-white shadow-card"
                            : "text-ink-700 hover:bg-ink-100/60"
                        }`}
                      >
                        {etiqueta}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-ink-500">
                    {modoMonto === "BRUTO"
                      ? "Se retiene sobre ese monto: el profesional recibe menos de lo que cargaste."
                      : "Lo convertimos a bruto al guardar. El bruto es lo que va en la OC y en la boleta de honorarios; el líquido es lo que se transfiere."}
                  </p>
                </div>
              )}

              {baseImponible <= 0 ? (
                <p className="text-xs text-ink-400">
                  Cargá los precios de los ítems para ver los totales.
                </p>
              ) : (
                <dl className="ml-auto w-full max-w-sm space-y-1.5">
                  {grossUp && (
                    <TotalRow
                      label="Líquido pactado (lo cargado)"
                      valor={fmtMonto(liquidoPactado)}
                    />
                  )}
                  <TotalRow
                    label={
                      esHonorarios
                        ? "Honorarios brutos"
                        : esExenta
                          ? "Neto exento"
                          : "Neto"
                    }
                    valor={fmtMonto(totales.neto)}
                  />
                  {esAfecto(tipoDocumento) && (
                    <TotalRow
                      label={`IVA ${fmtPct(ivaPct)}`}
                      valor={fmtMonto(totales.iva)}
                    />
                  )}
                  {esHonorarios && (
                    <TotalRow
                      label={`Retención ${fmtPct(retPct)}`}
                      valor={fmtMonto(totales.retencion)}
                      negativo
                    />
                  )}
                  <TotalRow
                    label={esHonorarios ? "Líquido a pagar" : "Total"}
                    valor={fmtMonto(totales.totalAPagar)}
                    destacado
                  />
                </dl>
              )}

              {baseImponible > 0 && (
                <div className="mt-3 space-y-1 text-xs text-ink-400">
                  {esHonorarios && retencionVacia && (
                    <p>
                      Dejaste la tasa vacía: se aplica la vigente a la fecha de
                      emisión ({fmtPct(retPct)}), que resuelve el servidor.
                    </p>
                  )}
                  {esHonorarios && !retencionVacia && retPct <= 0 && (
                    <p className="text-warning">
                      La retención está en 0%: esta OC no va a retener nada.
                      Verificá que sea a propósito.
                    </p>
                  )}
                  {grossUp &&
                    totales.totalAPagar !== Math.round(liquidoPactado) && (
                      <p>
                        El redondeo a peso deja el líquido en{" "}
                        {fmtMonto(totales.totalAPagar)} en vez de{" "}
                        {fmtMonto(liquidoPactado)}. Se redondea la retención y
                        el líquido sale por resta, para que retención + líquido
                        dé exacto el bruto.
                      </p>
                    )}
                  {esHonorarios && (
                    <p>
                      Se guarda el bruto ({fmtMonto(totales.neto)}). La
                      retención la entera la empresa al SII por cuenta del
                      profesional.
                    </p>
                  )}
                  {esAfecto(tipoDocumento) && moneda !== "CLP" && (
                    <p>
                      En {moneda} el backend no calcula IVA: el total va sin
                      IVA.
                    </p>
                  )}
                </div>
              )}
            </div>
          </Surface.Body>
        </Surface>

        <div className="flex justify-end gap-3 border-t border-hairline pt-5">
          <Link
            href="/ordenes-compra"
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {submitting ? "Creando…" : "Crear OC"}
          </button>
        </div>
      </form>
    </div>
  );
}
