"use client";

/**
 * SincronizarTodosButton — botón maestro en /cartas-gantt.
 *
 * Llama POST /avance/sync-all-from-dropbox que itera por todas las
 * empresas del portafolio buscando su Roadmap.xlsx en Dropbox y
 * sincroniza proyectos+hitos de un solo viaje.
 *
 * Después del sync invalida el queryKey ["avance"] para que la página
 * se refresque sin que el usuario tenga que recargar.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Cloud,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type {
  GanttSyncAllItem,
  GanttSyncAllResult,
} from "@/lib/api/schema";

interface Props {
  className?: string;
}

export function SincronizarTodosButton({ className }: Props) {
  const { session } = useSession();
  const qc = useQueryClient();
  const [resultOpen, setResultOpen] = useState(false);
  const [result, setResult] = useState<GanttSyncAllResult | null>(null);

  const mutation = useMutation({
    mutationFn: async () =>
      apiClient.post<GanttSyncAllResult>(
        "/avance/sync-all-from-dropbox",
        {},
        session,
      ),
    onSuccess: (data) => {
      setResult(data);
      setResultOpen(true);
      toast.success(data.message);
      qc.invalidateQueries({ queryKey: ["avance"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 503) {
        toast.error(
          "Dropbox no conectado. Conectalo en /admin/integraciones primero.",
        );
      } else {
        toast.error(
          err instanceof ApiError ? err.detail : "Error al sincronizar.",
        );
      }
    },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-60",
          className,
        )}
      >
        {mutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            Sincronizando todos los Gantts…
          </>
        ) : (
          <>
            <Cloud className="h-4 w-4" strokeWidth={1.75} />
            Sincronizar todos los Gantts
          </>
        )}
      </button>

      <ResultDialog
        open={resultOpen}
        onOpenChange={setResultOpen}
        result={result}
      />
    </>
  );
}

function ResultDialog({
  open,
  onOpenChange,
  result,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  result: GanttSyncAllResult | null;
}) {
  if (!result) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden p-0">
        <div className="border-b border-hairline px-6 py-4">
          <DialogTitle>Resultado de la sincronización</DialogTitle>
          <DialogDescription className="mt-1">
            Se procesaron {result.total_empresas} empresas del portafolio.
          </DialogDescription>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {/* Resumen agregado */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            <SummaryStat
              label="Sincronizadas"
              value={result.sincronizadas}
              tone="positive"
              Icon={CheckCircle2}
            />
            <SummaryStat
              label="Sin Gantt en Dropbox"
              value={result.no_encontradas}
              tone="ink"
              Icon={AlertCircle}
            />
            <SummaryStat
              label="Con error"
              value={result.con_error}
              tone={result.con_error > 0 ? "negative" : "ink"}
              Icon={XCircle}
            />
          </div>

          {result.proyectos_creados_total > 0 ||
          result.hitos_creados_total > 0 ? (
            <div className="mb-5 rounded-2xl bg-cehta-green/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-ink-500">
                Total importado
              </p>
              <p className="mt-1 text-base font-semibold text-ink-900">
                +{result.proyectos_creados_total} proyectos nuevos ·{" "}
                ~{result.proyectos_actualizados_total} actualizados ·{" "}
                +{result.hitos_creados_total} hitos nuevos
              </p>
            </div>
          ) : null}

          {/* Detalle por empresa */}
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-500">
            Detalle por empresa
          </p>
          <div className="space-y-1.5">
            {result.items.map((it) => (
              <ItemRow key={it.empresa_codigo} item={it} />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end border-t border-hairline px-6 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
            Cerrar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({
  label,
  value,
  tone,
  Icon,
}: {
  label: string;
  value: number;
  tone: "positive" | "negative" | "ink";
  Icon: React.ElementType;
}) {
  const colors = {
    positive: "bg-positive/10 text-positive",
    negative: "bg-negative/10 text-negative",
    ink: "bg-ink-100 text-ink-600",
  }[tone];
  return (
    <div className="rounded-xl border border-hairline bg-white p-3">
      <span
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-lg",
          colors,
        )}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </span>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink-900">
        {value}
      </p>
      <p className="text-[11px] text-ink-500">{label}</p>
    </div>
  );
}

const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  ok: { dot: "bg-positive", label: "Sincronizado" },
  not_found: { dot: "bg-ink-300", label: "Sin Gantt" },
  error: { dot: "bg-negative", label: "Error" },
  no_dropbox: { dot: "bg-warning", label: "Sin Dropbox" },
};

function ItemRow({ item }: { item: GanttSyncAllItem }) {
  const style = STATUS_STYLE[item.status] ?? {
    dot: "bg-negative",
    label: "Error",
  };
  return (
    <div className="flex items-start gap-3 rounded-xl border border-hairline bg-white px-3 py-2">
      <span
        className={cn(
          "mt-1 inline-block h-2 w-2 shrink-0 rounded-full",
          style.dot,
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-medium text-ink-900">
            {item.empresa_codigo}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-ink-400">
            {style.label}
          </span>
          {item.formato && (
            <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-600">
              {item.formato}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-ink-600">{item.message}</p>
        {item.dropbox_path && (
          <p className="mt-0.5 truncate font-mono text-[10px] text-ink-400">
            {item.dropbox_path}
          </p>
        )}
      </div>
    </div>
  );
}
