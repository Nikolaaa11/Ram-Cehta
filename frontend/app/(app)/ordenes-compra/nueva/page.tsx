"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import type { OcRead } from "@/lib/api/types";

interface ItemForm {
  descripcion: string;
  precio_unitario: string;
  cantidad: string;
}

export default function NuevaOcPage() {
  const router = useRouter();
  const { session } = useSession();

  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [numeroOc, setNumeroOc] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [fechaEmision, setFechaEmision] = useState(
    new Date().toISOString().slice(0, 10)
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

  const addItem = () =>
    setItems([...items, { descripcion: "", precio_unitario: "", cantidad: "1" }]);
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
        session
      );
      router.push(`/ordenes-compra/${created.oc_id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error desconocido"
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/ordenes-compra" className="text-sm text-green-700 hover:underline">
        ← Volver a OCs
      </Link>

      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">Nueva OC</h1>
        <p className="mt-1 text-sm text-gray-500">
          Completá los datos. El total se calcula automáticamente en el backend (neto + 19% IVA).
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-gray-800">Cabecera</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Empresa <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={empresaCodigo}
                onChange={(e) => setEmpresaCodigo(e.target.value.toUpperCase())}
                placeholder="TRONGKAI"
                required
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:ring-1 focus:ring-green-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Número OC <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={numeroOc}
                onChange={(e) => setNumeroOc(e.target.value)}
                placeholder="OC-2026-001"
                required
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:ring-1 focus:ring-green-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Proveedor ID
              </label>
              <input
                type="number"
                value={proveedorId}
                onChange={(e) => setProveedorId(e.target.value)}
                placeholder="ej. 12"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:ring-1 focus:ring-green-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Fecha emisión
              </label>
              <input
                type="date"
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:ring-1 focus:ring-green-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Moneda</label>
              <select
                value={moneda}
                onChange={(e) => setMoneda(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:ring-1 focus:ring-green-700"
              >
                <option value="CLP">CLP</option>
                <option value="UF">UF</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Validez (días)
              </label>
              <input
                type="number"
                value={validezDias}
                onChange={(e) => setValidezDias(e.target.value)}
                min="1"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:ring-1 focus:ring-green-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Forma de pago
              </label>
              <input
                type="text"
                value={formaPago}
                onChange={(e) => setFormaPago(e.target.value)}
                placeholder="Transferencia"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:ring-1 focus:ring-green-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Plazo</label>
              <input
                type="text"
                value={plazoPago}
                onChange={(e) => setPlazoPago(e.target.value)}
                placeholder="30 días"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:ring-1 focus:ring-green-700"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Observaciones
              </label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-700 focus:ring-1 focus:ring-green-700"
              />
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-800">Ítems</h2>
            <button
              type="button"
              onClick={addItem}
              className="text-xs font-medium text-green-700 hover:underline"
            >
              + Agregar ítem
            </button>
          </div>
          {items.map((it, idx) => (
            <div
              key={idx}
              className="grid grid-cols-12 gap-3 border-t border-gray-100 pt-3 first:border-0 first:pt-0"
            >
              <input
                type="text"
                value={it.descripcion}
                onChange={(e) => updateItem(idx, { descripcion: e.target.value })}
                placeholder="Descripción"
                required
                className="col-span-12 rounded-md border border-gray-300 px-3 py-2 text-sm sm:col-span-6"
              />
              <input
                type="number"
                value={it.precio_unitario}
                onChange={(e) => updateItem(idx, { precio_unitario: e.target.value })}
                placeholder="P. Unit."
                step="0.01"
                min="0"
                required
                className="col-span-6 rounded-md border border-gray-300 px-3 py-2 text-sm sm:col-span-3"
              />
              <input
                type="number"
                value={it.cantidad}
                onChange={(e) => updateItem(idx, { cantidad: e.target.value })}
                placeholder="Cant."
                step="0.01"
                min="0.01"
                className="col-span-4 rounded-md border border-gray-300 px-3 py-2 text-sm sm:col-span-2"
              />
              <button
                type="button"
                onClick={() => removeItem(idx)}
                disabled={items.length === 1}
                className="col-span-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100 disabled:opacity-50 sm:col-span-1"
              >
                −
              </button>
            </div>
          ))}
        </section>

        <div className="flex justify-end gap-3">
          <Link
            href="/ordenes-compra"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-green-800 px-4 py-2 text-sm font-medium text-white hover:bg-green-900 disabled:opacity-60"
          >
            {submitting ? "Creando..." : "Crear OC"}
          </button>
        </div>
      </form>
    </div>
  );
}
