"use client";

/**
 * FondoEditDialog — edita los campos clave de un fondo. PATCH /fondos/{id}.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
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
  EstadoOutreach,
  FondoRead,
  TipoFondo,
} from "@/lib/api/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fondo: FondoRead;
  onSaved?: () => void;
}

interface Form {
  nombre: string;
  tipo: TipoFondo;
  estado_outreach: EstadoOutreach;
  pais: string;
  region: string;
  ticket_min_usd: string;
  ticket_max_usd: string;
  sectores: string;
  thesis: string;
  contacto_nombre: string;
  contacto_email: string;
  contacto_linkedin: string;
  website: string;
  notas: string;
  fecha_proximo_contacto: string;
}

const inputCls =
  "w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green";
const labelCls = "mb-1 block text-xs font-medium text-ink-700";

function fromFondo(f: FondoRead): Form {
  return {
    nombre: f.nombre ?? "",
    tipo: (f.tipo as TipoFondo) ?? "lp",
    estado_outreach: (f.estado_outreach as EstadoOutreach) ?? "no_contactado",
    pais: f.pais ?? "",
    region: f.region ?? "",
    ticket_min_usd: f.ticket_min_usd != null ? String(f.ticket_min_usd) : "",
    ticket_max_usd: f.ticket_max_usd != null ? String(f.ticket_max_usd) : "",
    sectores: (f.sectores ?? []).join(", "),
    thesis: f.thesis ?? "",
    contacto_nombre: f.contacto_nombre ?? "",
    contacto_email: f.contacto_email ?? "",
    contacto_linkedin: f.contacto_linkedin ?? "",
    website: f.website ?? "",
    notas: f.notas ?? "",
    fecha_proximo_contacto: f.fecha_proximo_contacto ?? "",
  };
}

export function FondoEditDialog({ open, onOpenChange, fondo, onSaved }: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(fromFondo(fondo));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(fromFondo(fondo));
      setError(null);
    }
  }, [open, fondo]);

  const mutation = useMutation({
    mutationFn: () => {
      const sectores = form.sectores
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const payload: Record<string, unknown> = {
        nombre: form.nombre.trim() || null,
        tipo: form.tipo,
        estado_outreach: form.estado_outreach,
        pais: form.pais.trim() || null,
        region: form.region.trim() || null,
        ticket_min_usd: form.ticket_min_usd ? Number(form.ticket_min_usd) : null,
        ticket_max_usd: form.ticket_max_usd ? Number(form.ticket_max_usd) : null,
        sectores: sectores.length ? sectores : null,
        thesis: form.thesis.trim() || null,
        contacto_nombre: form.contacto_nombre.trim() || null,
        contacto_email: form.contacto_email.trim() || null,
        contacto_linkedin: form.contacto_linkedin.trim() || null,
        website: form.website.trim() || null,
        notas: form.notas.trim() || null,
        fecha_proximo_contacto: form.fecha_proximo_contacto || null,
      };
      return apiClient.patch<FondoRead>(
        `/fondos/${fondo.fondo_id}`,
        payload,
        session,
      );
    },
    onSuccess: async () => {
      toast.success(`Fondo ${form.nombre} actualizado`);
      await qc.invalidateQueries({ queryKey: ["fondos"] });
      await qc.invalidateQueries({ queryKey: ["fondo"] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.detail : "Error al actualizar fondo");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cehta-green/10 text-cehta-green">
            <Pencil className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <div className="flex-1">
            <DialogTitle>Editar fondo</DialogTitle>
            <DialogDescription>{fondo.nombre}</DialogDescription>
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
              <label className={labelCls}>Tipo</label>
              <select
                value={form.tipo}
                onChange={(e) =>
                  setForm({ ...form, tipo: e.target.value as TipoFondo })
                }
                className={inputCls}
              >
                <option value="lp">LP</option>
                <option value="banco">Banco</option>
                <option value="programa_estado">Programa Estado</option>
                <option value="family_office">Family Office</option>
                <option value="vc">VC</option>
                <option value="angel">Angel</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Estado outreach</label>
              <select
                value={form.estado_outreach}
                onChange={(e) =>
                  setForm({
                    ...form,
                    estado_outreach: e.target.value as EstadoOutreach,
                  })
                }
                className={inputCls}
              >
                <option value="no_contactado">No contactado</option>
                <option value="contactado">Contactado</option>
                <option value="en_negociacion">En negociación</option>
                <option value="cerrado">Cerrado</option>
                <option value="descartado">Descartado</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>País</label>
              <input
                value={form.pais}
                onChange={(e) => setForm({ ...form, pais: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Región</label>
              <input
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Ticket min (USD)</label>
              <input
                type="number"
                value={form.ticket_min_usd}
                onChange={(e) =>
                  setForm({ ...form, ticket_min_usd: e.target.value })
                }
                className={`${inputCls} tabular-nums`}
              />
            </div>
            <div>
              <label className={labelCls}>Ticket max (USD)</label>
              <input
                type="number"
                value={form.ticket_max_usd}
                onChange={(e) =>
                  setForm({ ...form, ticket_max_usd: e.target.value })
                }
                className={`${inputCls} tabular-nums`}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Sectores (coma-separados)</label>
              <input
                value={form.sectores}
                onChange={(e) =>
                  setForm({ ...form, sectores: e.target.value })
                }
                placeholder="energía, fintech, agro"
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Thesis</label>
              <textarea
                value={form.thesis}
                onChange={(e) => setForm({ ...form, thesis: e.target.value })}
                rows={2}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Contacto nombre</label>
              <input
                value={form.contacto_nombre}
                onChange={(e) =>
                  setForm({ ...form, contacto_nombre: e.target.value })
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Contacto email</label>
              <input
                type="email"
                value={form.contacto_email}
                onChange={(e) =>
                  setForm({ ...form, contacto_email: e.target.value })
                }
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Contacto LinkedIn</label>
              <input
                type="url"
                value={form.contacto_linkedin}
                onChange={(e) =>
                  setForm({ ...form, contacto_linkedin: e.target.value })
                }
                placeholder="https://linkedin.com/in/…"
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Website</label>
              <input
                type="url"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Próximo contacto</label>
              <input
                type="date"
                value={form.fecha_proximo_contacto}
                onChange={(e) =>
                  setForm({ ...form, fecha_proximo_contacto: e.target.value })
                }
                className={inputCls}
              />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Notas</label>
              <textarea
                value={form.notas}
                onChange={(e) => setForm({ ...form, notas: e.target.value })}
                rows={3}
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
