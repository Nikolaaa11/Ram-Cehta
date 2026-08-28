"use client";

/**
 * OcEditForm — edición parcial de OC: sólo campos no-críticos.
 *
 * NO permite tocar items, neto, iva, total, numero_oc, estado, empresa o
 * proveedor (son inmutables o tienen flujos dedicados). Si la OC está
 * pagada/anulada, el form se bloquea con un banner.
 *
 * PATCH a `/ordenes-compra/{id}` con sólo los campos modificados.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Surface } from "@/components/ui/surface";
import {
  ItemizadoEditor,
  type ItemEditable,
} from "@/components/ordenes-compra/ItemizadoEditor";
import { TotalesPreview } from "@/components/ordenes-compra/TotalesPreview";
import { limpiarCeros } from "@/lib/oc/pegar-items";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { apiClient, ApiError } from "@/lib/api/client";
import { toCLP } from "@/lib/format";
import { useSession } from "@/hooks/use-session";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useFormShortcuts } from "@/hooks/use-form-shortcuts";
import type { OcRead } from "@/lib/api/schema";
import type { ProveedorContacto } from "@/components/proveedores/ProveedorContactosPanel";

interface Props {
  initialData: OcRead;
}

interface FormState {
  observaciones: string;
  forma_pago: string;
  plazo_pago: string;
  validez_dias: string;
  pdf_url: string;
  tipo_documento: string;
  iva_porcentaje: string;
  retencion_porcentaje: string;
  proveedor_contacto_id: string;
  atte_nombre: string;
  atte_cargo: string;
  //: Si el PDF imprime las 4 clausulas de arbitraje. Boolean y no string,
  //: a diferencia del resto: no hay estado intermedio que representar.
  incluye_condiciones: boolean;
}

// Mismos 4 tokens que el form de alta: el `value` es el del catálogo SII que
// viaja a la BD, la etiqueta en castellano es sólo presentación.
const TIPOS_DOCUMENTO: ComboboxItem[] = [
  { value: "FACTURA", label: "Factura", group: "Afectas a IVA" },
  { value: "BOLETA", label: "Boleta", group: "Afectas a IVA" },
  { value: "FACTURA_EXENTA", label: "Factura exenta", group: "Sin IVA" },
  { value: "HONORARIOS", label: "Boleta de honorarios", group: "Sin IVA" },
];

const esAfecto = (tipo: string) => tipo === "FACTURA" || tipo === "BOLETA";

/** Ver el gemelo en `ordenes-compra/nueva`: sugerencia de UI, la tasa de
 *  verdad vive en `core.tax_config` y el servidor la confirma. */
function retencionSugerida(fechaEmision: string): string {
  const anio = Number(String(fechaEmision).slice(0, 4));
  if (!Number.isFinite(anio) || anio <= 2024) return "13.75";
  if (anio === 2025) return "14.5";
  if (anio === 2026) return "15.25";
  if (anio === 2027) return "16";
  return "17";
}

