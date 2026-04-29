"use client";

/**
 * LegalDocumentEditDialog — edita metadata de un documento legal.
 * PATCH /legal/{id}.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  LegalCategoria,
  LegalDocumentRead,
  LegalEstado,
} from "@/lib/api/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: LegalDocumentRead;
  onSaved?: () => void;
}

interface Form {
  nombre: string;
  descripcion: string;
  categoria: LegalCategoria;
  subcategoria: string;
  contraparte: string;
  fecha_emision: string;
  fecha_vigencia_desde: string;
  fecha_vigencia_hasta: string;
  monto: string;
  moneda: string;
  estado: LegalEstado;
}

const inputCls =
  "w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green";
const labelCls = "mb-1 block text-xs font-medium text-ink-700";

function fromDoc(d: LegalDocumentRead): Form {
  return {
    nombre: d.nombre ?? "",
    descripcion: d.descripcion ?? "",
    categoria: (d.categoria as LegalCategoria) ?? "otro",
    subcategoria: d.subcategoria ?? "",
    contraparte: d.contraparte ?? "",
    fecha_emision: d.fecha_emision ?? "",
    fecha_vigencia_desde: d.fecha_vigencia_desde ?? "",
    fecha_vigencia_hasta: d.fecha_vigencia_hasta ?? "",
    monto: d.monto != null ? String(d.monto) : "",
    moneda: d.moneda ?? "",
    estado: (d.estado as LegalEstado) ?? "vigente",
  };
}

export function LegalDocumentEditDialog({
  open,
  onOpenChange,
  doc,
  onSaved,
}: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(fromDoc(doc));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(fromDoc(doc));
      setError(null);
    }
  }, [open, doc]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        nombre: form.nombre.trim() || null,
        descripcion: form.descripcion.trim() || null,
        categoria: form.categoria,
        subcategoria: form.subcategoria.trim() || null,
        contraparte: form.contraparte.trim() || null,
        fecha_emision: form.fecha_emision || null,
        fecha_vigencia_desde: form.fecha_vigencia_desde || null,
        fecha_vigencia_hasta: form.fecha_vigencia_hasta || null,
        monto: form.monto.trim() ? Number(form.monto) : null,
        moneda: form.moneda.trim() || null,
        estado: form.estado,
      };
      return apiClient.patch<LegalDocumentRead>(
        `/legal/${doc.documento_id}`,
        payload,
        session,
      );
    },
    onSuccess: async () => {
      toast.success("Documento actualizado");
      await qc.invalidateQueries({ queryKey: ["legal"] });
      await qc.invalidateQueries({ queryKey: ["legal-document"] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError ? err.detail : "Error al actualizar documento",
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cehta-green/10 text-cehta-green">
            <FileText className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <div className="flex-1">
            <DialogTitle>Editar documento legal</DialogTitle>
            <DialogDescription>
              {doc.empresa_codigo} · {doc.categoria}
              {doc.subcategoria ? ` / ${doc.subcategoria}` : ""}
            </DialogDescription>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
          className="mt-5 max-h-[70vh] space-y-3 overflow-y-auto pr-1"
        >
          {error && (
            <div className="rounded-lg border border-negative/20 bg-negative/5 px-3 py-2 text-xs text-negative">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelCls}>Nombre *</label>
              <input
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                required
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Categoría</label>
              <select
                value={form.categoria}
                onChange={(e) =>
                  setForm({
                    ...form,
                    categoria: e.target.value as LegalCategoria,
                  })
                }
                className={inputCls}
              >
                <option value="contrato">Contrato</option>
                <option value="acta">Acta</option>
                <option value="declaracion_sii">Declaración SII</option>
                <option value="permiso">Permiso</option>
                <option value="poliza">Póliza</option>
                <option value="estatuto">Estatuto</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Subcategoría</label>
              <input
                value={form.subcategoria}
                onChange={(e) =>
                  setForm({ ...form, subcategoria: e.target.value })
                }
                placeholder="cliente / proveedor / bancario / f29…"
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Descripción</label>
              <textarea
                value={form.descripcion}
                onChange={(e) =>
                  setForm({ ...form, descripcion: e.target.value })
                }
                rows={2}
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Contraparte</label>
              <input
                value={form.contraparte}
                onChange={(e) =>
                  setForm({ ...form, contraparte: e.target.value })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Fecha emisión</label>
              <input
                type="date"
                value={form.fecha_emision}
                onChange={(e) =>
                  setForm({ ...form, fecha_emision: e.target.value })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Estado</label>
              <select
                value={form.estado}
                onChange={(e) =>
                  setForm({ ...form, estado: e.target.value as LegalEstado })
                }
                className={inputCls}
              >
                <option value="vigente">Vigente</option>
                <option value="borrador">Borrador</option>
                <option value="renovado">Renovado</option>
                <option value="vencido">Vencido</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Vigencia desde</label>
              <input
                type="date"
                value={form.fecha_vigencia_desde}
                onChange={(e) =>
                  setForm({ ...form, fecha_vigencia_desde: e.target.value })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Vigencia hasta</label>
              <input
                type="date"
                value={form.fecha_vigencia_hasta}
                onChange={(e) =>
                  setForm({ ...form, fecha_vigencia_hasta: e.target.value })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Monto</label>
              <input
                type="number"
                step="1"
                value={form.monto}
                onChange={(e) => setForm({ ...form, monto: e.target.value })}
                className={`${inputCls} tabular-nums`}
              />
            </div>
            <div>
              <label className={labelCls}>Moneda</label>
              <input
                value={form.moneda}
                onChange={(e) => setForm({ ...form, moneda: e.target.value })}
                placeholder="CLP / USD / UF"
                className={inputCls}
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline hover:bg-ink-100/40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || !form.nombre.trim()}
              className="rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700 disabled:opacity-60"
            >
              {mutation.isPending ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
