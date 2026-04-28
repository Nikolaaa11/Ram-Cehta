"use client";

/**
 * RunEtlButton — dispara `POST /etl/run` con confirmación + toast.
 *
 * Visible solo en el admin/etl page. El botón:
 *   1. Pide confirmación.
 *   2. Llama al endpoint con loading state.
 *   3. Muestra toast con resultado (success/partial/skipped/failed).
 *   4. Invalida el query de runs ETL para que la tabla refresque.
 */
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface ETLRunResult {
  run_id: string | null;
  status: string;
  source_file: string;
  source_hash: string | null;
  rows_extracted: number;
  rows_loaded: number;
  rows_rejected: number;
  error_message: string | null;
  snapshot_path: string | null;
  triggered_by: string;
}

export function RunEtlButton() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const handleClick = async () => {
    if (running) return;
    if (
      !window.confirm(
        "¿Ejecutar el ETL ahora? Buscará Data Madre.xlsx en Dropbox y sincronizará Movimientos.",
      )
    ) {
      return;
    }
    setRunning(true);
    const toastId = toast.loading("Ejecutando ETL...");
    try {
      const result = await apiClient.post<ETLRunResult>(
        "/etl/run",
        {},
        session,
      );
      const summary =
        result.status === "skipped"
          ? "Sin cambios — el archivo no se modificó."
          : `Cargadas: ${result.rows_loaded.toLocaleString("es-CL")} · Rechazadas: ${result.rows_rejected.toLocaleString("es-CL")}`;

      switch (result.status) {
        case "success":
          toast.success("ETL completado", {
            id: toastId,
            description: summary,
          });
          break;
        case "partial":
          toast.warning("ETL completado con filas rechazadas", {
            id: toastId,
            description: summary,
          });
          break;
        case "skipped":
          toast.info("ETL omitido", {
            id: toastId,
            description: summary,
          });
          break;
        case "failed":
          toast.error("ETL falló", {
            id: toastId,
            description: result.error_message ?? "Error desconocido",
          });
          break;
        default:
          toast.info(`ETL: ${result.status}`, { id: toastId });
      }
      // Invalidar lista de runs para refrescar la tabla
      qc.invalidateQueries({ queryKey: ["admin-etl-runs"] });
    } catch (err) {
      const detail =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error desconocido";
      toast.error("No se pudo ejecutar el ETL", {
        id: toastId,
        description: detail,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={running}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white shadow-card transition-all duration-150 ease-apple",
        "hover:bg-cehta-green/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-60",
      )}
    >
      <RefreshCw
        className={cn("h-4 w-4", running && "animate-spin")}
        strokeWidth={2}
      />
      {running ? "Ejecutando..." : "Ejecutar ETL ahora"}
    </button>
  );
}
