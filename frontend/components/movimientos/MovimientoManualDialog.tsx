"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";

interface FormState {
  fecha: string; // YYYY-MM-DD
  empresa_codigo: string;
  tipo: "abono" | "egreso";
  monto: string; // string para input controlado
  descripcion: string;
  concepto_general: string;
  proyecto: string;
  banco: string;
  numero_documento: string;
}

const TODAY = new Date().toISOString().slice(0, 10);

const EMPTY: FormState = {
  fecha: TODAY,
  empresa_codigo: "",
  tipo: "egreso",
  monto: "",
  descripcion: "",
  concepto_general: "",
  proyecto: "",
  banco: "",
  numero_documento: "",
};

interface Props {
  trigger?: React.ReactNode;
}

/**
 * Dialog para crear un movimiento manual fuera del ETL.
 *
 * Caso de uso: ajustes contables, transferencias inversor, correcciones
 * que no vienen del Excel madre. POST /movimientos invalida la lista.
 *
 * El user elige tipo (abono/egreso) + monto único — el backend mapea a
 * los dos campos separados (`abono`/`egreso`) según el tipo.
 */
export function MovimientoManualDialog({ trigger }: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const { data: empresas = [] } = useCatalogoEmpresas();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const empresaItems: ComboboxItem[] = empresas.map((e) => ({
    value: e.codigo,
    label: `${e.codigo} — ${e.razon_social}`,
  }));

  const mutation = useMutation({
    mutationFn: async () => {
      const monto = Number(form.monto.replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(monto) || monto <= 0) {
        throw new Error("Monto debe ser un número positivo");
      }
      const body = {
        fecha: form.fecha,
        empresa_codigo: form.empresa_codigo,
        descripcion: form.descripcion,
        abono: form.tipo === "abono" ? monto : 0,
        egreso: form.tipo === "egreso" ? monto : 0,
        concepto_general: form.concepto_general || null,
        proyecto: form.proyecto || null,
        banco: form.banco || null,
        numero_documento: form.numero_documento || null,
      };
      return apiClient.post("/movimientos", body, session);
    },
    onSuccess: () => {
      toast.success("Movimiento manual registrado");
      qc.invalidateQueries({ queryKey: ["movimientos"] });
      setForm(EMPTY);
      setOpen(false);
    },
    onError: (err) => {
      const detail = err instanceof ApiError ? err.detail : err.message;
      toast.error(`No se pudo crear: ${detail}`);
    },
  });

  const isValid =
    form.empresa_codigo &&
    form.descripcion.trim().length > 0 &&
    form.fecha &&
    form.monto.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ?? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-apple hover:bg-cehta-green-700"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Nuevo movimiento manual
        </button>
      )}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Movimiento manual</DialogTitle>
          <DialogDescription>
            Para ajustes / transferencias / correcciones fuera del ETL del
            Excel madre. Queda marcado como{" "}
            <code className="rounded bg-ink-100/60 px-1 py-0.5 text-xs">
              real
            </code>{" "}
            con un{" "}
            <code className="rounded bg-ink-100/60 px-1 py-0.5 text-xs">
              natural_key
            </code>{" "}
            prefijo{" "}
            <code className="rounded bg-ink-100/60 px-1 py-0.5 text-xs">
              manual_
            </code>{" "}
            para distinguirlo del ETL en auditoría.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isValid) mutation.mutate();
          }}
          className="grid grid-cols-2 gap-4"
        >
          {/* Fecha */}
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
              Fecha
            </label>
            <input
              type="date"
              value={form.fecha}
              onChange={(e) => setForm({ ...form, fecha: e.target.value })}
              required
              className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          {/* Empresa */}
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
              Empresa
            </label>
            <Combobox
              items={empresaItems}
              value={form.empresa_codigo}
              onValueChange={(v) => setForm({ ...form, empresa_codigo: v })}
              placeholder="Seleccionar empresa…"
            />
          </div>

          {/* Tipo */}
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
              Tipo
            </label>
            <div className="inline-flex w-full rounded-xl bg-ink-100/50 p-0.5 ring-1 ring-hairline">
              <button
                type="button"
                onClick={() => setForm({ ...form, tipo: "abono" })}
                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150 ease-apple ${
                  form.tipo === "abono"
                    ? "bg-positive text-white shadow-card"
                    : "text-ink-700 hover:bg-white/60"
                }`}
              >
                + Abono
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, tipo: "egreso" })}
                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-150 ease-apple ${
                  form.tipo === "egreso"
                    ? "bg-negative text-white shadow-card"
                    : "text-ink-700 hover:bg-white/60"
                }`}
              >
                − Egreso
              </button>
            </div>
          </div>

          {/* Monto */}
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
              Monto (CLP)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={form.monto}
              onChange={(e) => setForm({ ...form, monto: e.target.value })}
              placeholder="ej. 1.500.000"
              required
              className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm font-mono tabular-nums ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          {/* Descripción */}
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
              Descripción
            </label>
            <input
              type="text"
              value={form.descripcion}
              onChange={(e) =>
                setForm({ ...form, descripcion: e.target.value })
              }
              placeholder="ej. Ajuste contable Q2 2025"
              required
              maxLength={500}
              className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          {/* Concepto + proyecto */}
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
              Concepto general (opcional)
            </label>
            <input
              type="text"
              value={form.concepto_general}
              onChange={(e) =>
                setForm({ ...form, concepto_general: e.target.value })
              }
              placeholder="ej. Operacional"
              className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
              Proyecto (opcional)
            </label>
            <input
              type="text"
              value={form.proyecto}
              onChange={(e) => setForm({ ...form, proyecto: e.target.value })}
              placeholder="ej. RHO_2025"
              className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          {/* Banco + número documento */}
          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
              Banco (opcional)
            </label>
            <input
              type="text"
              value={form.banco}
              onChange={(e) => setForm({ ...form, banco: e.target.value })}
              placeholder="ej. BCI / Santander"
              className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          <div className="col-span-2 md:col-span-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-ink-500">
              Nº documento (opcional)
            </label>
            <input
              type="text"
              value={form.numero_documento}
              onChange={(e) =>
                setForm({ ...form, numero_documento: e.target.value })
              }
              placeholder="ej. transferencia 1234567"
              className="w-full rounded-xl border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          <DialogFooter className="col-span-2 mt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!isValid || mutation.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors duration-150 ease-apple hover:bg-cehta-green-700 disabled:opacity-50"
            >
              {mutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              )}
              Crear movimiento
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
