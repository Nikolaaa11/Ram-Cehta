"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { F29Create } from "@/lib/api/types";

const EMPRESAS = [
  "TRONGKAI",
  "REVTECH",
  "EVOQUE",
  "DTE",
  "CSL",
  "RHO",
  "AFIS",
  "FIP_CEHTA",
  "CENERGY",
];

export default function F29NuevoPage() {
  const router = useRouter();
  const { session } = useSession();

  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [periodoTributario, setPeriodoTributario] = useState("");
  const [fechaVencimiento, setFechaVencimiento] = useState("");
  const [montoAPagar, setMontoAPagar] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);

    if (!empresaCodigo || !periodoTributario || !fechaVencimiento) {
      setApiError("Completa todos los campos obligatorios.");
      return;
    }

    const payload: F29Create = {
      empresa_codigo: empresaCodigo,
      periodo_tributario: periodoTributario,
      fecha_vencimiento: fechaVencimiento,
      monto_a_pagar: montoAPagar ? Number(montoAPagar) : null,
    };

    setSubmitting(true);
    try {
      await apiClient.post("/f29", payload, session);
      router.push("/f29");
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Error al guardar la obligación F29.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Registrar Obligación F29</h1>
        <p className="mt-1 text-sm text-gray-500">
          Completa los datos para registrar una nueva obligación tributaria mensual.
        </p>
      </div>

      {/* Form card */}
      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      >
        {/* Empresa */}
        <div className="space-y-1.5">
          <label htmlFor="empresa" className="block text-sm font-medium text-gray-700">
            Empresa <span className="text-red-500">*</span>
          </label>
          <select
            id="empresa"
            value={empresaCodigo}
            onChange={(e) => setEmpresaCodigo(e.target.value)}
            required
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-green-800 focus:outline-none focus:ring-1 focus:ring-green-800"
          >
            <option value="">Selecciona una empresa</option>
            {EMPRESAS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>

        {/* Período tributario */}
        <div className="space-y-1.5">
          <label htmlFor="periodo" className="block text-sm font-medium text-gray-700">
            Período Tributario <span className="text-red-500">*</span>
          </label>
          <input
            id="periodo"
            type="text"
            value={periodoTributario}
            onChange={(e) => setPeriodoTributario(e.target.value)}
            placeholder="Ej: 04_26"
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-green-800 focus:outline-none focus:ring-1 focus:ring-green-800"
          />
          <p className="text-xs text-gray-400">Formato: MM_AA (ej: 04_26 para abril 2026)</p>
        </div>

        {/* Fecha vencimiento */}
        <div className="space-y-1.5">
          <label htmlFor="vencimiento" className="block text-sm font-medium text-gray-700">
            Fecha de Vencimiento <span className="text-red-500">*</span>
          </label>
          <input
            id="vencimiento"
            type="date"
            value={fechaVencimiento}
            onChange={(e) => setFechaVencimiento(e.target.value)}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-green-800 focus:outline-none focus:ring-1 focus:ring-green-800"
          />
        </div>

        {/* Monto */}
        <div className="space-y-1.5">
          <label htmlFor="monto" className="block text-sm font-medium text-gray-700">
            Monto a Pagar (CLP)
          </label>
          <input
            id="monto"
            type="number"
            value={montoAPagar}
            onChange={(e) => setMontoAPagar(e.target.value)}
            placeholder="0"
            min={0}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-green-800 focus:outline-none focus:ring-1 focus:ring-green-800"
          />
          <p className="text-xs text-gray-400">Dejar en blanco si aún no se conoce el monto.</p>
        </div>

        {/* API Error */}
        {apiError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{apiError}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-lg bg-green-800 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-green-900 focus:outline-none focus:ring-2 focus:ring-green-700 disabled:opacity-60"
          >
            {submitting ? "Guardando..." : "Guardar Obligación"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/f29")}
            className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
