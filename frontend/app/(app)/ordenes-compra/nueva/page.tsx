"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, Cloud, Plus, Trash2 } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { ProveedorTypeaheadCached } from "@/components/proveedores/ProveedorTypeaheadCached";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { useFormAutosave } from "@/hooks/use-form-autosave";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { useFormShortcuts } from "@/hooks/use-form-shortcuts";
import { toast } from "@/components/ui/toast";
import { apiClient, ApiError } from "@/lib/api/client";
import type { OcRead } from "@/lib/api/schema";

interface ItemForm {
  descripcion: string;
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

export default function NuevaOcPage() {
  const router = useRouter();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const { data: empresas = [] } = useCatalogoEmpresas();

  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [numeroOc, setNumeroOc] = useState("");
  const [proveedorRut, setProveedorRut] = useState("");
  const [proveedorNombre, setProveedorNombre] = useState("");
  const [proveedorLookup, setProveedorLookup] = useState<ProveedorLookupState>({
    status: "idle",
  });
  const [fechaEmision, setFechaEmision] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [moneda, setMoneda] = useState("CLP");
  const [validezDias, setValidezDias] = useState("30");
  const [formaPago, setFormaPago] = useState("");
  const [plazoPago, setPlazoPago] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [items, setItems] = useState<ItemForm[]>([
    { descripcion: "", precio_unitario: "", cantidad: "1" },
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
      observaciones,
      items,
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
      observaciones,
      items,
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
        if (saved.observaciones) setObservaciones(saved.observaciones);
        if (saved.items?.length) setItems(saved.items);
        toast.info("Restauré tu borrador del último intento.");
      },
    },
  );
  const isDirty =
    numeroOc.trim().length > 0 ||
    proveedorRut.trim().length > 0 ||
    proveedorNombre.trim().length > 0 ||
    observaciones.trim().length > 0 ||
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
      { descripcion: "", precio_unitario: "", cantidad: "1" },
    ]);
  const removeItem = (idx: number) =>
    setItems(items.length > 1 ? items.filter((_, i) => i !== idx) : items);
  const updateItem = (idx: number, patch: Partial<ItemForm>) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

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
        observaciones: observaciones || null,
        items: items.map((it, i) => ({
          item: i + 1,
          descripcion: it.descripcion,
          precio_unitario: Number(it.precio_unitario),
          cantidad: Number(it.cantidad) || 1,
        })),
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
          Tipeá el RUT del proveedor y vamos a precargar/crearlo solos. El
          total se calcula automáticamente en el backend (neto + 19% IVA).
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
                <input
                  id="numero-oc"
                  type="text"
                  value={numeroOc}
                  onChange={(e) => setNumeroOc(e.target.value)}
                  placeholder="OC-2026-001"
                  required
                  className={inputBase}
                />
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
                  }}
                  onClear={() => {
                    setProveedorNombre("");
                    // No tocamos proveedorRut aquí — el operador puede
                    // estar editando solo el nombre y mantener el RUT.
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
                  Plazo
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
                  <div className="col-span-12 sm:col-span-6">
                    <label className="sr-only" htmlFor={`item-desc-${idx}`}>
                      Descripción
                    </label>
                    <input
                      id={`item-desc-${idx}`}
                      type="text"
                      value={it.descripcion}
                      onChange={(e) =>
                        updateItem(idx, { descripcion: e.target.value })
                      }
                      placeholder="Descripción"
                      required
                      className={inputBase}
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label className="sr-only" htmlFor={`item-price-${idx}`}>
                      Precio unitario
                    </label>
                    <input
                      id={`item-price-${idx}`}
                      type="number"
                      value={it.precio_unitario}
                      onChange={(e) =>
                        updateItem(idx, { precio_unitario: e.target.value })
                      }
                      placeholder="P. Unit."
                      step="0.01"
                      min="0"
                      required
                      className={`${inputBase} tabular-nums`}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
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
                      step="0.01"
                      min="0.01"
                      className={`${inputBase} tabular-nums`}
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
