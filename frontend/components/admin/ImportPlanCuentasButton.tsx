"use client";

/**
 * ImportPlanCuentasButton — sube `Plan_de_cuentas_v2.xlsx` al endpoint
 * `POST /admin/plan-cuentas/import`. Idempotente: re-correr con el
 * mismo archivo o uno actualizado por el COO no duplica nada (UPSERT
 * por código de cuenta).
 *
 * UX:
 *   - File picker oculto, click en el botón abre el dialogo del SO
 *   - Solo .xlsx / .xls
 *   - Loading state mientras parsea + uploads
 *   - Toast con resumen al terminar (cuentas / habilitaciones / CORFO)
 *   - Si hay error de estructura del Excel, muestra el detail
 */
import { useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { handleSessionExpired } from "@/lib/api/session-handling";
import { cn } from "@/lib/utils";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

interface ImportReport {
  summary: {
    total_cuentas: number;
    imputables: number;
    corfo_elegibles: number;
    habilitaciones_por_empresa: Record<string, number>;
  };
  counters: {
    cuentas_upserted: number;
    habilitaciones_upserted: number;
    habilitaciones_omitidas_empresa_inexistente: number;
  };
  file_name: string;
}

export function ImportPlanCuentasButton() {
  const { session } = useSession();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!session) {
      handleSessionExpired();
      return;
    }
    setUploading(true);
    const toastId = toast.loading(`Importando ${file.name}...`);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(
        `${API_BASE}/admin/plan-cuentas/import`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
          body: fd,
          cache: "no-store",
        },
      );

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          detail = body?.detail ?? detail;
        } catch {
          // non-JSON response — keep default
        }
        throw new ApiError(res.status, detail);
      }

      const report = (await res.json()) as ImportReport;
      const empresasCount = Object.keys(report.summary.habilitaciones_por_empresa)
        .length;

      toast.success(
        `Plan de cuentas importado · ${report.counters.cuentas_upserted} cuentas`,
        {
          id: toastId,
          description:
            `${report.summary.imputables} imputables · ${report.summary.corfo_elegibles} CORFO · ` +
            `${report.counters.habilitaciones_upserted} habilitaciones en ${empresasCount} empresas`,
          duration: 6000,
        },
      );

      // Refetch del summary para que la UI vea los counts actualizados
      qc.invalidateQueries({ queryKey: ["plan-cuentas-summary"] });
    } catch (err) {
      const detail =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error desconocido";
      toast.error("No se pudo importar el plan", {
        id: toastId,
        description: detail,
        duration: 8000,
      });
    } finally {
      setUploading(false);
      // reset el input para que el mismo archivo pueda re-seleccionarse
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 transition-all duration-150 ease-apple",
          "hover:border-cehta-green/40 hover:text-cehta-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
        title="Subir Plan_de_cuentas_v2.xlsx (o cualquier versión actualizada). Idempotente."
      >
        {uploading ? (
          <Upload className="h-4 w-4 animate-pulse" strokeWidth={1.75} />
        ) : (
          <FileSpreadsheet className="h-4 w-4" strokeWidth={1.75} />
        )}
        {uploading ? "Importando..." : "Importar plan de cuentas"}
      </button>
    </>
  );
}
