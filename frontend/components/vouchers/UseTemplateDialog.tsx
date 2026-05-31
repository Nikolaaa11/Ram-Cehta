"use client";

/**
 * UseTemplateDialog — V5++ ola AB
 *
 * Modal para instanciar una plantilla como voucher DRAFT.
 *
 * El user provee:
 *   - fecha_documento + fecha_contable (obligatorio)
 *   - glosa_override opcional (con interpolación {mes} {anio} {fecha})
 *   - multiplier opcional (multiplica todos los debit/credit, útil cuando
 *     la plantilla es "1 unidad" y querés escalarla)
 *   - doc_tributario_folio (si la plantilla tenía doc_tributario_tipo)
 *
 * Backend devuelve el voucher_id del DRAFT creado y el usuario es
 * redirigido a /vouchers/{id} para revisar/editar.
 */
import { useState } from "react";
import { Loader2, X, Sparkles } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Template {
  template_id: number;
  codigo: string;
  nombre: string;
  empresa_codigo: string;
  tipo: string;
  moneda: string;
}

interface Props {
  template: Template;
  onClose: () => void;
  onSuccess: (voucherId: number) => void;
}

function isoToday(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export function UseTemplateDialog({ template, onClose, onSuccess }: Props) {
  const { session } = useSession();
  const [fechaDoc, setFechaDoc] = useState(isoToday());
  const [fechaCont, setFechaCont] = useState(isoToday());
  const [glosaOverride, setGlosaOverride] = useState("");
  const [multiplier, setMultiplier] = useState("");
  const [docFolio, setDocFolio] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        fecha_documento: fechaDoc,
        fecha_contable: fechaCont,
      };
      if (glosaOverride.trim()) body.glosa_override = glosaOverride.trim();
      if (multiplier.trim()) body.multiplier = multiplier.trim();
      if (docFolio.trim()) body.doc_tributario_folio = docFolio.trim();
      return apiClient.post<{ voucher_id: number }>(
        `/vouchers/templates/${template.template_id}/use`,
        body,
        session,
      );
    },
    onSuccess: (data) => {
      toast.success(`Voucher DRAFT creado desde plantilla`);
      onSuccess(data.voucher_id);
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Error";
      toast.error(`Error: ${msg}`);
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-card-hover w-full max-w-md p-6 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 text-ink-400 hover:text-ink-700"
          aria-label="Cerrar"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-start gap-3 mb-4">
          <div className="rounded-lg bg-cehta-green/10 p-2">
            <Sparkles className="size-4 text-cehta-green" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-ink-900">
              Usar plantilla
            </h2>
            <p className="text-xs text-ink-500 mt-0.5">{template.nombre}</p>
            <code className="text-[10px] text-ink-400 font-mono">{template.codigo}</code>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="fecha-doc">Fecha documento</Label>
              <Input
                id="fecha-doc"
                type="date"
                value={fechaDoc}
                onChange={(e) => setFechaDoc(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="fecha-cont">Fecha contable</Label>
              <Input
                id="fecha-cont"
                type="date"
                value={fechaCont}
                onChange={(e) => setFechaCont(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="glosa">Glosa (opcional)</Label>
            <Input
              id="glosa"
              placeholder="Si dejás vacío, usa la default"
              value={glosaOverride}
              onChange={(e) => setGlosaOverride(e.target.value)}
            />
            <p className="text-[10px] text-ink-500 mt-1">
              Soporta <code className="font-mono">{"{mes}"}</code>,{" "}
              <code className="font-mono">{"{anio}"}</code>,{" "}
              <code className="font-mono">{"{fecha}"}</code> — se reemplazan automáticamente.
            </p>
          </div>

          <div>
            <Label htmlFor="multiplier">Multiplicador (opcional)</Label>
            <Input
              id="multiplier"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="1.0 = sin cambios; 1.05 = +5%"
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
            />
            <p className="text-[10px] text-ink-500 mt-1">
              Multiplica todos los debit/credit. Útil para reajustes.
            </p>
          </div>

          <div>
            <Label htmlFor="doc-folio">Folio doc tributario (opcional)</Label>
            <Input
              id="doc-folio"
              placeholder="Si la plantilla requería doc tributario"
              value={docFolio}
              onChange={(e) => setDocFolio(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
            Crear voucher DRAFT
          </Button>
        </div>
      </div>
    </div>
  );
}
