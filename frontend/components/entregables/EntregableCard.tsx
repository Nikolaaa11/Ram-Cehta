"use client";

import { memo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  PauseCircle,
  Pencil,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Surface } from "@/components/ui/surface";
import {
  type EntregableRead,
  type EstadoEntregable,
  type NivelAlerta,
  type CategoriaEntregable,
  useUpdateEntregable,
} from "@/hooks/use-entregables";
import { MarcarEntregadoDialog } from "@/components/entregables/MarcarEntregadoDialog";
import { FileLink } from "@/components/shared/FileLink";

const ESTADO_LABEL: Record<EstadoEntregable, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  entregado: "Entregado",
  no_entregado: "No entregado",
};

const ESTADO_COLOR: Record<
  EstadoEntregable,
  { bg: string; text: string; border: string; Icon: React.ElementType }
> = {
  pendiente: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    border: "border-slate-300",
    Icon: Circle,
  },
  en_proceso: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-300",
    Icon: PauseCircle,
  },
  entregado: {
    bg: "bg-positive/10",
    text: "text-positive",
    border: "border-positive/30",
    Icon: CheckCircle2,
  },
  no_entregado: {
    bg: "bg-negative/10",
    text: "text-negative",
    border: "border-negative/30",
    Icon: XCircle,
  },
};

const ALERTA_BG: Record<NivelAlerta, string> = {
  vencido: "bg-negative/15 text-negative ring-1 ring-negative/30",
  hoy: "bg-negative/20 text-negative ring-1 ring-negative/40 animate-pulse",
  critico: "bg-negative/10 text-negative ring-1 ring-negative/20",
  urgente: "bg-warning/15 text-warning ring-1 ring-warning/25",
  proximo: "bg-warning/10 text-warning ring-1 ring-warning/20",
  en_rango: "bg-info/10 text-info ring-1 ring-info/20",
  normal: "bg-ink-100/40 text-ink-500 ring-1 ring-hairline",
};

const CATEGORIA_COLOR: Record<CategoriaEntregable, string> = {
  CMF: "bg-purple-100 text-purple-800",
  CORFO: "bg-cehta-green/10 text-cehta-green",
  UAF: "bg-red-100 text-red-800",
  SII: "bg-orange-100 text-orange-800",
  INTERNO: "bg-blue-100 text-blue-800",
  AUDITORIA: "bg-gray-100 text-gray-800",
  ASAMBLEA: "bg-yellow-100 text-yellow-800",
  OPERACIONAL: "bg-emerald-100 text-emerald-800",
};

const PRIORIDAD_DOT: Record<string, string> = {
  critica: "bg-negative",
  alta: "bg-warning",
  media: "bg-info",
  baja: "bg-ink-300",
};

function formatRelativo(dias: number | null): string {
  if (dias === null) return "—";
  if (dias < 0) return `Vencido hace ${Math.abs(dias)}d`;
  if (dias === 0) return "Vence HOY";
  if (dias === 1) return "Vence mañana";
  if (dias <= 7) return `En ${dias}d`;
  if (dias <= 30) return `En ${Math.ceil(dias / 7)} sem`;
  return `En ${Math.ceil(dias / 30)} meses`;
}

