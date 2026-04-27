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
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Surface } from "@/components/ui/surface";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { OcRead } from "@/lib/api/schema";

interface Props {
  initialData: OcRead;
}

interface FormState {
  observaciones: string;
  forma_pago: string;
  plazo_pago: string;
  validez_dias: string;
  pdf_url: string;
}

const inputBase =
  "w-full rounded-lg border-0 ring-1 ring-hairline bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 transition-shadow focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:bg-ink-100/40 disabled:text-ink-500";
const labelBase = "mb-1.5 block text-sm font-medium text-ink-700";

const LOCKED_STATES = new Set(["pagada", "anulada"]);

export function OcEditForm({ initialData }: Props) {
  const router = useRouter();
  const { session } = useSession();
  const queryClient = useQueryClient();

  const locked = LOCKED_STATES.has(initialData.estado.toLowerCase());

  const initial = useMemo<FormState>(
    () => ({
      observaciones: initialData.observaciones ?? "",
      forma_pago: initialData.forma_pago ?? "",
      plazo_pago: initialData.plazo_pago ?? "",
      validez_dias: String(initialData.validez_dias ?? ""),
      pdf_url: initialData.pdf_url ?? "",
    }),
    [initialData],
  );

  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (error) setError(null);
  }

  const dirty = useMemo<Record<string, string | number | null>>(() => {
    const out: Record<string, string | number | null> = {};
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
    return out;
  }, [form, initial]);

  const isDirty = Object.keys(dirty).length > 0;

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
          y estado no son modificables desde acá.
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
