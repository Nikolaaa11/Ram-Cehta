"use client";

/**
 * RegenerateAlertsButton — dispara `POST /notifications/regenerate-alerts`.
 *
 * El cron hourly de alertas ya cubre el flow automático, pero este botón
 * permite forzar el refresh on-demand desde /admin/etl. Útil cuando el
 * admin acaba de:
 *   - Cargar F29 nuevos manualmente
 *   - Marcar entregables como entregados
 *   - Cambiar fechas de vigencia legal
 *
 * El servicio es idempotente — correrlo 2 veces seguidas no spamea (dedup
 * por user+entity en últimas 24h). Por eso no pide confirmación.
 */
import { useState } from "react";
import { Bell } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface RegenerateReport {
  f29_due: number;
  contrato_due: number;
  oc_pending: number;
  entregables_due: number;
  total: number;
}

export function RegenerateAlertsButton() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);

  const handleClick = async () => {
    if (running) return;
    setRunning(true);
    const toastId = toast.loading("Regenerando alertas...");
    try {
      const report = await apiClient.post<RegenerateReport>(
        "/notifications/regenerate-alerts",
        {},
        session,
      );
      const parts = [
        report.f29_due > 0 && `F29: ${report.f29_due}`,
        report.contrato_due > 0 && `Legal: ${report.contrato_due}`,
        report.oc_pending > 0 && `OCs: ${report.oc_pending}`,
        report.entregables_due > 0 && `Entregables: ${report.entregables_due}`,
      ].filter(Boolean);
      const summary =
        parts.length > 0
          ? parts.join(" · ")
          : "Sin nuevas alertas (dedup en 24h)";

      toast.success(`Alertas regeneradas · ${report.total} totales`, {
        id: toastId,
        description: summary,
      });
      // Invalidar inbox para que la campana refresque con las nuevas
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["notifications-inbox"] });
    } catch (err) {
      const detail =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error desconocido";
      toast.error("No se pudieron regenerar alertas", {
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
        "inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 transition-all duration-150 ease-apple",
        "hover:border-cehta-green/40 hover:text-cehta-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-60",
      )}
      title="Regenera F29 due / Legal due / OCs pending / Entregables due. Idempotente — no spamea."
    >
      <Bell
        className={cn("h-4 w-4", running && "animate-pulse")}
        strokeWidth={1.75}
      />
      {running ? "Regenerando..." : "Refrescar alertas"}
    </button>
  );
}