/** Nada de `Number(x) || fallback`: un 0 legítimo caería en el fallback. */
const toNum = (v: string, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const inputBase =
  "w-full rounded-lg border-0 ring-1 ring-hairline bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 transition-shadow focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-100/40 disabled:text-ink-500";
const labelBase = "mb-1.5 block text-sm font-medium text-ink-700";

const LOCKED_STATES = new Set(["pagada", "anulada"]);

/**
 * Estados donde el tipo de documento y las tasas quedan congelados aunque el
 * resto del form siga editable: una OC firmada es un documento probatorio y no
 * cambia de tipo ni de tasa nunca (invariante 2). La API ya lo bloquea; acá lo
 * decimos antes de que el operador escriba y se coma un 4xx.
 */
const FISCAL_LOCKED_STATES = new Set([
  "firmada",
  "aprobada",
  "pagada",
  "anulada",
  "rechazada",
  "cerrada",
]);

export function OcEditForm({ initialData }: Props) {
  const router = useRouter();
  const { session } = useSession();
  const queryClient = useQueryClient();

  const locked = LOCKED_STATES.has(initialData.estado.toLowerCase());
  const fiscalLocked =
    locked || FISCAL_LOCKED_STATES.has(initialData.estado.toLowerCase());

  const initial = useMemo<FormState>(
    () => ({
      observaciones: initialData.observaciones ?? "",
      forma_pago: initialData.forma_pago ?? "",
      plazo_pago: initialData.plazo_pago ?? "",
      validez_dias: String(initialData.validez_dias ?? ""),
      pdf_url: initialData.pdf_url ?? "",
      tipo_documento: initialData.tipo_documento ?? "FACTURA",
      iva_porcentaje: String(initialData.iva_porcentaje ?? "19"),
      // `??` y no `||`: una OC con retención 0 guardada a propósito tiene que
      // mostrar 0, no el default.
      retencion_porcentaje: String(initialData.retencion_porcentaje ?? "0"),
      proveedor_contacto_id: initialData.proveedor_contacto_id
        ? String(initialData.proveedor_contacto_id)
        : "",
      atte_nombre: initialData.atte_nombre ?? "",
      atte_cargo: initialData.atte_cargo ?? "",
      // `!== false` y no `?? true`: cubre los dos casos de una vez —campo
      // ausente (API vieja) y null— y solo un false explicito destilda la
      // casilla. Una OC ya emitida tiene que verse tal cual salio.
      incluye_condiciones: initialData.incluye_condiciones !== false,
    }),
    [initialData],
  );

  const [form, setForm] = useState<FormState>(initial);

  // ── Itemizado ────────────────────────────────────────────────────────
  // Hasta ahora esta pantalla NO mostraba los items y no habia endpoint para
  // cambiarlos: cuando la extraccion con IA se equivocaba, la unica salida
  // era borrar la OC y rehacerla a mano. Se editan aparte del resto del
  // formulario porque van por otro endpoint (PUT /items, que recalcula todos
  // los montos server-side) y porque una OC firmada admite cambiar la glosa
  // pero NO el monto.
  const [items, setItems] = useState<ItemEditable[]>(() =>
    (initialData.items ?? []).map((it) => ({
      descripcion: it.descripcion ?? "",
      unidad: it.unidad ?? "",
      // `limpiarCeros`: la API manda NUMERIC, o sea "50.0000". Sin esto el
      // campo arranca lleno de ceros que nadie escribio.
      precio_unitario: limpiarCeros(String(it.precio_unitario ?? "")),
      cantidad: limpiarCeros(String(it.cantidad ?? "")),
    })),
  );
  const [itemsIniciales] = useState<ItemEditable[]>(items);
  const [guardandoItems, setGuardandoItems] = useState(false);
  const itemsCambiaron =
    JSON.stringify(items) !== JSON.stringify(itemsIniciales);

  async function guardarItems() {
    if (guardandoItems) return;
    const limpios = items.filter((i) => i.descripcion.trim());
    if (limpios.length === 0) {
      toast.error("La OC necesita al menos un item con descripcion.");
      return;
    }
    // Cantidad > 0 siempre; el precio puede ser NEGATIVO (linea de
    // descuento) o cero (bonificado) — lo que no puede es no ser un numero.
    // La suma total si tiene que quedar positiva; el backend tambien lo
    // valida (422), aca se corta antes y con el numero de linea.
    const mala = limpios.findIndex(
      (i) =>
        !(Number(i.cantidad) > 0) ||
        !Number.isFinite(Number(i.precio_unitario)) ||
        i.precio_unitario === "",
    );
    if (mala >= 0) {
      toast.error(
        `El item ${mala + 1} necesita cantidad mayor a 0 y un precio ` +
          "unitario numerico (puede ser negativo: es un descuento).",
      );
      return;
    }
    const suma = limpios.reduce(
      (acc, i) => acc + Number(i.precio_unitario) * Number(i.cantidad),
      0,
    );
    if (suma <= 0) {
      toast.error(
        "El total del itemizado quedo en " +
          suma.toLocaleString("es-CL") +
          ": los descuentos superan a los cargos. Ajusta los montos.",
      );
      return;
    }
    setGuardandoItems(true);
    try {
      await apiClient.put<OcRead>(
        `/ordenes-compra/${initialData.oc_id}/items`,
        {
          items: limpios.map((i, idx) => ({
            item: idx + 1,
            descripcion: i.descripcion.trim(),
            unidad: i.unidad.trim() || null,
            precio_unitario: Number(i.precio_unitario),
            cantidad: Number(i.cantidad),
          })),
        },
        session,
      );
      toast.success("Itemizado actualizado. Los montos se recalcularon.");
      await queryClient.invalidateQueries({ queryKey: ["ordenes-compra"] });
      router.refresh();
    } catch (err) {
      const detalle =
        err instanceof ApiError ? err.detail : "No se pudo guardar el itemizado";
      toast.error(detalle);
    } finally {
      setGuardandoItems(false);
    }
  }
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Encargados del proveedor de esta OC — para re-elegir "Dirigido a".
  const contactosQ = useQuery<ProveedorContacto[]>({
    queryKey: ["proveedor-contactos", initialData.proveedor_id],
    queryFn: () =>
      apiClient.get<ProveedorContacto[]>(
        `/proveedores/${initialData.proveedor_id}/contactos`,
        session,
      ),
    enabled: !!session && !!initialData.proveedor_id,
  });
  const contactos = contactosQ.data ?? [];

  // V5++ ola CE — Warning si hay cambios sin guardar. No autosave en edicion
  // (riesgo de pisar valores del servidor con un draft viejo en otra pestaña).
  const hasUnsavedEdits =
    form.observaciones !== initial.observaciones ||
    form.forma_pago !== initial.forma_pago ||
    form.plazo_pago !== initial.plazo_pago ||
    form.validez_dias !== initial.validez_dias ||
    form.pdf_url !== initial.pdf_url ||
    form.incluye_condiciones !== initial.incluye_condiciones ||
    form.tipo_documento !== initial.tipo_documento ||
    form.iva_porcentaje !== initial.iva_porcentaje ||
    form.retencion_porcentaje !== initial.retencion_porcentaje ||
    form.proveedor_contacto_id !== initial.proveedor_contacto_id ||
    form.atte_nombre !== initial.atte_nombre ||
    form.atte_cargo !== initial.atte_cargo;
  useUnsavedChangesWarning(hasUnsavedEdits && !submitting);
  useFormShortcuts({
    "mod+s": (e) => {
      e.preventDefault();
      if (!submitting && hasUnsavedEdits) {
        const el = document.querySelector("form") as HTMLFormElement | null;
        el?.requestSubmit();
      }
    },
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (error) setError(null);
  }

  const dirty = useMemo<Record<string, string | number | boolean | null>>(() => {
    const out: Record<string, string | number | boolean | null> = {};
    // Booleano: se manda tal cual, sin el "" -> null del resto. Un false
    // explicito ES el dato ("sacale las condiciones"), no un campo vacio.
    if (form.incluye_condiciones !== initial.incluye_condiciones) {
      out.incluye_condiciones = form.incluye_condiciones;
    }
    if (form.observaciones !== initial.observaciones) {
      out.observaciones = form.observaciones === "" ? null : form.observaciones;
    }
    if (form.forma_pago !== initial.forma_pago) {
      out.forma_pago = form.forma_pago === "" ? null : form.forma_pago;
    }
    if (form.plazo_pago !== initial.plazo_pago) {
      out.plazo_pago = form.plazo_pago === "" ? null : form.plazo_pago;
    }
    if (form.validez_dias !== initial.validez_dias) {
      const n = Number(form.validez_dias);
      if (!Number.isNaN(n) && n > 0) out.validez_dias = n;
    }
    if (form.pdf_url !== initial.pdf_url) {
      out.pdf_url = form.pdf_url === "" ? null : form.pdf_url;
    }
    const tipoCambio = form.tipo_documento !== initial.tipo_documento;
    if (tipoCambio) out.tipo_documento = form.tipo_documento;
    // Cuando cambia el tipo mandamos SIEMPRE los dos porcentajes coherentes.
    // Un PATCH con sólo `tipo_documento` dejaría una OC de honorarios con el
    // IVA de la factura vieja y chocaría con el CHECK de coherencia de la BD.
    // `Number("")` es 0 y es finito, así que sin el guard de vacío un campo
    // borrado se mandaba como una tasa de 0 EXPLÍCITA: el backend la respeta
    // (y hace bien, un 0 a propósito es válido) y la OC se quedaba sin
    // retención en silencio. Vacío significa "no lo toqué", no "es cero".
    const pct = (raw: string): number | null => {
      if (raw.trim() === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
    };
    if (tipoCambio || form.iva_porcentaje !== initial.iva_porcentaje) {
      const n = esAfecto(form.tipo_documento) ? pct(form.iva_porcentaje) : 0;
      if (n !== null) out.iva_porcentaje = n;
    }
    if (
      tipoCambio ||
      form.retencion_porcentaje !== initial.retencion_porcentaje
    ) {
      const n =
        form.tipo_documento === "HONORARIOS"
          ? pct(form.retencion_porcentaje)
          : 0;
      if (n !== null) out.retencion_porcentaje = n;
    }
    if (form.proveedor_contacto_id !== initial.proveedor_contacto_id) {
      out.proveedor_contacto_id = form.proveedor_contacto_id
        ? Number(form.proveedor_contacto_id)
        : null;
    }
    if (
      !form.proveedor_contacto_id &&
      form.atte_nombre !== initial.atte_nombre
    ) {
      out.atte_nombre = form.atte_nombre === "" ? null : form.atte_nombre;
    }
    if (
      !form.proveedor_contacto_id &&
      form.atte_cargo !== initial.atte_cargo
    ) {
      out.atte_cargo = form.atte_cargo === "" ? null : form.atte_cargo;
    }
    return out;
  }, [form, initial]);

  const isDirty = Object.keys(dirty).length > 0;

  const esHonorarios = form.tipo_documento === "HONORARIOS";
  const esExenta = form.tipo_documento === "FACTURA_EXENTA";

  /**
   * Preview de los totales con lo que hay en el form. Los ítems no se editan
   * acá, así que el neto es fijo y lo único que se mueve son las tasas —
   * pero cambiar el tipo de documento cambia lo que se va a girar, y eso el
   * operador tiene que verlo antes de guardar, no después en el PDF.
   *
   * Espejo de §3 del megaprompt: `Math.round` es half-up igual que
   * `_round_clp`, y el líquido sale POR RESTA para que cierre exacto. El
   * número que vale es el que devuelve el servidor.
   */
  const neto = toNum(String(initialData.neto ?? "0"));
  const ivaPct = toNum(form.iva_porcentaje);
  const retPct = toNum(form.retencion_porcentaje);
  // El backend no calcula IVA fuera de CLP.
  const ivaCalc =
    esAfecto(form.tipo_documento) && initialData.moneda === "CLP"
      ? Math.round(neto * (ivaPct / 100))
      : 0;
  const totalCalc = neto + ivaCalc;
  const retencionCalc = esHonorarios ? Math.round(neto * (retPct / 100)) : 0;
  const totalAPagarCalc = totalCalc - retencionCalc;
  const fmtMonto = (v: number) =>
    initialData.moneda === "CLP"
      ? toCLP(v)
      : `${initialData.moneda} ${v.toLocaleString("es-CL", {
          maximumFractionDigits: 2,
        })}`;
  const fmtPct = (v: number) =>
    `${v.toLocaleString("es-CL", { maximumFractionDigits: 2 })}%`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (locked) return;
    if (!isDirty) {
      toast.info("Sin cambios para guardar");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await apiClient.patch<OcRead>(
        `/ordenes-compra/${initialData.oc_id}`,
        dirty,
        session,
      );
      toast.success("Cambios guardados");
      await queryClient.invalidateQueries({ queryKey: ["ordenes-compra"] });
      router.push(`/ordenes-compra/${initialData.oc_id}`);
      router.refresh();
    } catch (err) {
      const detail =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error al guardar los cambios";
      setError(detail);
      toast.error(detail);
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={`/ordenes-compra/${initialData.oc_id}`}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        Volver a la OC
      </Link>

      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
          Editar OC {initialData.numero_oc}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Sólo se pueden editar campos no-críticos. Los ítems, montos, número
          y estado no son modificables desde aquí.
        </p>
      </header>

      {locked && (
        <Surface className="bg-warning/5 ring-warning/20">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-warning"
              strokeWidth={1.5}
            />
            <div>
              <p className="text-sm font-medium text-ink-900">
                OC en estado{" "}
                <span className="capitalize">{initialData.estado}</span> — no
                editable
              </p>
              <p className="mt-1 text-xs text-ink-500">
                Las OCs pagadas o anuladas no pueden modificarse para preservar
                la trazabilidad contable.
              </p>
            </div>
          </div>
        </Surface>
      )}

      {error && !locked && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm text-negative">{error}</p>
        </Surface>
      )}

      <form onSubmit={handleSubmit}>
        <Surface>
          <Surface.Header divider>
            <Surface.Title>Campos editables</Surface.Title>
          </Surface.Header>
          <Surface.Body>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelBase} htmlFor="forma-pago">
                  Forma de pago
                </label>
                <input
                  id="forma-pago"
                  type="text"
                  value={form.forma_pago}
                  onChange={(e) => update("forma_pago", e.target.value)}
                  placeholder="Transferencia"
                  disabled={locked}
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase} htmlFor="plazo-pago">
                  Plazo
                </label>
                <input
                  id="plazo-pago"
                  type="text"
                  value={form.plazo_pago}
                  onChange={(e) => update("plazo_pago", e.target.value)}
                  placeholder="30 días"
                  disabled={locked}
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase} htmlFor="validez">
                  Validez (días)
                </label>
                <input
                  id="validez"
                  type="number"
                  min={1}
                  value={form.validez_dias}
                  onChange={(e) => update("validez_dias", e.target.value)}
                  disabled={locked}
                  className={`${inputBase} tabular-nums`}
                />
              </div>
              <div>
                <label className={labelBase} htmlFor="pdf-url">
                  PDF URL
                </label>
                <input
                  id="pdf-url"
                  type="url"
                  value={form.pdf_url}
                  onChange={(e) => update("pdf_url", e.target.value)}
                  placeholder="https://…/oc.pdf"
                  disabled={locked}
                  className={inputBase}
                />
              </div>
              <div>
                <label className={labelBase}>Tipo de documento</label>
                <Combobox
                  items={TIPOS_DOCUMENTO}
                  value={form.tipo_documento}
                  onValueChange={(v) => {
                    if (fiscalLocked) return;
                    update("tipo_documento", v);
                    // Al pasar a honorarios precargamos la tasa del año de
                    // emisión si la OC venía sin retención; el servidor la
                    // confirma contra core.tax_config.
                    if (v === "HONORARIOS" && toNum(form.retencion_porcentaje) <= 0) {
                      update(
                        "retencion_porcentaje",
                        retencionSugerida(initialData.fecha_emision),
                      );
                    }
                  }}
                  placeholder="Tipo de documento"
                  triggerClassName={`w-full h-[38px] ${fiscalLocked ? "pointer-events-none opacity-60" : ""}`}
                />
                {fiscalLocked && !locked && (
                  <p className="mt-1 text-xs text-ink-400">
                    OC{" "}
                    <span className="capitalize">{initialData.estado}</span>: el
                    tipo de documento y las tasas ya no se tocan.
                  </p>
                )}
                {esExenta && (
                  <p className="mt-1 text-xs text-ink-400">
                    Operación exenta (Art. 12 D.L. 825): sin IVA y sin crédito
                    fiscal.
                  </p>
                )}
              </div>
              {/* IVA% sólo en afectas, retención% sólo en honorarios. */}
              {esAfecto(form.tipo_documento) && (
                <div>
                  <label className={labelBase} htmlFor="iva-porcentaje">
                    IVA %
                    <span className="ml-1 text-[10px] font-normal text-ink-400">
                      · cambiarlo recalcula IVA y total
                    </span>
                  </label>
                  <input
                    id="iva-porcentaje"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={form.iva_porcentaje}
                    onChange={(e) => update("iva_porcentaje", e.target.value)}
                    disabled={fiscalLocked}
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
                    min={0}
                    max={100}
                    step="0.01"
                    value={form.retencion_porcentaje}
                    onChange={(e) =>
                      update("retencion_porcentaje", e.target.value)
                    }
                    disabled={fiscalLocked}
                    className={`${inputBase} tabular-nums`}
                  />
                  <p className="mt-1 text-xs text-ink-400">
                    Los ítems son el honorario BRUTO: acá no se puede grossear
                    un líquido. Si el monto está mal cargado hay que anular la
                    OC y rehacerla.
                  </p>
                </div>
              )}
              {/* Resumen en vivo: cambiar el tipo o la tasa mueve lo que se va
                  a girar, y eso se ve acá, no recién en el PDF. */}
              <div className="sm:col-span-2">
                <div className="rounded-xl bg-ink-100/40 p-3 ring-1 ring-hairline">
                  <dl className="ml-auto w-full max-w-sm space-y-1.5">
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="text-sm text-ink-500">
                        {esHonorarios
                          ? "Honorarios brutos"
                          : esExenta
                            ? "Neto exento"
                            : "Neto"}
                      </dt>
                      <dd className="text-sm text-ink-900 tabular-nums">
                        {fmtMonto(neto)}
                      </dd>
                    </div>
                    {esAfecto(form.tipo_documento) && (
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="text-sm text-ink-500">
                          IVA {fmtPct(ivaPct)}
                        </dt>
                        <dd className="text-sm text-ink-900 tabular-nums">
                          {fmtMonto(ivaCalc)}
                        </dd>
                      </div>
                    )}
                    {esHonorarios && (
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="text-sm text-ink-500">
                          Retención {fmtPct(retPct)}
                        </dt>
                        <dd className="text-sm text-negative tabular-nums">
                          − {fmtMonto(retencionCalc)}
                        </dd>
                      </div>
                    )}
                    <div className="flex items-baseline justify-between gap-4 border-t border-hairline pt-2">
                      <dt className="text-sm font-medium text-ink-900">
                        {esHonorarios ? "Líquido a pagar" : "Total"}
                      </dt>
                      <dd className="text-base font-semibold text-cehta-green tabular-nums">
                        {fmtMonto(totalAPagarCalc)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-ink-400">
                    Preview: los totales definitivos los recalcula el servidor
                    al guardar.
                  </p>
                </div>
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
                    value={form.proveedor_contacto_id}
                    onChange={(e) =>
                      update("proveedor_contacto_id", e.target.value)
                    }
                    disabled={locked}
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
                {!form.proveedor_contacto_id && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      value={form.atte_nombre}
                      onChange={(e) => update("atte_nombre", e.target.value)}
                      placeholder="Nombre del encargado (opcional)"
                      disabled={locked}
                      className={inputBase}
                    />
                    <input
                      type="text"
                      value={form.atte_cargo}
                      onChange={(e) => update("atte_cargo", e.target.value)}
                      placeholder="Cargo (opcional)"
                      disabled={locked}
                      className={inputBase}
                    />
                  </div>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className={labelBase} htmlFor="observaciones">
                  Observaciones
                </label>
                <textarea
                  id="observaciones"
                  value={form.observaciones}
                  onChange={(e) => update("observaciones", e.target.value)}
                  rows={4}
                  disabled={locked}
                  className={inputBase}
                />
              </div>

              {/* Condiciones generales — las 4 clausulas de arbitraje del
                  pie del PDF. Se puede cambiar despues de emitida: la OC no
                  cambia de monto ni de partes, solo deja de imprimir (o
                  vuelve a imprimir) el texto contractual. */}
              <div className="sm:col-span-2">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={form.incluye_condiciones}
                    onChange={(e) =>
                      update("incluye_condiciones", e.target.checked)
                    }
                    disabled={locked}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-300 text-cehta-green focus:ring-cehta-green disabled:opacity-50"
                  />
                  <span>
                    <span className="text-sm font-medium text-ink-900">
                      Incluir condiciones generales en el PDF
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-500">
                      Las 4 clausulas de arbitraje del Centro de Arbitraje y
                      Mediacion de Santiago.{" "}
                      {form.incluye_condiciones
                        ? "Se imprimen al final del documento."
                        : "Esta OC sale SIN clausula de arbitraje."}
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </Surface.Body>
        </Surface>

        {/* ── Itemizado ────────────────────────────────────────────────
            Va en su propia tarjeta y con su propio boton porque viaja por
            otro endpoint: PUT /items recalcula neto, IVA, retencion y totales
            server-side. Mezclarlo con "Guardar cambios" haria que un cambio
            de glosa dispare un recalculo de montos, y al reves. */}
        <Surface className="mt-6">
          <Surface.Header divider>
            <Surface.Title>Itemizado</Surface.Title>
          </Surface.Header>
          <Surface.Body className="space-y-4">
            {locked ? (
              <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-ink-700">
                Esta OC ya esta firmada o tiene pagos aprobados, asi que su
                itemizado no se puede cambiar: el firmante aprobo una cifra.
                Si el monto esta mal, anulala y emiti una nueva.
              </p>
            ) : (
              <p className="text-sm text-ink-500">
                Podes corregir lo que la IA haya leido mal. Al guardar, el
                neto, el IVA y los totales se recalculan solos.
              </p>
            )}

            <ItemizadoEditor
              items={items}
              onChange={setItems}
              disabled={locked || guardandoItems}
            />

            <TotalesPreview
              items={items}
              moneda={initialData.moneda ?? "CLP"}
              tipoDocumento={form.tipo_documento}
              ivaPorcentaje={form.iva_porcentaje}
              retencionPorcentaje={form.retencion_porcentaje}
            />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={guardarItems}
                disabled={locked || guardandoItems || !itemsCambiaron}
                className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-60"
              >
                {guardandoItems ? "Guardando…" : "Guardar itemizado"}
              </button>
            </div>
          </Surface.Body>
        </Surface>

        <div className="mt-6 flex justify-end gap-3 border-t border-hairline pt-5">
          <Link
            href={`/ordenes-compra/${initialData.oc_id}`}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={submitting || locked || !isDirty}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {submitting ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </div>
  );
}
