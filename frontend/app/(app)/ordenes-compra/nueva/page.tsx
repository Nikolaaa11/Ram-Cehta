"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { apiClient, ApiError } from "@/lib/api/client";
import type { OcRead } from "@/lib/api/schema";

interface ItemForm {
  descripcion: string;
  precio_unitario: string;
  cantidad: string;
}

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
  const { data: empresas = [] } = useCatalogoEmpresas();

  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [numeroOc, setNumeroOc] = useState("");
  const [proveedorId, setProveedorId] = useState("");
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
      setError("Completá los campos obligatorios y al menos un ítem.");
      return;
    }
    if (items.some((it) => !it.descripcion || !it.precio_unitario)) {
      setError("Cada ítem requiere descripción y precio unitario.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await apiClient.post<OcRead>(
        "/ordenes-compra",
        {
          empresa_codigo: empresaCodigo,
          numero_oc: numeroOc,
          proveedor_id: proveedorId ? Number(proveedorId) : null,
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
        },
        session,
      );
      router.push(`/ordenes-compra/${created.oc_id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error desconocido",
      );
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
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
          Nueva OC
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Completá los datos. El total se calcula automáticamente en el backend
          (neto + 19% IVA).
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
                <label className={labelBase} htmlFor="proveedor-id">
                  Proveedor ID
                </label>
                <input
                  id="proveedor-id"
                  type="number"
                  value={proveedorId}
                  onChange={(e) => setProveedorId(e.target.value)}
                  placeholder="ej. 12"
                  className={`${inputBase} tabular-nums`}
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