function formatFecha(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

interface Props {
  entregable: EntregableRead;
  /** Compact: oculta descripción + referencia normativa para vistas densas. */
  compact?: boolean;
}

function EntregableCardImpl({ entregable: e, compact = false }: Props) {
  const [editing, setEditing] = useState(false);
  const [notas, setNotas] = useState(e.notas ?? "");
  const [adjunto, setAdjunto] = useState(e.adjunto_url ?? "");
  const [motivo, setMotivo] = useState(e.motivo_no_entrega ?? "");
  const [dialogTarget, setDialogTarget] = useState<EstadoEntregable | null>(
    null,
  );
  const updateMut = useUpdateEntregable();

  const estadoCfg = ESTADO_COLOR[e.estado];
  const EstadoIcon = estadoCfg.Icon;
  const nivel = e.nivel_alerta ?? "normal";
  const isUrgente =
    nivel === "vencido" || nivel === "hoy" || nivel === "critico";

  // Quick path para "en proceso" / "pendiente" — sin modal, son cambios baratos.
  const handleQuickEstado = async (estado: EstadoEntregable) => {
    try {
      await updateMut.mutateAsync({
        id: e.entregable_id,
        body: { estado },
      });
      toast.success(`Estado → ${ESTADO_LABEL[estado]}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al actualizar");
    }
  };

  const handleSaveEdits = async () => {
    try {
      await updateMut.mutateAsync({
        id: e.entregable_id,
        body: {
          notas: notas || null,
          adjunto_url: adjunto || null,
          motivo_no_entrega:
            e.estado === "no_entregado" && motivo ? motivo : null,
        },
      });
      toast.success("Notas guardadas");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    }
  };

  return (
    <Surface
      padding="compact"
      className={`${
        isUrgente
          ? "ring-1 ring-negative/30"
          : nivel === "urgente" || nivel === "proximo"
            ? "ring-1 ring-warning/25"
            : ""
      } ${e.estado === "entregado" ? "opacity-70" : ""}`}
    >
      {/* Top row: badges + alerta */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              CATEGORIA_COLOR[e.categoria]
            }`}
          >
            {e.categoria}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-ink-100/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-700">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${PRIORIDAD_DOT[e.prioridad]}`}
            />
            {e.prioridad}
          </span>
          <span className="inline-flex rounded-md bg-ink-100/60 px-1.5 py-0.5 text-[10px] font-medium text-ink-700">
            {e.periodo}
          </span>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ALERTA_BG[nivel]}`}
        >
          {isUrgente && <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />}
          {formatRelativo(e.dias_restantes)}
        </span>
      </div>

      {/* Title */}
      <p className="mt-2 text-sm font-semibold text-ink-900">{e.nombre}</p>

      {!compact && e.descripcion && (
        <p className="mt-1 line-clamp-2 text-xs text-ink-600">{e.descripcion}</p>
      )}

      {/* Meta */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3 w-3" strokeWidth={1.75} />
          Vence {formatFecha(e.fecha_limite)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" strokeWidth={1.75} />
          {e.responsable}
        </span>
      </div>

      {!compact && e.referencia_normativa && (
        <p className="mt-1 text-[10px] italic text-ink-400">
          Ref.: {e.referencia_normativa}
        </p>
      )}

      {/* Estado control */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div
          className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium ${estadoCfg.bg} ${estadoCfg.text}`}
        >
          <EstadoIcon className="h-3.5 w-3.5" strokeWidth={2} />
          {ESTADO_LABEL[e.estado]}
        </div>

        {e.estado !== "entregado" && (
          <button
            type="button"
            onClick={() => setDialogTarget("entregado")}
            disabled={updateMut.isPending}
            className="inline-flex h-7 items-center gap-1 rounded-lg bg-cehta-green px-2.5 text-[11px] font-medium text-white hover:bg-cehta-green-700 disabled:opacity-60"
          >
            <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
            Marcar entregado
          </button>
        )}

        {e.estado === "pendiente" && (
          <button
            type="button"
            onClick={() => handleQuickEstado("en_proceso")}
            disabled={updateMut.isPending}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 text-[11px] font-medium text-ink-700 hover:bg-ink-50"
          >
            <PauseCircle className="h-3 w-3" strokeWidth={2} />
            En proceso
          </button>
        )}

        {e.estado !== "no_entregado" && e.estado !== "entregado" && (
          <button
            type="button"
            onClick={() => setDialogTarget("no_entregado")}
            disabled={updateMut.isPending}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-negative/30 bg-white px-2.5 text-[11px] font-medium text-negative hover:bg-negative/5"
          >
            <XCircle className="h-3 w-3" strokeWidth={2} />
            No entregado
          </button>
        )}

        {e.estado !== "pendiente" && (
          <button
            type="button"
            onClick={() => handleQuickEstado("pendiente")}
            disabled={updateMut.isPending}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 text-[11px] font-medium text-ink-500 hover:bg-ink-50"
          >
            Reabrir
          </button>
        )}

        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-hairline bg-white px-2 text-xs font-medium text-ink-700 hover:bg-ink-50"
        >
          <Pencil className="h-3 w-3" strokeWidth={1.75} />
          Notas
        </button>
        {e.estado === "entregado" && e.fecha_entrega_real && (
          <span className="text-[11px] text-ink-500">
            ✓ entregado el {formatFecha(e.fecha_entrega_real)}
          </span>
        )}
        {updateMut.isPending && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-400" />
        )}
      </div>

      <MarcarEntregadoDialog
        entregable={e}
        estadoTarget={dialogTarget}
        open={dialogTarget !== null}
        onOpenChange={(o) => !o && setDialogTarget(null)}
      />

      {/* Editing panel */}
      {editing && (
        <div className="mt-3 space-y-2 rounded-xl border border-hairline bg-ink-50/40 p-3">
          {e.estado === "no_entregado" && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-negative">
                Motivo de no entrega *
              </label>
              <input
                type="text"
                value={motivo}
                onChange={(ev) => setMotivo(ev.target.value)}
                className="w-full rounded-lg border-0 bg-white px-2 py-1.5 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Notas internas
            </label>
            <textarea
              value={notas}
              onChange={(ev) => setNotas(ev.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border-0 bg-white px-2 py-1.5 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
              placeholder="Comentarios, próximas acciones, contacto…"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              Adjunto (URL o ruta)
            </label>
            <input
              type="text"
              value={adjunto}
              onChange={(ev) => setAdjunto(ev.target.value)}
              placeholder="https:// o /Cehta/03-Legal/..."
              className="w-full rounded-lg border-0 bg-white px-2 py-1.5 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-hairline bg-white px-2.5 py-1 text-[11px] font-medium text-ink-600 hover:bg-ink-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveEdits}
              disabled={updateMut.isPending}
              className="rounded-lg bg-cehta-green px-2.5 py-1 text-[11px] font-medium text-white hover:bg-cehta-green-700 disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        </div>
      )}

      {!editing && e.notas && (
        <p className="mt-2 rounded-md bg-ink-50/50 p-2 text-[11px] italic text-ink-600">
          📝 {e.notas}
        </p>
      )}

      {!editing && e.adjunto_url && (
        <div className="mt-2">
          <FileLink url={e.adjunto_url} variant="chip" showDomain />
        </div>
      )}
    </Surface>
  );
}

/**
 * Memoizado: solo re-renderiza si la referencia del entregable cambia.
 * En las listas largas (260+ entregables) esto evita repintar todo el
 * grid cuando un solo ítem cambia de estado.
 */
export const EntregableCard = memo(EntregableCardImpl, (prev, next) => {
  return (
    prev.compact === next.compact &&
    prev.entregable.entregable_id === next.entregable.entregable_id &&
    prev.entregable.estado === next.entregable.estado &&
    prev.entregable.fecha_limite === next.entregable.fecha_limite &&
    prev.entregable.adjunto_url === next.entregable.adjunto_url &&
    prev.entregable.notas === next.entregable.notas &&
    prev.entregable.motivo_no_entrega === next.entregable.motivo_no_entrega &&
    prev.entregable.updated_at === next.entregable.updated_at
  );
});

export { ALERTA_BG, CATEGORIA_COLOR };
