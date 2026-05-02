"use client";

/**
 * MarcarEntregadoDialog — modal centralizado para marcar un entregable como
 * entregado / no_entregado / en_proceso / pendiente capturando metadata.
 *
 * Reemplaza al anterior `Combobox` inline + `window.prompt()` que perdía
 * contexto y no permitía adjuntar URL Dropbox / notas en el mismo gesto.
 *
 * Estados manejados:
 *   - entregado    → pide fecha_entrega_real (default hoy), adjunto, notas
 *   - no_entregado → motivo OBLIGATORIO + notas opcionales
 *   - en_proceso / pendiente → solo notas
 *
 * Nota: el backend auto-genera la próxima instancia si el template es
 * recurrente (mensual/trimestral/semestral/anual/bienal) — el toast lo
 * hace explícito para que el usuario no se confunda al ver el ítem nuevo.
 */
import { useEffect, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Paperclip,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type EntregableRead,
  type EstadoEntregable,
  type FrecuenciaEntregable,
  useUpdateEntregable,
} from "@/hooks/use-entregables";
import { cn } from "@/lib/utils";

const ESTADO_LABEL: Record<EstadoEntregable, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  entregado: "Entregado",
  no_entregado: "No entregado",
};

const RECURRENTES: ReadonlySet<FrecuenciaEntregable> = new Set([
  "mensual",
  "trimestral",
  "semestral",
  "anual",
  "bienal",
]);

interface Props {
  entregable: EntregableRead | null;
  /** Estado al que apunta el modal. Si null, se elige adentro. */
  estadoTarget: EstadoEntregable | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Callback opcional tras éxito (para reset de UI externa). */
  onSuccess?: () => void;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatFechaCorta(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function MarcarEntregadoDialog({
  entregable,
  estadoTarget,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const updateMut = useUpdateEntregable();

  const [fechaReal, setFechaReal] = useState<string>(todayISO());
  const [adjuntoUrl, setAdjuntoUrl] = useState<string>("");
  const [notas, setNotas] = useState<string>("");
  const [motivo, setMotivo] = useState<string>("");

  // Reset cuando abre/cambia entregable
  useEffect(() => {
    if (!open || !entregable) return;
    setFechaReal(entregable.fecha_entrega_real ?? todayISO());
    setAdjuntoUrl(entregable.adjunto_url ?? "");
    setNotas(entregable.notas ?? "");
    setMotivo(entregable.motivo_no_entrega ?? "");
  }, [open, entregable]);

  if (!entregable || !estadoTarget) return null;

  const isEntregado = estadoTarget === "entregado";
  const isNoEntregado = estadoTarget === "no_entregado";
  const esRecurrente = RECURRENTES.has(entregable.frecuencia);

  const submit = async () => {
    if (isNoEntregado && !motivo.trim()) {
      toast.error("Indicá el motivo de no entrega");
      return;
    }
    try {
      await updateMut.mutateAsync({
        id: entregable.entregable_id,
        body: {
          estado: estadoTarget,
          fecha_entrega_real: isEntregado ? fechaReal : null,
          motivo_no_entrega: isNoEntregado ? motivo.trim() : null,
          notas: notas.trim() || null,
          adjunto_url: adjuntoUrl.trim() || null,
        },
      });
      if (isEntregado && esRecurrente) {
        toast.success(
          `Marcado entregado · próximo período ${entregable.frecuencia} auto-generado`,
        );
      } else {
        toast.success(`Estado → ${ESTADO_LABEL[estadoTarget]}`);
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al actualizar");
    }
  };

  const Icon = isEntregado ? CheckCircle2 : isNoEntregado ? XCircle : Calendar;
  const accent = isEntregado
    ? "text-positive"
    : isNoEntregado
      ? "text-negative"
      : "text-info";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={cn("h-5 w-5", accent)} strokeWidth={1.75} />
            Marcar como {ESTADO_LABEL[estadoTarget]}
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            <span className="font-medium text-ink-700">{entregable.nombre}</span>
            <br />
            <span className="text-[11px] text-ink-500">
              {entregable.categoria} · {entregable.periodo} · vence{" "}
              {formatFechaCorta(entregable.fecha_limite)}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {isEntregado && (
            <>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  Fecha de entrega real
                </label>
                <input
                  type="date"
                  value={fechaReal}
                  onChange={(e) => setFechaReal(e.target.value)}
                  className="w-full rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                />
                {fechaReal !== todayISO() && (
                  <p className="mt-1 text-[10px] text-ink-500">
                    Default era hoy ({formatFechaCorta(todayISO())}); seleccionaste{" "}
                    {formatFechaCorta(fechaReal)}.
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  Adjunto (URL Dropbox o ruta interna)
                </label>
                <div className="relative">
                  <Paperclip
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
                    strokeWidth={1.75}
                  />
                  <input
                    type="text"
                    value={adjuntoUrl}
                    onChange={(e) => setAdjuntoUrl(e.target.value)}
                    placeholder="https://www.dropbox.com/..."
                    className="w-full rounded-xl bg-white py-2 pl-8 pr-3 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                </div>
                {adjuntoUrl && adjuntoUrl.startsWith("http") && (
                  <a
                    href={adjuntoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-cehta-green hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                    Verificar enlace
                  </a>
                )}
              </div>
            </>
          )}

          {isNoEntregado && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-negative">
                Motivo de no entrega *
              </label>
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej.: pendiente revisión auditor externo"
                className="w-full rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-negative/30 focus:outline-none focus:ring-2 focus:ring-negative"
                autoFocus
              />
              <p className="mt-1 text-[10px] text-ink-500">
                Queda registrado en bitácora del Comité de Vigilancia.
              </p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Notas internas (opcional)
            </label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              placeholder="Comentarios, contacto responsable, próximos pasos…"
              className="w-full resize-none rounded-xl bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>

          {isEntregado && esRecurrente && (
            <p className="rounded-xl bg-info/5 px-3 py-2 text-[11px] text-info ring-1 ring-info/15">
              ✨ Al confirmar, se creará automáticamente la próxima instancia
              de este entregable ({entregable.frecuencia}) si todavía no
              existe.
            </p>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={updateMut.isPending}
            className="rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100/40 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={updateMut.isPending}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-60",
              isNoEntregado
                ? "bg-negative hover:bg-negative/90"
                : "bg-cehta-green hover:bg-cehta-green-700",
            )}
          >
            {updateMut.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            )}
            Confirmar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
