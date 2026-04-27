"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Save } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { Surface } from "@/components/ui/surface";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import type { F29Create } from "@/lib/api/schema";

const ESTADO_OPTIONS: ComboboxItem[] = [
  { value: "pendiente", label: "Pendiente" },
  { value: "pagado", label: "Pagado" },
  { value: "vencido", label: "Vencido" },
  { value: "exento", label: "Exento" },
];

type Estado = F29Create["estado"];

const PERIODO_PATTERN = /^\d{2}_\d{2}$/;

export default function F29NuevoPage() {
  const router = useRouter();
  const { session } = useSession();
  const { data: empresas = [] } = useCatalogoEmpresas();

  const [empresaCodigo, setEmpresaCodigo] = useState<string>("");
  const [periodoTributario, setPeriodoTributario] = useState<string>("");
  const [fechaVencimiento, setFechaVencimiento] = useState<string>("");
  const [montoAPagar, setMontoAPagar] = useState<string>("");
  const [estado, setEstado] = useState<Estado>("pendiente");
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const empresaItems = useMemo<ComboboxItem[]>(
    () =>
      empresas.map((e) => ({
        value: e.codigo,
        label: `${e.codigo} — ${e.razon_social}`,
      })),
    [empresas],
  );

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!empresaCodigo) errs.empresa = "Selecciona una empresa.";
    if (!periodoTributario) {
      errs.periodo = "Ingresa el período tributario.";
    } else if (!PERIODO_PATTERN.test(periodoTributario)) {
      errs.periodo = "Formato inválido. Usa MM_AA (ej: 02_26).";
    }
    if (!fechaVencimiento) errs.fecha = "Selecciona la fecha de vencimiento.";
    if (montoAPagar && Number.isNaN(Number(montoAPagar))) {
      errs.monto = "Monto inválido.";
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setApiError(null);

    if (!validate()) return;

    const payload: F29Create = {
      empresa_codigo: empresaCodigo,
      periodo_tributario: periodoTributario,
      fecha_vencimiento: fechaVencimiento,
      monto_a_pagar: montoAPagar ? Number(montoAPagar) : null,
      estado,
    };

    setSubmitting(true);
    try {
      await apiClient.post("/f29", payload, session);
      router.push("/f29");
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : "Error al guardar la obligación F29.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const inputBase =
    "h-9 w-full rounded-xl bg-white px-3 text-sm text-ink-900 ring-1 ring-hairline tabular-nums shadow-glass placeholder:text-ink-300 transition-shadow focus:outline-none focus:ring-2 focus:ring-cehta-green";

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {/* Header */}
      <div>
        <button
          type="button"
          onClick={() => router.push("/f29")}
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 transition-colors hover:text-ink-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          Volver a F29
        </button>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
          Registrar obligación F29
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Completa los datos para registrar una nueva obligación tributaria mensual.
        </p>
      </div>

      {/* Form card */}
      <Surface>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Empresa */}
          <div className="space-y-1.5">
            <label
              htmlFor="empresa"
              className="text-xs uppercase tracking-wide text-ink-500 font-medium"
            >
              Empresa <span className="text-negative">*</span>
            </label>
            <Combobox
              items={empresaItems}
              value={empresaCodigo}
              onValueChange={setEmpresaCodigo}
              placeholder="Selecciona una empresa"
              searchPlaceholder="Buscar empresa…"
              emptyText="Sin empresas."
              triggerClassName="w-full"
            />
            {fieldErrors.empresa && (
              <p className="text-xs text-negative">{fieldErrors.empresa}</p>
            )}
          </div>

          {/* Período */}
          <div className="space-y-1.5">
            <label
              htmlFor="periodo"
              className="text-xs uppercase tracking-wide text-ink-500 font-medium"
            >
              Período tributario <span className="text-negative">*</span>
            </label>
            <input
              id="periodo"
              type="text"
              value={periodoTributario}
              onChange={(e) => setPeriodoTributario(e.target.value)}
              placeholder="02_26"
              pattern="\d{2}_\d{2}"
              required
              aria-invalid={Boolean(fieldErrors.periodo)}
              className={cn(
                inputBase,
                fieldErrors.periodo && "ring-negative focus:ring-negative",
              )}
            />
            <p className="text-xs text-ink-500">
              Formato MM_AA (ej: <span className="tabular-nums">02_26</span> para febrero 2026).
            </p>
            {fieldErrors.periodo && (
              <p className="text-xs text-negative">{fieldErrors.periodo}</p>
            )}
          </div>

          {/* Fecha vencimiento */}
          <div className="space-y-1.5">
            <label
              htmlFor="vencimiento"
              className="text-xs uppercase tracking-wide text-ink-500 font-medium"
            >
              Fecha de vencimiento <span className="text-negative">*</span>
            </label>
            <input
              id="vencimiento"
              type="date"
              value={fechaVencimiento}
              onChange={(e) => setFechaVencimiento(e.target.value)}
              required
              aria-invalid={Boolean(fieldErrors.fecha)}
              className={cn(
                inputBase,
                fieldErrors.fecha && "ring-negative focus:ring-negative",
              )}
            />
            {fieldErrors.fecha && (
              <p className="text-xs text-negative">{fieldErrors.fecha}</p>
            )}
          </div>

          {/* Monto */}
          <div className="space-y-1.5">
            <label
              htmlFor="monto"
              className="text-xs uppercase tracking-wide text-ink-500 font-medium"
            >
              Monto a pagar (CLP)
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-300">
                $
              </span>
              <input
                id="monto"
                type="number"
                value={montoAPagar}
                onChange={(e) => setMontoAPagar(e.target.value)}
                placeholder="0"
                min={0}
                step={1}
                aria-invalid={Boolean(fieldErrors.monto)}
                className={cn(
                  inputBase,
                  "pl-7 text-right",
                  fieldErrors.monto && "ring-negative focus:ring-negative",
                )}
              />
            </div>
            <p className="text-xs text-ink-500">
              Dejar en blanco si aún no se conoce el monto.
            </p>
            {fieldErrors.monto && (
              <p className="text-xs text-negative">{fieldErrors.monto}</p>
            )}
          </div>

          {/* Estado */}
          <div className="space-y-1.5">
            <label
              htmlFor="estado"
              className="text-xs uppercase tracking-wide text-ink-500 font-medium"
            >
              Estado
            </label>
            <Combobox
              items={ESTADO_OPTIONS}
              value={estado}
              onValueChange={(v) => setEstado(v as Estado)}
              placeholder="Selecciona un estado"
              searchPlaceholder="Buscar estado…"
              emptyText="Sin estados."
              triggerClassName="w-full"
            />
          </div>

          {/* API error banner */}
          {apiError && (
            <div className="flex items-start gap-2 rounded-xl bg-negative/5 px-4 py-3 ring-1 ring-negative/20">
              <AlertCircle
                className="mt-0.5 h-4 w-4 shrink-0 text-negative"
                strokeWidth={1.5}
              />
              <p className="text-sm text-negative">{apiError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60"
            >
              <Save className="h-4 w-4" strokeWidth={1.5} />
              {submitting ? "Guardando…" : "Guardar obligación"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/f29")}
              className="inline-flex items-center rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
            >
              Cancelar
            </button>
          </div>
        </form>
      </Surface>
    </div>
  );
}
